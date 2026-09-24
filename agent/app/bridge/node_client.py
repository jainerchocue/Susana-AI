"""Cliente HTTP hacia el puerto interno de Node (ejecuta el DSL)."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config.settings import settings

logger = logging.getLogger(__name__)


async def ejecutar_en_node(ticket: str, query: dict[str, Any]) -> dict[str, Any] | None:
    """
    POST {NODE_INTERNAL_URL}/internal/agent/query
    Header: x-internal-key = NODE_INTERNAL_API_KEY (INTERNAL_API_KEY de Node)

    Respuesta esperada: { "success": true, "data": { "rows", "rowCount", ... } }
    """
    base = settings.node_internal_url.rstrip("/")
    key = settings.node_internal_api_key.strip()
    if not key:
        logger.warning("NODE_INTERNAL_API_KEY vacía: no se puede llamar a Node")
        return None

    url = f"{base}/internal/agent/query"
    try:
        async with httpx.AsyncClient(timeout=settings.node_query_timeout_seconds) as client:
            resp = await client.post(
                url,
                headers={
                    "content-type": "application/json",
                    "x-internal-key": key,
                },
                json={"ticket": ticket, "query": query},
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Error llamando a Node interno: %s", exc)
        return None

    if resp.status_code < 200 or resp.status_code >= 300:
        logger.warning("Node interno HTTP %s", resp.status_code)
        return None

    try:
        body = resp.json()
    except Exception:  # noqa: BLE001
        return None

    if isinstance(body, dict) and body.get("success") and isinstance(body.get("data"), dict):
        return body["data"]
    # Algunos stubs podrían devolver data directa
    if isinstance(body, dict) and "rows" in body:
        return body
    return None
