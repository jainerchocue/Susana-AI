"""Causa raíz operativa lite — observación de segmento dominante (no clínica)."""

from __future__ import annotations

from typing import Any

from app.analytics.statistics import safe_number


def root_cause_hint(intent: str, rows: list[dict[str, Any]], question: str) -> str | None:
    """
    Si la pregunta pide 'por qué' / comparación / impulso, y hay breakdown,
    señala el segmento con mayor peso. Es observación operativa, no causalidad clínica.
    """
    q = question.lower()
    quiere = any(
        k in q
        for k in (
            "por que",
            "por qué",
            "porque",
            "impulsa",
            "impulso",
            "causa",
            "explica",
            "compar",
            "mayor",
            "mas alto",
            "más alto",
        )
    )
    # Solo si la pregunta pide explicación/comparación (no en toda ocupación)
    if not quiere:
        return None
    if len(rows) < 2:
        return None

    first = rows[0] if isinstance(rows[0], dict) else None
    if not first:
        return None

    metric_keys = [
        k
        for k in first
        if k.startswith("count")
        or k.startswith("sum_")
        or k.startswith("avg_")
        or k in {"quantity", "total", "wait_minutes"}
    ]
    dim_keys = [
        k
        for k in first
        if k
        not in metric_keys
        and not any(k.startswith(p) for p in ("count", "sum_", "avg_"))
        and k
        not in {"quantity", "value", "threshold", "wait_minutes", "stay_hours", "total"}
    ]
    if not dim_keys or not metric_keys:
        return None

    dim = dim_keys[0]
    metric = metric_keys[0]
    scored: list[tuple[float, str]] = []
    for fila in rows:
        if not isinstance(fila, dict):
            continue
        name = fila.get(dim)
        val = safe_number(fila.get(metric))
        if name is None or val is None:
            continue
        scored.append((val, str(name)))
    if len(scored) < 2:
        return None

    scored.sort(key=lambda x: x[0], reverse=True)
    top_val, top_name = scored[0]
    total = sum(v for v, _ in scored) or 1.0
    pct = (top_val / total) * 100.0

    return (
        f"Observación: «{top_name}» concentra ~{pct:.0f}% del {_label_metric(metric)} "
        f"en este corte ({top_val:.0f} de {total:.0f}). "
        "Eso orienta dónde revisar capacidad o flujo; no implica diagnóstico clínico."
    )


def _label_metric(key: str) -> str:
    if key.startswith("avg_"):
        return "promedio"
    if key.startswith("sum_"):
        return "volumen"
    return "resultado"
