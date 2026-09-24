"""Response models for analyze / interpret / health."""

from typing import Any, Literal

from pydantic import BaseModel, Field

ConfidenceLevel = Literal["HIGH", "MEDIUM", "LOW"]


class ProposedQuery(BaseModel):
    intent: str
    sql: str
    parameters: dict[str, Any] = Field(default_factory=dict)
    tables: list[str] = Field(default_factory=list)
    columns: list[str] = Field(default_factory=list)
    explanation: str = ""
    plan: dict[str, Any] = Field(default_factory=dict)


class VisualizationHint(BaseModel):
    type: str | None = None
    x: str | None = None
    y: str | None = None
    title: str | None = None


class AnalyzeResponse(BaseModel):
    """Python proposes SQL; Node.js validates and executes."""

    intent: str
    proposed_query: ProposedQuery | None = None
    answer: str | None = None
    insights: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    visualization: VisualizationHint | dict[str, Any] = Field(default_factory=dict)
    data: list[dict[str, Any]] = Field(default_factory=list)
    confidence: ConfidenceLevel | None = None
    rejected: bool = False
    rejection_reason: str | None = None
    fallback_used: bool = False
    processing_ms: float | None = None
    model_used: str | None = None
    validation: dict[str, Any] = Field(default_factory=dict)


class InterpretResponse(BaseModel):
    answer: str
    intent: str
    insights: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    visualization: VisualizationHint | dict[str, Any] = Field(default_factory=dict)
    data: list[dict[str, Any]] = Field(default_factory=list)
    confidence: ConfidenceLevel | None = None
    processing_ms: float | None = None
    model_used: str | None = None


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    llm_configured: bool
    schema_version: str
