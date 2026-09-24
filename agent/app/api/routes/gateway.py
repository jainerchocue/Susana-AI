"""Contrato oficial Node ↔ Python: GET /health, POST /v1/ask."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, Field

from app.bridge.ask_service import handle_ask
from app.config.settings import settings

router = APIRouter(tags=["gateway-node"])


class CatalogDimension(BaseModel):
    name: str
    type: str = "string"
    description: str = ""


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


class AskRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    ticket: str
    catalog: list[CatalogEntry] = Field(default_factory=list)
    limits: AskLimits = Field(default_factory=AskLimits)


class AskResponse(BaseModel):
    status: str  # ok | cannot_answer
    answer: str


def _require_ask_key(x_internal_key: str | None) -> None:
    expected = settings.expected_ask_key()
    if not expected or not x_internal_key or x_internal_key != expected:
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
    )
    return AskResponse(status=result["status"], answer=result["answer"])
