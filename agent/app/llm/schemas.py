"""Pydantic models for structured LLM I/O."""

from typing import Any, Literal

from pydantic import BaseModel, Field

IntentLabel = Literal[
    "OCCUPANCY",
    "WAIT_TIME",
    "MEDICATION_STOCK",
    "MEDICATION_CONSUMPTION",
    "DEMAND",
    "SURGERY",
    "TRIAGE",
    "SERVICE_ANALYSIS",
    "GENERAL_ANALYTICS",
    "ROOT_CAUSE",
    "RECOMMENDATION",
    "OUT_OF_DOMAIN",
    "UNKNOWN",
]


class IntentResult(BaseModel):
    intent: IntentLabel | str = "UNKNOWN"
    entities: list[str] = Field(default_factory=list)
    confidence: Literal["HIGH", "MEDIUM", "LOW"] = "MEDIUM"
    out_of_domain: bool = False
    reason: str | None = None


class QueryPlan(BaseModel):
    intent: str
    entities: list[str] = Field(default_factory=list)
    filters: list[str] = Field(default_factory=list)
    metrics: list[str] = Field(default_factory=list)
    sort: str | None = None
    limit: int = 100
    tables: list[str] = Field(default_factory=list)
    notes: str | None = None


class NL2SQLResult(BaseModel):
    intent: str
    sql: str
    parameters: dict[str, Any] = Field(default_factory=dict)
    tables: list[str] = Field(default_factory=list)
    columns: list[str] = Field(default_factory=list)
    explanation: str = ""


class InterpretationResult(BaseModel):
    answer: str
    insights: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    visualization: dict[str, Any] = Field(default_factory=dict)
    confidence: Literal["HIGH", "MEDIUM", "LOW"] = "MEDIUM"
