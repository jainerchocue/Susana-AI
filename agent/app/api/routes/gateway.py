"""Contrato oficial Node ↔ Python: GET /health, POST /v1/ask."""

from __future__ import annotations

import hmac
from typing import Any, Literal

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, Field

from app.bridge.ask_service import handle_ask
from app.config.settings import settings

router = APIRouter(tags=["gateway-node"])


class CatalogDimension(BaseModel):
    name: str
    type: str = "string"
    description: str = ""
    # Vocabulario real (valores posibles) que manda Node: el agente filtra solo con estos.
    values: list[str] = Field(default_factory=list, max_length=200)


class CatalogMeasure(BaseModel):
    name: str
    description: str = ""


class CatalogEntry(BaseModel):
    dataset: str
    description: str = ""
    dimensions: list[CatalogDimension] = Field(default_factory=list)
    measures: list[CatalogMeasure] = Field(default_factory=list)


class AskLimits(BaseModel):
    maxQueries: int = 3
    maxRows: int = 100


class AskContext(BaseModel):
    # "Hoy" de los datos (último ingreso importado): "hoy"/"esta semana" se calculan desde aquí.
    referenceDate: str | None = None
    # Primer registro HIS: un periodo que empieza antes está incompleto.
    dataStart: str | None = None
    timezone: str = "America/Bogota"


class AskRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    ticket: str = Field(..., min_length=1, max_length=200)
    catalog: list[CatalogEntry] = Field(default_factory=list)
    limits: AskLimits = Field(default_factory=AskLimits)
    context: AskContext = Field(default_factory=AskContext)


class AskResponse(BaseModel):
    status: Literal["ok", "cannot_answer"]
    answer: str = Field(..., max_length=4000)


def _require_ask_key(x_internal_key: str | None) -> None:
    expected = settings.agent_api_key.strip()
    if not expected or not x_internal_key or not hmac.compare_digest(x_internal_key, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="clave invalida",
        )


@router.get("/health")
async def health_gateway() -> dict[str, str]:
    """Liveness que Node usa en /health/ready (pingAgente)."""
    return {"status": "up"}


@router.post("/v1/ask", response_model=AskResponse)
async def v1_ask(
    body: AskRequest,
    x_internal_key: str | None = Header(default=None, alias="X-Internal-Key"),
) -> AskResponse:
    _require_ask_key(x_internal_key)
    catalog_raw: list[dict[str, Any]] = [c.model_dump() for c in body.catalog]
    result = await handle_ask(
        question=body.question,
        ticket=body.ticket,
        catalog=catalog_raw,
        limits=body.limits.model_dump(),
        context=body.context.model_dump(),
    )
    return AskResponse(status=result["status"], answer=result["answer"])
