"""Hechos estructurados a partir de filas HIS — base para narrativa."""

from __future__ import annotations

from typing import Any

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
    "value": "valor",
    "threshold": "umbral",
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
            or k in {"quantity", "value", "wait_minutes", "stay_hours", "total", "camas_ocupadas"}
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
                f"No hay registros en {ds_label} para esa consulta "
                "con los filtros y permisos actuales."
            ),
            forecast=forecast,
            forecast_method=forecast_method,
            recommendations=recommendations or [],
            limitations=limitations or [],
        )

    clean = [r for r in rows if isinstance(r, dict)]
    first = clean[0]
    dims = _dim_keys(first)
    metrics = _metric_keys(first)

    # Ordenar por métrica desc para que "mayor" coincida con el ranking
    if metrics and len(clean) > 1:
        mkey = metrics[0]

        def _sort_key(fila: dict[str, Any]) -> float:
            n = safe_number(fila.get(mkey))
            return float(n) if n is not None else -1.0

        clean = sorted(clean, key=_sort_key, reverse=True)
        first = clean[0]

    points: list[FactPoint] = []
    ranking: list[str] = []
    headline: str | None = None

    q_low = question.lower()
    pregunta_proyeccion = any(
        k in q_low
        for k in (
            "evolucion",
            "evolución",
            "evolucionar",
            "próxim",
            "proxim",
            "predic",
            "anticip",
            "futur",
            "tendencia",
            "cómo irá",
            "como ira",
            "cómo va a",
            "como va a",
        )
    )

    # Ranking / breakdown (varias filas con dimensión)
    if len(clean) > 1 and dims:
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
        if ranking:
            top_name = clean[0].get(dim)
            top_metric = _fmt_val(clean[0].get(metric)) if metric else None
            if pregunta_proyeccion and forecast:
                # La pregunta pide evolución: el dato principal es la proyección
                headline = (
                    f"Proyección de {ds_label} para los próximos periodos "
                    f"(contexto: mayor {_label(dim)} actual «{top_name}»"
                    + (f" con {top_metric}" if top_metric else "")
                    + ")."
                )
            elif top_metric is not None:
                headline = (
                    f"El mayor valor en {_label(dim)} es «{top_name}» "
                    f"con {_label(metric)} = {top_metric} "
                    f"(sobre {row_count} grupo(s) observados)."
                )
            else:
                headline = f"Se observan {row_count} grupos en {_label(dim)}; destaca «{top_name}»."
    else:
        # Una fila agregada o detalle
        for k in list(dims)[:3] + list(metrics)[:3]:
            if k in first and first[k] is not None:
                points.append(FactPoint(label=_label(k), value=_fmt_val(first[k])))
        if metrics and first.get(metrics[0]) is not None:
            m = metrics[0]
            headline = (
                f"En {ds_label}, {_label(m)} es {_fmt_val(first.get(m))} "
                f"({row_count} registro(s) en el resultado)."
            )
        elif points:
            headline = (
                f"Consulta sobre {ds_label}: "
                + "; ".join(f"{p.label} {p.value}" for p in points[:3])
                + "."
            )
        else:
            headline = f"Se obtuvieron {row_count} registro(s) de {ds_label}."

    lims = list(limitations or [])
    if forecast_method:
        lims.append(
            f"La anticipación usa método «{forecast_method}» sobre la serie disponible; "
            "no sustituye el criterio del equipo."
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
        limitations=lims[:3],
    )
