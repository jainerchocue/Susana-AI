"""Orquesta POST /v1/ask — contrato Node (Susana-AI)."""

from __future__ import annotations

import logging
from typing import Any

from app.agent.predictor import Predictor, extract_series_from_result
from app.agent.recommender import Recommender
from app.bridge.dsl_planner import consulta_serie_temporal, elegir_consulta, intent_desde_pregunta
from app.bridge.node_client import ejecutar_en_node

logger = logging.getLogger(__name__)


def _etiqueta_intent(intent: str) -> str:
    return {
        "MEDICATION_STOCK": "consumo/stock",
        "WAIT_TIME": "minutos de espera",
        "OCCUPANCY": "ingresos / ocupación",
        "DEMAND": "ingresos",
        "SURGERY": "cirugías",
    }.get(intent, "actividad")


def _redactar(
    query: dict[str, Any],
    resultado: dict[str, Any],
    recommendations: list[str],
    forecast: str | None = None,
) -> str:
    rows = resultado.get("rows") or []
    row_count = resultado.get("rowCount", len(rows))
    dataset = query.get("dataset", "?")

    if row_count == 0 or not rows:
        base = (
            f"No encontré datos en «{dataset}» para responder esa pregunta "
            "con la información disponible."
        )
        if forecast:
            return f"{base} {forecast}"[:4000]
        return base

    # Resumen de primeras filas (lenguaje claro)
    preview_bits: list[str] = []
    for fila in rows[:5]:
        if not isinstance(fila, dict):
            continue
        partes = [f"{k}={v}" for k, v in list(fila.items())[:4]]
        preview_bits.append(", ".join(partes))
    resumen = " | ".join(preview_bits)

    partes_out = [
        f"Según los datos de «{dataset}» ({row_count} fila(s)): {resumen}."
    ]
    if forecast:
        partes_out.append(forecast)
    if recommendations:
        partes_out.append("Para decidir ahora: " + " ".join(recommendations[:3]))
    return " ".join(partes_out)[:4000]


async def handle_ask(
    *,
    question: str,
    ticket: str,
    catalog: list[dict[str, Any]],
    limits: dict[str, Any] | None = None,
) -> dict[str, str]:
    limits = limits or {}
    max_rows = int(limits.get("maxRows") or 100)

    query = elegir_consulta(question, catalog, max_rows=max_rows)
    if not query:
        return {
            "status": "cannot_answer",
            "answer": "No tengo un dataset disponible para responder eso con tus permisos.",
        }

    resultado = await ejecutar_en_node(ticket, query)
    if not resultado:
        return {
            "status": "cannot_answer",
            "answer": "No pude obtener datos del sistema para responder.",
        }

    intent = intent_desde_pregunta(question)
    rows = resultado.get("rows") or []
    if not isinstance(rows, list):
        rows = []
    columns = list(rows[0].keys()) if rows and isinstance(rows[0], dict) else []
    tips = Recommender().recommend(intent, rows, columns)

    # Anticipación: serie temporal aparte (o la misma si ya viene por día).
    forecast_text = ""
    try:
        serie_query = consulta_serie_temporal(question, catalog, max_rows=min(max_rows, 60))
        serie_resultado = resultado
        if serie_query and serie_query != query:
            extra = await ejecutar_en_node(ticket, serie_query)
            if extra and (extra.get("rows") or []):
                serie_resultado = extra

        series, ctx = extract_series_from_result(serie_resultado)
        # Solo proyectar si hay eje temporal; un ranking por medicamento no es serie.
        if series and ctx.get("date_field"):
            forecast_text = Predictor().forecast_message(
                series,
                label=_etiqueta_intent(intent),
                context=ctx,
            )
    except Exception:
        logger.exception("No se pudo calcular la anticipación; se responde solo con datos")

    return {
        "status": "ok",
        "answer": _redactar(query, resultado, tips, forecast_text or None),
    }
