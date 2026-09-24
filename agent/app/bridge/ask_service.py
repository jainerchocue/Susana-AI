"""Orquesta POST /v1/ask: pregunta -> plan -> Node ejecuta -> respuesta verificada.

1. Charla (saludo, ayuda...) y rechazos (consejo clínico, datos personales):
   respuesta determinista, sin tocar el HIS.
2. Pregunta de datos: el parser determinista (nlu + planner) propone el DSL;
   si no reconoce la pregunta, el LLM propone UNA consulta que se valida.
3. Node valida y ejecuta con el ticket; el narrador redacta SOLO con esas filas.
4. El LLM puede pulir la redacción; si altera una cifra, se descarta.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any

from app.bridge.dsl import Catalogo, validar
from app.bridge.llm import Deadline, planificar_con_llm, pulir
from app.bridge.narrator import describir_filtros, redactar
from app.bridge.nlu import TZ, clasificar_conversacion, interpretar, norm
from app.bridge.node_client import ejecutar_en_node
from app.bridge.planner import NOMBRE_TEMA, Plan, SinPlan, planificar
from app.bridge.textos import lista_natural
from app.config.settings import settings

logger = logging.getLogger(__name__)

_MAX_ANSWER = 4000

# (dataset que lo habilita, tema, ejemplo) — la ayuda solo ofrece lo que el rol puede consultar.
_OFERTA = (
    ("bed_occupancy", "ocupación de camas por unidad", "¿Cuántas camas de UCI están ocupadas hoy?"),
    ("medication_inventory", "días de inventario de medicamentos", "¿Qué medicamentos tienen menos de 5 días de inventario?"),
    ("admissions", "tiempos de espera", "¿Cuál es el tiempo de espera promedio en urgencias en la última semana?"),
    ("admissions", "ingresos por servicio", "¿Qué servicio tiene más pacientes ingresados este mes?"),
    ("admissions", "proyección de demanda", "¿Cómo se ve la demanda de urgencias la próxima semana?"),
    ("medications", "consumo de medicamentos", "¿Cuáles son los 10 medicamentos más dispensados en agosto?"),
    ("services", "servicios y procedimientos prestados", "¿Qué procedimientos se prestaron más este mes?"),
    ("surgeries", "programación de cirugías", "¿Cuántas cirugías no se realizaron?"),
    ("alerts", "alertas operativas", "¿Qué alertas críticas están abiertas?"),
)


def _oferta(cat: Catalogo) -> tuple[str, list[str]]:
    disponibles = [(tema, ej) for ds, tema, ej in _OFERTA if cat.has(ds)]
    temas = lista_natural([t for t, _ in disponibles])
    return temas, [ej for _, ej in disponibles]


def _respuesta_charla(tipo: str, cat: Catalogo) -> str:
    temas, ejemplos = _oferta(cat)
    ejemplo = f" Por ejemplo: «{ejemplos[0]}»" + (f" o «{ejemplos[1]}»." if len(ejemplos) > 1 else ".") if ejemplos else ""
    if tipo == "greeting":
        return (
            "¡Hola! Soy Susana-AI, el asistente de inteligencia operativa del Hospital Susana López de Valencia. "
            f"Consulto los datos autorizados del HIS y te respondo con cifras verificadas sobre {temas}.{ejemplo}"
        )
    if tipo == "help":
        lineas = "; ".join(f"«{e}»" for e in ejemplos[:5])
        return (
            "Soy Susana-AI: respondo preguntas operativas con los datos del HIS a los que tu rol tiene acceso, "
            f"y siempre te digo qué medí y con qué fecha de corte. Puedo ayudarte con {temas}. "
            f"Algunas preguntas que puedes hacerme: {lineas}."
        )
    if tipo == "thanks":
        return "Con gusto. Si necesitas otro dato operativo del hospital, pregúntame."
    if tipo == "bye":
        return "Hasta luego. Aquí estaré cuando necesites datos operativos del hospital."
    if tipo == "clinical":
        return (
            "No puedo dar indicaciones clínicas (diagnósticos, tratamientos ni dosis): esa decisión corresponde al "
            f"personal de salud. Sí puedo ayudarte con datos operativos como {temas}."
        )
    if tipo == "pii":
        return (
            "No comparto datos personales de pacientes (nombres, documentos ni contactos): trabajo solo con cifras "
            f"agregadas. Puedo ayudarte, por ejemplo, con {temas}."
        )
    return ""


def _no_entendida(cat: Catalogo) -> str:
    temas, ejemplos = _oferta(cat)
    if not temas:
        return "Tu rol no tiene acceso a datos que pueda consultar desde el asistente."
    ejemplo = f" Por ejemplo: «{ejemplos[0]}»." if ejemplos else ""
    return (
        "No identifiqué en tu pregunta un indicador que pueda consultar con los datos del HIS. "
        f"Puedo responder sobre {temas}.{ejemplo}"
    )


def _sin_permiso(tema: str | None, cat: Catalogo) -> str:
    temas, _ = _oferta(cat)
    nombre = NOMBRE_TEMA.get(tema or "", "ese tema")
    texto = f"Tu rol no tiene acceso a los datos de {nombre}, así que no puedo consultarlos."
    return texto + (f" Con tus permisos puedo ayudarte con {temas}." if temas else "")


def _fecha_contexto(context: dict[str, Any] | None, clave: str) -> datetime | None:
    """Fechas de corte que manda Node (`referenceDate` = el "hoy" de los datos), en hora de Colombia."""
    valor = (context or {}).get(clave)
    if not isinstance(valor, str):
        return None
    try:
        return datetime.fromisoformat(valor.replace("Z", "+00:00")).astimezone(TZ)
    except ValueError:
        return None


def _salida(status: str, answer: str) -> dict[str, str]:
    return {"status": status, "answer": answer.strip()[:_MAX_ANSWER]}


async def handle_ask(
    *,
    question: str,
    ticket: str,
    catalog: list[dict[str, Any]],
    limits: dict[str, Any] | None = None,
    context: dict[str, Any] | None = None,
) -> dict[str, str]:
    deadline = Deadline(settings.ask_budget_seconds)
    limits = limits or {}
    max_rows = max(1, int(limits.get("maxRows") or 100))
    max_queries = max(1, int(limits.get("maxQueries") or 2))
    cat = Catalogo(catalog)
    ref = _fecha_contexto(context, "referenceDate")
    ahora = ref or datetime.now(TZ)

    it = interpretar(question, ahora)
    charla = clasificar_conversacion(norm(question))
    if charla in {"clinical", "pii"}:
        return _salida("cannot_answer", _respuesta_charla(charla, cat))
    if charla and not it.tema:
        return _salida("ok", _respuesta_charla(charla, cat))

    plan: Plan | SinPlan
    if it.tema:
        plan = planificar(it, cat, max_rows=max_rows, ref=ahora)
    else:
        consulta = await planificar_con_llm(question, cat, ref=ahora, max_rows=max_rows, deadline=deadline) if cat.datasets else None
        plan = (
            Plan(tema="generic", dataset=consulta["dataset"], consulta=consulta, alcance=describir_filtros(consulta))
            if consulta
            else SinPlan("sin_tema")
        )
    if isinstance(plan, SinPlan):
        texto = _sin_permiso(plan.tema, cat) if plan.motivo == "sin_permiso" else _no_entendida(cat)
        return _salida("cannot_answer", texto)

    errores = validar(plan.consulta, cat, max_rows)
    if errores:
        # No debería pasar (el planificador está probado contra el validador): se registra y se dice.
        logger.error("Plan inválido para %r: %s", question[:120], errores)
        return _salida("cannot_answer", "No pude formular una consulta válida para esa pregunta. ¿Puedes reformularla?")

    principal = await ejecutar_en_node(ticket, plan.consulta)
    if principal is None:
        return _salida(
            "cannot_answer",
            "No pude obtener los datos del sistema del hospital en este momento. Intenta de nuevo en unos segundos.",
        )
    resultados: list[dict[str, Any] | None] = [principal]
    for extra in plan.extras[: max_queries - 1]:
        resultados.append(await ejecutar_en_node(ticket, extra))

    # El pronóstico entrena un modelo pequeño: fuera del event loop.
    texto = await asyncio.to_thread(redactar, plan, resultados, ref, _fecha_contexto(context, "dataStart"))
    pulido = await pulir(texto, question, deadline=deadline)
    return _salida("ok", pulido or texto)
