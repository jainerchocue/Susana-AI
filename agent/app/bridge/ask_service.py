"""Orquesta POST /v1/ask — contrato Node (Susana-AI)."""

from __future__ import annotations

import logging
from typing import Any

from app.agent.recommender import Recommender
from app.bridge.dsl_planner import elegir_consulta, intent_desde_pregunta
from app.bridge.node_client import ejecutar_en_node

logger = logging.getLogger(__name__)


def _redactar(query: dict[str, Any], resultado: dict[str, Any], recommendations: list[str]) -> str:
    rows = resultado.get("rows") or []
    row_count = resultado.get("rowCount", len(rows))
    dataset = query.get("dataset", "?")

    if row_count == 0 or not rows:
        return (
            f"No encontré datos en «{dataset}» para responder esa pregunta "
            "con la información disponible."
        )

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
    if recommendations:
        partes_out.append("Sugerencias: " + " ".join(recommendations[:3]))
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

    return {
        "status": "ok",
        "answer": _redactar(query, resultado, tips),
    }
