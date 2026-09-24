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
    consulta_serie_temporal,
    elegir_consulta,
    intent_desde_pregunta,
)
from app.bridge.node_client import ejecutar_en_node
from app.config.settings import settings
from app.llm.client import get_llm_client

logger = logging.getLogger(__name__)

_MAX_ANSWER = 4000
_LLM_BUDGET_S = min(14.0, max(8.0, float(settings.llm_timeout_seconds or 14.0)))

_SYSTEM_DATOS = """Eres Susana-AI, analista de inteligencia operativa del Hospital Susana López de Valencia.
Hablas con directivos y coordinación en español, tono profesional de gestión en salud (no clínico).

REGLAS:
1. Contesta la pregunta del usuario de forma natural. El primer párrafo debe responderla.
2. Usa SOLO cifras y nombres del JSON "hechos". No inventes datos.
3. Si hay prediccion_ml (proyección), intégrala con claridad; sin jerga (nada de MAE, lag, holdout).
4. Sin PII, sin SQL, sin consejo clínico.
5. Prosa fluida (80-140 palabras). Suenas a analista senior, no a menú de opciones.
"""

_SYSTEM_CHAT = """Eres Susana-AI, asistente de inteligencia operativa del Hospital Susana López de Valencia.
Hablas en español, cercano y profesional (gestión hospitalaria, no clínico).

Puedes ayudar con: ocupación y camas, tiempos de espera, medicamentos/farmacia,
cirugías, alertas operativas y proyecciones de demanda (con datos del HIS autorizados).

REGLAS:
1. Responde siempre en lenguaje natural, como una AI útil del hospital.
2. Si saludan o preguntan en qué ayudas: preséntate brevemente y ofrece 2–4 temas concretos.
3. No inventes cifras del hospital: sin consulta a datos no des números de ocupación, esperas ni stock.
4. Sin consejo clínico, sin PII, sin SQL.
5. Máximo ~100 palabras. Invita a formular una pregunta operativa.
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
    if brief.clarify:
        return brief.clarify[:_MAX_ANSWER]
    if brief.empty:
        parts = [
            brief.empty_reason
            or "Con la información disponible no puedo responder esa consulta con seguridad."
        ]
        if brief.forecast:
            parts.append(brief.forecast)
        if brief.recommendations:
            parts.append(brief.recommendations[0])
        return " ".join(parts)[:_MAX_ANSWER]

    proy = _es_proyeccion(brief.question)
    partes: list[str] = []
    if proy and brief.forecast:
        partes.append(brief.forecast if brief.forecast.endswith(".") else brief.forecast + ".")
        if brief.ranking:
            partes.append(
                "Como contexto del corte actual, las unidades con más carga son: "
                + "; ".join(brief.ranking[:3])
                + "."
            )
        if brief.recommendations:
            tip = brief.recommendations[0]
            partes.append(tip if tip.endswith(".") else tip + ".")
        return " ".join(partes)[:_MAX_ANSWER]

    if brief.headline:
        partes.append(brief.headline)
    if brief.ranking and len(brief.ranking) > 1 and not proy:
        partes.append("En el detalle destacan: " + "; ".join(brief.ranking[:3]) + ".")
    if brief.root_cause:
        partes.append(brief.root_cause)
    if brief.forecast:
        partes.append(brief.forecast if brief.forecast.endswith(".") else brief.forecast + ".")
    if brief.recommendations:
        tip = brief.recommendations[0]
        partes.append(tip if tip.endswith(".") else tip + ".")
    return " ".join(p for p in partes if p).strip()[:_MAX_ANSWER]


_FALLBACK_CHAT = (
    "Soy Susana-AI, asistente de inteligencia operativa del Hospital Susana López de Valencia. "
    "Puedo ayudarle con ocupación y camas, tiempos de espera, medicamentos, cirugías "
    "y proyecciones de demanda usando los datos autorizados del hospital. "
    "¿Sobre qué tema quiere consultar?"
)


def _limpia(text: str | None) -> str | None:
    if not text:
        return None
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json|markdown|text)?\s*", "", t)
        t = re.sub(r"\s*```$", "", t)
    return t.strip().strip('"') or None


def _cifras_ok(brief: AnswerBrief, text: str) -> bool:
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
            client.chat(messages, temperature=0.3, max_tokens=max_tokens),
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
        max_tokens=220,
    )
    return (text or _FALLBACK_CHAT)[:_MAX_ANSWER]


async def _con_openrouter(brief: AnswerBrief) -> str | None:
    """Redacta con hechos del HIS (+ ML)."""
    if brief.empty and not brief.forecast:
        return None

    proy = _es_proyeccion(brief.question)
    hechos: dict[str, Any] = {
        "pregunta": brief.question,
        "foco": "proyeccion" if proy and brief.forecast else "descriptivo",
        "intent": brief.intent,
        "fuente": brief.dataset_label,
        "registros": brief.row_count,
        "dato_principal": brief.headline,
        "puntos": [p.model_dump() for p in brief.points],
        "ranking": brief.ranking[:5],
        "prediccion_ml": brief.forecast,
        "metodo_ml": brief.forecast_method,
        "recomendacion_operativa": brief.recommendations[:2],
        "observacion": brief.root_cause,
    }
    if proy and brief.forecast:
        hechos = {
            "pregunta": brief.question,
            "foco": "proyeccion",
            "prediccion_ml": brief.forecast,
            "metodo_ml": brief.forecast_method,
            "contexto_unidades": brief.ranking[:3],
            "recomendacion_operativa": brief.recommendations[:1],
        }

    text = await _llm_chat(
        [
            {"role": "system", "content": _SYSTEM_DATOS},
            {
                "role": "user",
                "content": (
                    "Contesta con naturalidad usando SOLO estos hechos verificados.\n"
                    f"{json.dumps(hechos, ensure_ascii=False)}"
                ),
            },
        ],
        max_tokens=380,
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
    row_count = int(resultado.get("rowCount") or len(rows))
    columns = list(rows[0].keys()) if rows and isinstance(rows[0], dict) else []

    tips = Recommender().recommend(intent, rows, columns)
    cause = root_cause_hint(intent, rows, question)

    forecast_text = ""
    forecast_method: str | None = None
    # Serie temporal / ML solo si la pregunta pide proyección o hay señal temporal
    if _es_proyeccion(question) or intent in {"OCCUPANCY", "DEMAND", "WAIT_TIME"}:
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
