"""Orquesta POST /v1/ask — Node ejecuta datos; el agente narra con hechos."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.agent.answer_brief import build_answer_brief
from app.agent.narrative import render_narrative_async
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

logger = logging.getLogger(__name__)


def _etiqueta_intent(intent: str) -> str:
    return {
        "MEDICATION_STOCK": "consumo",
        "WAIT_TIME": "minutos de espera",
        "OCCUPANCY": "ingresos",
        "DEMAND": "ingresos",
        "SURGERY": "cirugías",
    }.get(intent, "actividad")


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
        return {"status": "cannot_answer", "answer": await render_narrative_async(brief)}

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
        return {"status": "cannot_answer", "answer": await render_narrative_async(brief)}

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
        return {"status": "cannot_answer", "answer": await render_narrative_async(brief)}

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
    try:
        serie_query = consulta_serie_temporal(question, catalog, max_rows=min(max_rows, 60))
        serie_resultado = resultado
        if serie_query and serie_query != query:
            extra = await ejecutar_en_node(ticket, serie_query)
            if extra and (extra.get("rows") or []):
                serie_resultado = extra

        series, ctx = extract_series_from_result(serie_resultado)
        if series and ctx.get("date_field"):
            # RF es CPU-bound: fuera del event loop para no congelar uvicorn
            forecast_text, forecast_method = await asyncio.to_thread(
                Predictor().forecast_facts,
                series,
                label=_etiqueta_intent(intent),
                context=ctx,
            )
    except Exception:
        logger.exception("No se pudo calcular la anticipación; se responde solo con datos")

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

    answer = await render_narrative_async(brief)
    if brief.clarify:
        return {"status": "cannot_answer", "answer": answer}
    if brief.empty and not forecast_text:
        return {"status": "cannot_answer", "answer": answer}
    return {"status": "ok", "answer": answer}
