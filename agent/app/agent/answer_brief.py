"""Hechos estructurados a partir de filas HIS — base para narrativa."""

from __future__ import annotations

from typing import Any
import unicodedata

from pydantic import BaseModel, Field

from app.analytics.statistics import safe_number

# Etiquetas humanas para columnas DSL / HIS
_LABELS: dict[str, str] = {
    "unit": "unidad",
    "subunit": "subunidad",
    "code": "código",
    "triage_level": "nivel de triage",
    "type": "tipo",
    "severity": "severidad",
    "status": "estado",
    "executed": "ejecutada",
    "area": "área",
    "specialty": "especialidad",
    "admission_class": "clase de ingreso",
    "entry_route": "vía de ingreso",
    "count_all": "cantidad",
    "count": "cantidad",
    "sum_quantity": "cantidad dispensada",
    "quantity": "cantidad",
    "avg_wait_minutes": "espera promedio (min)",
    "wait_minutes": "espera (min)",
    "stay_hours": "estancia (h)",
    "min_value": "días de inventario",
    "value": "días de inventario",
    "scope_id": "código",
    "threshold": "umbral (días)",
    "admitted_at": "fecha",
    "dispensed_at": "fecha",
    "provided_at": "fecha",
    "camas_ocupadas": "camas ocupadas",
    "total": "total",
}


class FactPoint(BaseModel):
    label: str
    value: str


class AnswerBrief(BaseModel):
    """Hechos validados; el narrador solo puede hablar de esto."""

    question: str
    intent: str
    dataset: str
    dataset_label: str
    row_count: int = 0
    empty: bool = False
    empty_reason: str | None = None
    clarify: str | None = None
    headline: str | None = None
    points: list[FactPoint] = Field(default_factory=list)
    ranking: list[str] = Field(default_factory=list)
    forecast: str | None = None
    forecast_method: str | None = None
    recommendations: list[str] = Field(default_factory=list)
    root_cause: str | None = None
    limitations: list[str] = Field(default_factory=list)

    def allowed_numbers(self) -> set[str]:
        """Números que el LLM puede mencionar (grounding)."""
        nums: set[str] = set()
        if self.row_count:
            nums.add(str(self.row_count))
        blob = " ".join(
            [
                self.headline or "",
                " ".join(p.value for p in self.points),
                " ".join(self.ranking),
                self.forecast or "",
                " ".join(self.recommendations),
                self.root_cause or "",
            ]
        )
        import re

        for m in re.findall(r"-?\d+(?:[.,]\d+)?", blob):
            nums.add(m.replace(",", "."))
            nums.add(m.split(".")[0].split(",")[0])
        return nums


def _label(key: str) -> str:
    return _LABELS.get(key, key.replace("_", " "))


def _dataset_label(dataset: str) -> str:
    return {
        "admissions": "ingresos hospitalarios",
        "medications": "dispensaciones de medicamentos",
        "services": "servicios prestados",
        "surgeries": "programación de cirugías",
        "alerts": "alertas operativas",
    }.get(dataset, dataset)


def _dim_keys(row: dict[str, Any]) -> list[str]:
    skip_prefix = ("count", "sum_", "avg_", "min_", "max_")
    skip = {"quantity", "value", "threshold", "wait_minutes", "stay_hours", "total"}
    out = []
    for k, v in row.items():
        if v is None or v == "":
            continue
        if k in skip or any(k.startswith(p) for p in skip_prefix):
            continue
        if safe_number(v) is not None and k not in (
            "triage_level",
        ):
            # triage_level es dimensión categórica numérica
            if k != "triage_level":
                continue
        out.append(k)
    return out


def _metric_keys(row: dict[str, Any]) -> list[str]:
    keys = []
    for k in row:
        if (
            k.startswith("count")
            or k.startswith("sum_")
            or k.startswith("avg_")
            or k.startswith("min_")
            or k.startswith("max_")
            or k in {"quantity", "value", "wait_minutes", "stay_hours", "total", "camas_ocupadas", "min_value"}
        ):
            keys.append(k)
    return keys


def _fmt_val(v: Any) -> str:
    n = safe_number(v)
    if n is not None:
        if abs(n - round(n)) < 1e-9:
            return str(int(round(n)))
        return f"{n:.1f}"
    return str(v)


def build_answer_brief(
    *,
    question: str,
    intent: str,
    dataset: str,
    rows: list[dict[str, Any]],
    row_count: int,
    recommendations: list[str] | None = None,
    forecast: str | None = None,
    forecast_method: str | None = None,
    root_cause: str | None = None,
    clarify: str | None = None,
    limitations: list[str] | None = None,
) -> AnswerBrief:
    ds_label = _dataset_label(dataset)
    if clarify:
        return AnswerBrief(
            question=question,
            intent=intent,
            dataset=dataset,
            dataset_label=ds_label,
            empty=True,
            clarify=clarify,
            limitations=limitations or [],
        )

    if row_count == 0 or not rows:
        return AnswerBrief(
            question=question,
            intent=intent,
            dataset=dataset,
            dataset_label=ds_label,
            row_count=0,
            empty=True,
            empty_reason=(
                "No encontré registros para esa consulta con los filtros y permisos actuales. "
                "Puede tratarse de un corte sin actividad o de un nombre de unidad distinto en el HIS."
            ),
            forecast=forecast,
            forecast_method=forecast_method,
            recommendations=recommendations or [],
            limitations=limitations or [],
        )

    clean = [r for r in rows if isinstance(r, dict)]
    if not clean:
        return AnswerBrief(
            question=question,
            intent=intent,
            dataset=dataset,
            dataset_label=ds_label,
            row_count=0,
            empty=True,
            empty_reason=(
                f"No encontré registros en {ds_label} para esa consulta "
                "con los filtros y permisos actuales."
            ),
            forecast=forecast,
            forecast_method=forecast_method,
            recommendations=recommendations or [],
            limitations=limitations or [],
        )

    first = clean[0]
    dims = _dim_keys(first)
    metrics = _metric_keys(first)
    q_low = question.lower()
    q_norm = "".join(
        c for c in unicodedata.normalize("NFD", q_low) if unicodedata.category(c) != "Mn"
    )

    # Orden: inventario ASC (menos días primero); resto DESC
    if metrics and len(clean) > 1:
        mkey = metrics[0]
        reverse = not (
            dataset == "alerts"
            or "inventario" in q_norm
            or mkey in {"min_value", "value", "avg_wait_minutes"}
        )
        # wait: keep triage order later; inventario: asc

        def _sort_key(fila: dict[str, Any]) -> float:
            n = safe_number(fila.get(mkey))
            return float(n) if n is not None else (-1.0 if reverse else 1e18)

        if "inventario" in q_norm or dataset == "alerts":
            clean = sorted(clean, key=_sort_key, reverse=False)
        elif "espera" not in q_norm:
            clean = sorted(clean, key=_sort_key, reverse=True)
        first = clean[0]

    points: list[FactPoint] = []
    ranking: list[str] = []
    headline: str | None = None

    # ── Headlines profesionales según la pregunta ──
    if "espera" in q_norm and metrics:
        mkey = metrics[0] if metrics else "avg_wait_minutes"
        vals = [safe_number(r.get(mkey)) for r in clean]
        vals_f = [float(v) for v in vals if v is not None]
        if vals_f:
            promedio = sum(vals_f) / len(vals_f)
            headline = (
                f"El tiempo de espera promedio en el corte consultado es de "
                f"{promedio:.1f} minutos."
            )
            if dims:
                dim = dims[0]
                for fila in clean[:5]:
                    name = fila.get(dim)
                    mv = fila.get(mkey)
                    if name is not None and mv is not None:
                        ranking.append(f"triage {name}: {_fmt_val(mv)} min")

    elif ("inventario" in q_norm or dataset == "alerts") and metrics:
        mkey = "min_value" if any("min_value" in r for r in clean) else (metrics[0] if metrics else "value")
        dim = "scope_id" if any("scope_id" in r for r in clean) else (dims[0] if dims else None)
        for fila in clean[:8]:
            code = fila.get(dim) if dim else None
            dias = fila.get(mkey)
            if code is not None and dias is not None:
                ranking.append(f"{code}: {_fmt_val(dias)} días")
        if ranking:
            headline = (
                f"Hay {len(ranking)} medicamento(s)/código(s) con inventario bajo "
                f"en alertas activas. El más crítico es «{clean[0].get(dim)}» "
                f"con {_fmt_val(clean[0].get(mkey))} días estimados."
            )
        else:
            headline = "No hay alertas de inventario bajo activas en este momento."

    elif "uci" in q_norm and metrics:
        mkey = metrics[0]
        total = 0.0
        for fila in clean:
            n = safe_number(fila.get(mkey))
            if n is not None:
                total += float(n)
            if dims:
                dim = dims[0]
                name = fila.get(dim)
                if name is not None and n is not None:
                    ranking.append(f"{name}: {_fmt_val(n)}")
        periodo = "hoy" if "hoy" in q_norm else "en el corte consultado"
        headline = (
            f"En UCI, {periodo}, se registran {int(total)} ingresos "
            f"(actividad asociada a unidades/subunidades de cuidado intensivo)."
        )
        lims_extra = (
            "El HIS no expone un contador de camas físicas; "
            "la cifra corresponde a ingresos/actividad en UCI."
        )
        limitations = list(limitations or []) + [lims_extra]

    elif len(clean) > 1 and dims:
        dim = dims[0]
        metric = metrics[0] if metrics else None
        for fila in clean[:5]:
            name = fila.get(dim)
            if name is None:
                continue
            if metric and fila.get(metric) is not None:
                ranking.append(f"{name}: {_fmt_val(fila.get(metric))}")
            else:
                ranking.append(str(name))
        top_name = clean[0].get(dim)
        top_metric = _fmt_val(clean[0].get(metric)) if metric else None
        if top_metric is not None:
            headline = (
                f"La mayor actividad está en «{top_name}» "
                f"({_label(metric)} {top_metric})."
            )
        else:
            headline = f"Destaca «{top_name}»."
    else:
        for k in list(dims)[:3] + list(metrics)[:3]:
            if k in first and first[k] is not None:
                points.append(FactPoint(label=_label(k), value=_fmt_val(first[k])))
        if metrics and first.get(metrics[0]) is not None:
            m = metrics[0]
            headline = f"{_label(m).capitalize()}: {_fmt_val(first.get(m))}."
        elif points:
            headline = "; ".join(f"{p.label} {p.value}" for p in points[:3]) + "."
        else:
            headline = f"Hay resultados en {ds_label}."

    lims = list(limitations or [])
    if forecast:
        lims.append(
            "La anticipación es orientativa y no sustituye el criterio del equipo de operaciones."
        )

    return AnswerBrief(
        question=question,
        intent=intent,
        dataset=dataset,
        dataset_label=ds_label,
        row_count=row_count,
        empty=False,
        headline=headline,
        points=points,
        ranking=ranking,
        forecast=forecast,
        forecast_method=forecast_method,
        recommendations=list(recommendations or [])[:3],
        root_cause=root_cause,
        limitations=lims[:4],
    )
