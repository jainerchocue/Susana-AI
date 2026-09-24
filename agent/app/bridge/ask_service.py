"""Orquesta POST /v1/ask.

Roles:
- OpenRouter (LLM): redacta la respuesta del chat en lenguaje natural.
- ML (Random Forest / tendencia): solo predicciones → van como hecho al LLM.
- Plantilla: fallback si no hay key, timeout o alucinación de cifras.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

from app.agent.answer_brief import AnswerBrief, build_answer_brief
from app.agent.predictor import Predictor, extract_series_from_result
from app.agent.recommender import Recommender
from app.agent.root_cause import root_cause_hint
from app.bridge.dsl_planner import (
    aclaracion_si_ambigua,
    consulta_serie_temporal,
    elegir_consulta,
    intent_desde_pregunta,
)
from app.bridge.node_client import ejecutar_en_node
from app.config.settings import settings
from app.llm.client import get_llm_client

logger = logging.getLogger(__name__)

_MAX_ANSWER = 4000
# Margen bajo AGENT_TIMEOUT_MS≈20s (HIS + ML + LLM).
_LLM_BUDGET_S = min(14.0, max(8.0, float(settings.llm_timeout_seconds or 14.0)))

_SYSTEM_CHAT = """Eres Susana-AI, analista de inteligencia operativa del Hospital Susana López de Valencia.
Hablas con directivos y coordinación en español, tono profesional de gestión en salud (no clínico).

REGLAS:
1. Responde SOLO con cifras, unidades y hechos del JSON "hechos". No inventes datos.
2. Si falta un dato, omítelo; no inventes umbrales, camas totales ni causas clínicas.
3. Sin PII, sin SQL, sin consejo clínico (diagnóstico/tratamiento/dosis).
4. Si hay predicción_ml, intégrala como anticipación operativa y di el método en una frase.
5. Prosa fluida (90-150 palabras), sin viñetas etiquetadas tipo DATO:/RECOMENDACIÓN:.
"""


def _etiqueta_intent(intent: str) -> str:
    return {
        "MEDICATION_STOCK": "consumo",
        "WAIT_TIME": "minutos de espera",
        "OCCUPANCY": "ingresos",
        "DEMAND": "ingresos",
        "SURGERY": "cirugías",
    }.get(intent, "actividad")


def _plantilla(brief: AnswerBrief) -> str:
    """Fallback determinístico si OpenRouter no responde."""
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
        if brief.limitations:
            parts.append(brief.limitations[0])
        return " ".join(parts)[:_MAX_ANSWER]

    partes: list[str] = []
    if brief.headline:
        partes.append(brief.headline)
    elif brief.points:
        partes.append(
            "Según "
            + brief.dataset_label
            + ", "
            + "; ".join(f"{p.label}: {p.value}" for p in brief.points[:4])
            + "."
        )
    if brief.ranking and len(brief.ranking) > 1:
        partes.append("En el detalle destacan: " + "; ".join(brief.ranking[:3]) + ".")
    if brief.root_cause:
        partes.append(brief.root_cause)
    if brief.forecast:
        partes.append(brief.forecast if brief.forecast.endswith(".") else brief.forecast + ".")
    if brief.recommendations:
        tip = brief.recommendations[0]
        partes.append(tip if tip.endswith(".") else tip + ".")
    if brief.limitations:
        partes.append(brief.limitations[0])
    return " ".join(p for p in partes if p).strip()[:_MAX_ANSWER]


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


async def _con_openrouter(brief: AnswerBrief) -> str | None:
    """LLM solo redacta; no inventa predicciones (esas vienen del ML en el brief)."""
    client = get_llm_client()
    if not client.is_available or brief.empty:
        return None

    hechos = {
        "pregunta": brief.question,
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
        "limitaciones": brief.limitations[:2],
    }
    user = (
        "Redacta la respuesta del chat para operaciones del hospital.\n"
        "Hechos verificados (única fuente; no inventes nada fuera de aquí):\n"
        f"{json.dumps(hechos, ensure_ascii=False)}"
    )
    try:
        content, _ = await asyncio.wait_for(
            client.chat(
                [
                    {"role": "system", "content": _SYSTEM_CHAT},
                    {"role": "user", "content": user},
                ],
                temperature=0.1,
                max_tokens=380,
            ),
            timeout=_LLM_BUDGET_S,
        )
    except asyncio.TimeoutError:
        logger.warning("OpenRouter timeout (%.0fs); uso plantilla", _LLM_BUDGET_S)
        return None
    except Exception:
        logger.exception("OpenRouter falló; uso plantilla")
        return None

    text = _limpia(content)
    if text and _cifras_ok(brief, text):
        return text[:_MAX_ANSWER]
    if text:
        logger.warning("OpenRouter rechazado por grounding; uso plantilla")
    return None


async def _responder(brief: AnswerBrief) -> str:
    if brief.clarify:
        return brief.clarify[:_MAX_ANSWER]
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

    aclaracion = aclaracion_si_ambigua(question, catalog)
    if aclaracion:
        brief = build_answer_brief(
            question=question,
            intent="CLARIFY",
            dataset="",
            rows=[],
            row_count=0,
            clarify=aclaracion,
        )
        return {"status": "cannot_answer", "answer": await _responder(brief)}

    query = elegir_consulta(question, catalog, max_rows=max_rows)
    if not query:
        brief = build_answer_brief(
            question=question,
            intent="GENERAL_ANALYTICS",
            dataset="",
            rows=[],
            row_count=0,
            clarify=(
                "No tengo un conjunto de datos disponible con sus permisos "
                "para responder esa pregunta. Pruebe con ocupación, esperas, "
                "medicamentos o cirugías."
            ),
        )
        return {"status": "cannot_answer", "answer": await _responder(brief)}

    resultado = await ejecutar_en_node(ticket, query)
    if not resultado:
        brief = build_answer_brief(
            question=question,
            intent=intent_desde_pregunta(question),
            dataset=str(query.get("dataset") or ""),
            rows=[],
            row_count=0,
            clarify=(
                "No pude obtener datos del sistema en este momento. "
                "Intente de nuevo en unos segundos."
            ),
        )
        return {"status": "cannot_answer", "answer": await _responder(brief)}

    intent = intent_desde_pregunta(question)
    rows = resultado.get("rows") or []
    if not isinstance(rows, list):
        rows = []
    row_count = int(resultado.get("rowCount") or len(rows))
    columns = list(rows[0].keys()) if rows and isinstance(rows[0], dict) else []

    tips = Recommender().recommend(intent, rows, columns)
    cause = root_cause_hint(intent, rows, question)

    # ML: solo predicción (hecho para el LLM)
    forecast_text = ""
    forecast_method: str | None = None
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

    answer = await _responder(brief)
    if brief.clarify:
        return {"status": "cannot_answer", "answer": answer}
    if brief.empty and not forecast_text:
        return {"status": "cannot_answer", "answer": answer}
    return {"status": "ok", "answer": answer}
