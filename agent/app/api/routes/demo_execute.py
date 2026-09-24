"""Demo-only: execute validated SELECT on hospital.db (learning UI)."""

from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.dependencies import verify_api_key
from app.config.settings import settings
from app.security.query_analyzer import QueryAnalyzer

router = APIRouter()


class ExecuteRequest(BaseModel):
    sql: str = Field(..., min_length=1, max_length=20_000)


class ExecuteResponse(BaseModel):
    rows: list[dict[str, Any]]
    columns: list[str]
    row_count: int
    note: str = "Solo para demo local. En producción Node.js ejecuta tras validar/autorizar."


@router.post("/demo-execute", response_model=ExecuteResponse)
async def demo_execute(
    body: ExecuteRequest,
    _api_key: str = Depends(verify_api_key),
) -> ExecuteResponse:
    """Ejecuta SQL ya validado — SOLO en development, para ver el flujo en el HTML."""
    if settings.app_env == "production":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="demo-execute deshabilitado en production",
        )

    analyzer = QueryAnalyzer()
    validation = analyzer.validate(body.sql)
    if not validation.valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"message": "SQL rechazado", "errors": validation.errors},
        )

    sql = validation.normalized_sql or body.sql
    db_path = settings.sqlite_path
    if not db_path.exists():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"No existe {db_path}. Corre: python -m data.load_data",
        )

    try:
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        cur = conn.execute(sql)
        rows = [dict(r) for r in cur.fetchall()]
        columns = list(rows[0].keys()) if rows else [d[0] for d in cur.description or []]
        conn.close()
    except sqlite3.Error as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error al ejecutar SQL: {exc}",
        ) from exc

    return ExecuteResponse(rows=rows[:200], columns=columns, row_count=len(rows))
