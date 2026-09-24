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
