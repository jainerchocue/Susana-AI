"""Orquesta POST /v1/ask.

La AI (OpenRouter) es la voz del chat en TODOS los casos.
- Conversación (saludo, ayuda, qué eres…): solo LLM, sin tocar el HIS.
- Consulta operativa: propone DSL → Node autoriza/extrae → hechos (+ ML si aplica) → LLM redacta.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import unicodedata
from typing import Any

from app.agent.answer_brief import AnswerBrief, build_answer_brief
from app.agent.predictor import Predictor, extract_series_from_result
from app.agent.recommender import Recommender
from app.agent.root_cause import root_cause_hint
from app.bridge.dsl_planner import (
    _umbral_dias,
    consulta_serie_temporal,
    consulta_uci_alternativa,
    consulta_unidades_actividad,
    elegir_consulta,
    intent_desde_pregunta,
)
from app.analytics.statistics import safe_number
from app.bridge.node_client import ejecutar_en_node
from app.config.settings import settings
from app.llm.client import get_llm_client

logger = logging.getLogger(__name__)

_MAX_ANSWER = 4000
# Presupuesto corto pero suficiente para gpt-6-luna-pro (reasoning).
_LLM_BUDGET_S = min(18.0, max(8.0, float(settings.llm_timeout_seconds or 16.0)))

_SYSTEM_DATOS = """Eres Susana-AI, asistente de inteligencia operativa del Hospital Susana López de Valencia.
Hablas con dirección y operaciones usando datos reales del HIS (ya consultados).

ESTILO: humano, seguro, preciso. Como un analista que habla en junta — no como un reporte.
Máximo 2 párrafos cortos (45–80 palabras en total). Ve al grano.

REGLAS:
1. Primera frase = respuesta directa a la pregunta (con la cifra o hallazgo principal).
2. Segunda frase = contexto breve o 1 tip operativo (opcional).
3. Solo datos del JSON "hechos". No inventes.
4. No listes todo el ranking: menciona como máximo 2–3 ítems si aportan.
5. No repitas la pregunta. No rellenes con frases vacías.

PROHIBIDO: Random Forest, ML, algoritmo, dataset, SQL, count_all, "En el detalle destacan",
"grupo(s) observados", viñetas, markdown, consejos clínicos, PII.
"""

_SYSTEM_CHAT = """Eres Susana-AI, asistente de inteligencia operativa del Hospital Susana López de Valencia.

ESTILO: natural y breve (máx. 60 palabras). Suenas a persona, no a menú.

Puedes ayudar con ocupación, esperas, farmacia, cirugías y proyecciones de demanda.

Si saludan: 2–3 frases + invita a una pregunta concreta.
Sin inventar cifras. Sin jerga técnica ni markdown.
"""


def _norm(text: str) -> str:
    nfkd = unicodedata.normalize("NFD", text.lower())
    return "".join(c for c in nfkd if unicodedata.category(c) != "Mn")


def _pide_datos_his(question: str) -> bool:
    """True solo si la pregunta apunta a un indicador / dato del HIS."""
    t = _norm(question)
    senales = (
        "uci",
        "cama",
        "ocupac",
        "espera",
        "triage",
        "medic",
        "farmac",
        "stock",
        "invent",
        "cirug",
        "quirurg",
        "alerta",
        "demanda",
        "ingres",
        "servicio",
        "urgenc",
        "predic",
        "tendenc",
        "proyecc",
        "anticip",
        "evolucion",
        "pronostic",
        "forecast",
        "cuant",
        "cuánt",
        "cual ",
        "cuál ",
        "cuanto",
        "cuánto",
        "ranking",
        "mayor",
        "menor",
        "promedio",
        "total",
        "ranking",
    )
    return any(s in t for s in senales)


def _es_proyeccion(question: str) -> bool:
    q = _norm(question)
    return any(
        k in q
        for k in (
            "evolucion",
            "evolucionar",
            "proxim",
            "predic",
            "anticip",
            "futur",
            "tendenc",
            "proyecc",
            "como ira",
            "como va a",
            "proximos dias",
        )
    )


def _etiqueta_intent(intent: str) -> str:
    return {
        "MEDICATION_STOCK": "consumo",
        "WAIT_TIME": "minutos de espera",
        "OCCUPANCY": "ingresos",
        "DEMAND": "ingresos",
        "SURGERY": "cirugías",
    }.get(intent, "actividad")


def _plantilla(brief: AnswerBrief) -> str:
    """Fallback profesional si OpenRouter no responde."""
    if brief.clarify:
        return brief.clarify[:_MAX_ANSWER]
    if brief.empty:
        parts = [
            brief.empty_reason
            or "Con la información disponible no puedo responder esa consulta con seguridad."
        ]
        if brief.recommendations:
            parts.append(brief.recommendations[0])
        if brief.limitations:
            parts.append(brief.limitations[0])
        return " ".join(parts)[:_MAX_ANSWER]

    partes: list[str] = []
    if brief.headline:
        partes.append(brief.headline if brief.headline.endswith(".") else brief.headline + ".")
    if brief.ranking:
        sample = brief.ranking[0] or ""
        if "triage" in sample.lower() or "días" in sample or "dias" in sample.lower():
            partes.append("Detalle: " + "; ".join(brief.ranking[:3]) + ".")
        elif len(brief.ranking) > 1:
            partes.append("También: " + "; ".join(brief.ranking[:2]) + ".")
    if brief.forecast and _es_proyeccion(brief.question):
        # Una sola frase de anticipación
        frase = brief.forecast.split(".")[0].strip()
        if frase:
            partes.append(frase + ".")
    if brief.recommendations:
        tip = brief.recommendations[0]
        # Acortar tip largo
        if len(tip) > 140:
            tip = tip[:137].rsplit(" ", 1)[0] + "."
        partes.append(tip if tip.endswith(".") else tip + ".")
    # No volcar limitations largas en plantilla (salvo UCI nota corta)
    if brief.limitations and "camas físicas" in brief.limitations[0]:
        partes.append(brief.limitations[0])
    return " ".join(p for p in partes if p).strip()[:_MAX_ANSWER]


_FALLBACK_CHAT = (
    "Soy Susana-AI, del Hospital Susana López de Valencia. "
    "Puedo ayudarle con ocupación, esperas, farmacia, cirugías o proyecciones. "
    "¿Qué desea consultar?"
)


def _limpia(text: str | None) -> str | None:
    if not text:
        return None
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json|markdown|text)?\s*", "", t)
        t = re.sub(r"\s*```$", "", t)
    return t.strip().strip('"') or None


def _texto_profesional_ok(text: str) -> bool:
    """Rechaza respuestas con jerga técnica que no debe verse en el chat."""
    low = text.lower()
    prohibido = (
        "random forest",
        "holdout",
        "lag_",
        "mae",
        "count_all",
        "dataset",
        "scikit",
        "sklearn",
        "periodos históricos",
        "períodos históricos",
        "algoritmo",
    )
    return not any(p in low for p in prohibido)


def _cifras_ok(brief: AnswerBrief, text: str) -> bool:
    if not _texto_profesional_ok(text):
        return False
    allowed = brief.allowed_numbers()
    for raw in re.findall(r"\d+(?:[.,]\d+)?", text):
        n = raw.replace(",", ".")
        whole = n.split(".")[0]
        if whole in allowed or n in allowed:
            continue
        if whole in {"1", "2", "3", "4", "5", "0", "90", "100", "150"}:
            continue
        try:
            val = float(n)
        except ValueError:
            continue
        if val >= 10 and whole not in allowed:
            return False
    low = text.lower()
    if any(b in low for b in ("diagnóstico", "prescri", "dosis", "tratamiento del paciente")):
        return False
    return True


async def _llm_chat(messages: list[dict[str, str]], *, max_tokens: int = 320) -> str | None:
    client = get_llm_client()
    if not client.is_available:
        return None
    try:
        content, _ = await asyncio.wait_for(
            client.chat(messages, temperature=0.35, max_tokens=max_tokens),
            timeout=_LLM_BUDGET_S,
        )
    except asyncio.TimeoutError:
        logger.warning("OpenRouter timeout (%.0fs)", _LLM_BUDGET_S)
        return None
    except Exception:
        logger.exception("OpenRouter falló")
        return None
    return _limpia(content)


async def _responder_conversacion(question: str) -> str:
    """Saludos / ayuda / meta: solo AI, sin consultas al HIS."""
    text = await _llm_chat(
        [
            {"role": "system", "content": _SYSTEM_CHAT},
            {
                "role": "user",
                "content": (
                    "Mensaje del usuario en el chat del hospital:\n"
                    f"{question}\n\n"
                    "Responde como Susana-AI (sin inventar cifras del HIS)."
                ),
            },
        ],
        max_tokens=140,
    )
    return (text or _FALLBACK_CHAT)[:_MAX_ANSWER]


async def _con_openrouter(brief: AnswerBrief) -> str | None:
    """Redacta con hechos del HIS (+ ML)."""
    if brief.empty and not brief.forecast:
        return None

    proy = _es_proyeccion(brief.question)
    # No enviar nombres técnicos al LLM (evita que diga Random Forest, etc.)
    hechos: dict[str, Any] = {
        "pregunta": brief.question,
        "foco": "proyeccion" if proy and brief.forecast else "descriptivo",
        "fuente": brief.dataset_label,
        "dato_principal": brief.headline,
        "detalle": brief.ranking[:3],
        "anticipacion": brief.forecast if proy else None,
        "recomendacion": brief.recommendations[:1],
        "nota": (brief.limitations[0] if brief.limitations else None),
    }

    text = await _llm_chat(
        [
            {"role": "system", "content": _SYSTEM_DATOS},
            {
                "role": "user",
                "content": (
                    "Responde en máximo 80 palabras, preciso y natural. "
                    "Solo hechos de este JSON:\n"
                    f"{json.dumps(hechos, ensure_ascii=False)}"
                ),
            },
        ],
        max_tokens=220,
    )
    if text and _cifras_ok(brief, text):
        return text[:_MAX_ANSWER]
    if text:
        logger.warning("OpenRouter rechazado por grounding; uso plantilla")
    return None


async def _responder_datos(brief: AnswerBrief) -> str:
    if brief.clarify:
        # Aun en error/aclaración, intentar voz AI
        text = await _llm_chat(
            [
                {"role": "system", "content": _SYSTEM_CHAT},
                {
                    "role": "user",
                    "content": (
                        f"Pregunta: {brief.question}\n"
                        f"Situación: {brief.clarify}\n"
                        "Explícaselo al usuario con tono profesional y amable."
                    ),
                },
            ],
            max_tokens=200,
        )
        return (text or brief.clarify)[:_MAX_ANSWER]
    text = await _con_openrouter(brief)
    return text or _plantilla(brief)


async def handle_ask(
    *,
    question: str,
    ticket: str,
    catalog: list[dict[str, Any]],
    limits: dict[str, Any] | None = None,
) -> dict[str, str]:
    limits = limits or {}
    max_rows = int(limits.get("maxRows") or 100)

    # ── Modo conversación: la AI habla; no consulta el HIS ──
    if not _pide_datos_his(question):
        answer = await _responder_conversacion(question)
        return {"status": "ok", "answer": answer}

    # ── Modo consulta: propone DSL → Node → hechos → AI redacta ──
    query = elegir_consulta(question, catalog, max_rows=max_rows)
    if not query:
        answer = await _llm_chat(
            [
                {"role": "system", "content": _SYSTEM_CHAT},
                {
                    "role": "user",
                    "content": (
                        f"El usuario preguntó: {question}\n"
                        "No hay dataset permitido en su catálogo para esa consulta. "
                        "Explícale con amabilidad qué temas sí puede consultar "
                        "(ocupación, esperas, medicamentos, cirugías)."
                    ),
                },
            ],
            max_tokens=200,
        )
        return {
            "status": "cannot_answer",
            "answer": (answer or _FALLBACK_CHAT)[:_MAX_ANSWER],
        }

    resultado = await ejecutar_en_node(ticket, query)
    if not resultado:
        answer = await _llm_chat(
            [
                {"role": "system", "content": _SYSTEM_CHAT},
                {
                    "role": "user",
                    "content": (
                        f"Pregunta: {question}\n"
                        "No pude obtener datos del sistema en este momento. "
                        "Infórmalo con amabilidad y sugiere reintentar."
                    ),
                },
            ],
            max_tokens=160,
        )
        return {
            "status": "cannot_answer",
            "answer": (
                answer
                or "No pude obtener datos del sistema en este momento. Intente de nuevo en unos segundos."
            )[:_MAX_ANSWER],
        }

    intent = intent_desde_pregunta(question)
    rows = resultado.get("rows") or []
    if not isinstance(rows, list):
        rows = []
    qn = _norm(question)

    # UCI: reintentos (subunidad / intensivo / sin filtro "hoy")
    if (not rows) and "uci" in qn:
        for campo, texto_f, con_hoy in (
            ("subunit", "UCI", True),
            ("unit", "INTENSIV", True),
            ("subunit", "INTENSIV", True),
            ("subunit", "UCI", False),
            ("unit", "UCI", False),
            ("subunit", "INTENSIV", False),
        ):
            alt = consulta_uci_alternativa(
                question,
                catalog,
                max_rows=max_rows,
                campo=campo,
                texto_filtro=texto_f,
                con_hoy=con_hoy,
            )
            if not alt:
                continue
            extra = await ejecutar_en_node(ticket, alt)
            if extra and (extra.get("rows") or []):
                resultado = extra
                query = alt
                rows = list(extra.get("rows") or [])
                break

    # Inventario: filtrar por umbral; si ninguno califica, informar el menor real
    inventario_contexto: str | None = None
    if ("inventario" in qn or ("medic" in qn and "menos" in qn)) and str(query.get("dataset")) == "alerts":
        umbral = _umbral_dias(qn, 5)
        crudas = [r for r in rows if isinstance(r, dict)]
        filtradas = []
        for r in crudas:
            dias = safe_number(r.get("min_value") if r.get("min_value") is not None else r.get("value"))
            if dias is not None and float(dias) <= umbral:
                filtradas.append(r)
        if filtradas:
            rows = filtradas
        elif crudas:
            # Hay LOW_STOCK reales pero todos > umbral: responder con el menor (honesto)
            def _dias_row(r: dict[str, Any]) -> float:
                d = safe_number(r.get("min_value") if r.get("min_value") is not None else r.get("value"))
                return float(d) if d is not None else 1e9

            crudas_ord = sorted(crudas, key=_dias_row)
            top = crudas_ord[0]
            d0 = _dias_row(top)
            codigo = top.get("scope_id") or "código"
            inventario_contexto = (
                f"No hay medicamentos con ≤{umbral} días de inventario en alertas activas. "
                f"El menor stock alertado es {codigo} con ~{d0:.0f} días."
            )
            rows = []
        else:
            rows = []

    row_count = len(rows)
    columns = list(rows[0].keys()) if rows and isinstance(rows[0], dict) else []

    empty_hint: str | None = None

    # UCI sin match: consultar unidades reales del HIS (sin inventar)
    if (not rows) and "uci" in qn and "admissions" in {
        str(d.get("dataset")) for d in catalog if d.get("dataset")
    }:
        ov = consulta_unidades_actividad(catalog, solo_hoy=("hoy" in qn), max_rows=8)
        if ov:
            extra = await ejecutar_en_node(ticket, ov)
            extra_rows = (extra or {}).get("rows") or []
            if isinstance(extra_rows, list) and extra_rows:
                nombres = []
                for r in extra_rows[:5]:
                    if isinstance(r, dict) and r.get("unit") is not None:
                        n = safe_number(r.get("count_all") or r.get("count"))
                        nombres.append(
                            f"{r.get('unit')}"
                            + (f" ({int(n)})" if n is not None else "")
                        )
                empty_hint = (
                    "En el HIS no aparece una unidad o subunidad etiquetada como UCI "
                    + ("hoy. " if "hoy" in qn else "en este corte. ")
                    + "Las unidades con más actividad son: "
                    + "; ".join(nombres)
                    + ". No invento ocupación de UCI si no está en los datos."
                )

    # Mensajes vacíos honestos
    if not rows and empty_hint is None:
        if "uci" in qn:
            empty_hint = (
                "No hay ingresos etiquetados como UCI en el HIS para ese corte. "
                "No atribuyo camas de UCI sin respaldo en la base."
            )
        elif inventario_contexto:
            empty_hint = inventario_contexto
        elif "inventario" in qn or ("medic" in qn and "menos" in qn):
            empty_hint = (
                "No hay alertas LOW_STOCK activas en la base. "
                "Sin esa señal del motor de alertas no estimo días de inventario."
            )

    tips = Recommender().recommend(intent, rows, columns) if rows else []
    cause = root_cause_hint(intent, rows, question) if rows else None

    if not rows and empty_hint:
        text = await _llm_chat(
            [
                {"role": "system", "content": _SYSTEM_DATOS},
                {
                    "role": "user",
                    "content": (
                        f"Pregunta: {question}\n"
                        f"Hecho: {empty_hint}\n"
                        "Responde en 2 frases, claro y profesional, sin inventar cifras."
                    ),
                },
            ],
            max_tokens=120,
        )
        return {"status": "cannot_answer", "answer": (text or empty_hint)[:_MAX_ANSWER]}

    forecast_text = ""
    forecast_method: str | None = None
    if _es_proyeccion(question):
        try:
            serie_query = consulta_serie_temporal(question, catalog, max_rows=min(max_rows, 60))
            serie_resultado = resultado
            if serie_query and serie_query != query:
                extra = await ejecutar_en_node(ticket, serie_query)
                if extra and (extra.get("rows") or []):
                    serie_resultado = extra

            series, ctx = extract_series_from_result(serie_resultado)
            if series and ctx.get("date_field"):
                forecast_text, forecast_method = await asyncio.to_thread(
                    Predictor().forecast_facts,
                    series,
                    label=_etiqueta_intent(intent),
                    context=ctx,
                )
        except Exception:
            logger.exception("ML predicción falló; se responde con datos observados")

    brief = build_answer_brief(
        question=question,
        intent=intent,
        dataset=str(query.get("dataset") or ""),
        rows=rows,
        row_count=row_count,
        recommendations=tips,
        forecast=forecast_text or None,
        forecast_method=forecast_method,
        root_cause=cause,
    )

    answer = await _responder_datos(brief)
    if brief.clarify:
        return {"status": "cannot_answer", "answer": answer}
    if brief.empty and not forecast_text:
        return {"status": "cannot_answer", "answer": answer}
    return {"status": "ok", "answer": answer}
