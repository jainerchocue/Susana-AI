"""Simple statistical helpers for interpretation / trends."""

from __future__ import annotations

from typing import Any


def safe_number(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def mean(values: list[float]) -> float | None:
    nums = [v for v in values if v is not None]
    if not nums:
        return None
    return sum(nums) / len(nums)


def moving_average(values: list[float], window: int = 3) -> list[float | None]:
    if window <= 0:
        return [None] * len(values)
    out: list[float | None] = []
    for i in range(len(values)):
        start = max(0, i - window + 1)
        chunk = values[start : i + 1]
        out.append(sum(chunk) / len(chunk) if chunk else None)
    return out


def simple_trend(values: list[float]) -> str:
    """Explainable trend label — not ML."""
    if len(values) < 2:
        return "insuficiente"
    first_half = mean(values[: len(values) // 2]) or 0
    second_half = mean(values[len(values) // 2 :]) or 0
    if second_half > first_half * 1.1:
        return "creciente"
    if second_half < first_half * 0.9:
        return "decreciente"
    return "estable"


def summarize_numeric_column(rows: list[dict[str, Any]], column: str) -> dict[str, Any]:
    values = [safe_number(r.get(column)) for r in rows]
    nums = [v for v in values if v is not None]
    if not nums:
        return {"column": column, "count": 0}
    return {
        "column": column,
        "count": len(nums),
        "min": min(nums),
        "max": max(nums),
        "mean": mean(nums),
        "trend": simple_trend(nums),
    }
