"""Standard response formatting for Node.js / React consumers."""

from __future__ import annotations

from typing import Any

from app.llm.schemas import InterpretationResult, NL2SQLResult, QueryPlan
from app.models.response import (
    AnalyzeResponse,
    InterpretResponse,
    ProposedQuery,
    VisualizationHint,
)
from app.security.query_analyzer import ValidationResult


def format_analyze_response(
    *,
    intent: str,
    nl2sql: NL2SQLResult | None,
    plan: QueryPlan | None,
    validation: ValidationResult | None,
    rejected: bool = False,
    rejection_reason: str | None = None,
    fallback_used: bool = False,
    processing_ms: float | None = None,
    model_used: str | None = None,
    confidence: str | None = "MEDIUM",
) -> AnalyzeResponse:
    proposed = None
    if nl2sql and not rejected:
        sql = nl2sql.sql
        if validation and validation.normalized_sql:
            sql = validation.normalized_sql
        proposed = ProposedQuery(
            intent=nl2sql.intent or intent,
            sql=sql,
            parameters=nl2sql.parameters,
            tables=nl2sql.tables or (plan.tables if plan else []),
            columns=nl2sql.columns,
            explanation=nl2sql.explanation,
            plan=plan.model_dump() if plan else {},
        )

    val_dict: dict[str, Any] = {}
    if validation:
        val_dict = {
            "valid": validation.valid,
            "errors": validation.errors,
            "warnings": validation.warnings,
            "tables": validation.tables,
            "columns": validation.columns,
            "has_limit": validation.has_limit,
        }

    return AnalyzeResponse(
        intent=intent,
        proposed_query=proposed,
        confidence=confidence if confidence in {"HIGH", "MEDIUM", "LOW"} else "MEDIUM",
        rejected=rejected,
        rejection_reason=rejection_reason,
        fallback_used=fallback_used,
        processing_ms=processing_ms,
        model_used=model_used,
        validation=val_dict,
    )


def format_interpret_response(
    *,
    intent: str,
    interpretation: InterpretationResult,
    rows: list[dict[str, Any]],
    processing_ms: float | None = None,
    model_used: str | None = None,
) -> InterpretResponse:
    viz = interpretation.visualization or {}
    visualization: VisualizationHint | dict[str, Any]
    if viz and isinstance(viz, dict) and viz.get("type"):
        visualization = VisualizationHint(
            type=viz.get("type"),
            x=viz.get("x"),
            y=viz.get("y"),
            title=viz.get("title"),
        )
    else:
        visualization = viz

    return InterpretResponse(
        answer=interpretation.answer,
        intent=intent,
        insights=interpretation.insights,
        recommendations=interpretation.recommendations,
        visualization=visualization,
        data=rows[:100],
        confidence=interpretation.confidence,
        processing_ms=processing_ms,
        model_used=model_used,
    )
