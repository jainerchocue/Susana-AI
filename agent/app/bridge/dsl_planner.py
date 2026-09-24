"""Elige una consulta DSL a partir de la pregunta y el catálogo lógico de Node."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
import unicodedata

# Zona del HIS (Colombia)
_TZ = timezone(timedelta(hours=-5))


def _norm(text: str) -> str:
    nfkd = unicodedata.normalize("NFD", text.lower())
    return "".join(c for c in nfkd if unicodedata.category(c) != "Mn")


def _datasets(catalog: list[dict[str, Any]]) -> set[str]:
    return {str(d.get("dataset")) for d in catalog if d.get("dataset")}


def _inicio_hoy_iso() -> str:
    ahora = datetime.now(_TZ)
    return ahora.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()


def _hace_dias_iso(dias: int) -> str:
    ahora = datetime.now(_TZ)
    inicio = (ahora - timedelta(days=dias)).replace(hour=0, minute=0, second=0, microsecond=0)
    return inicio.isoformat()


def consulta_serie_temporal(
    question: str,
    catalog: list[dict[str, Any]],
    max_rows: int = 60,
) -> dict[str, Any] | None:
    """Serie diaria solo para anticipar (preguntas de proyección)."""
    disponibles = _datasets(catalog)
    texto = _norm(question)
    limit = min(max(7, max_rows), 60)

    if ("medicamento" in texto or "inventario" in texto or "stock" in texto) and "medications" in disponibles:
        return None

    if ("espera" in texto or "triage" in texto) and "admissions" in disponibles:
        q: dict[str, Any] = {
            "dataset": "admissions",
            "metrics": [{"agg": "avg", "field": "wait_minutes"}],
            "groupBy": [{"field": "admitted_at", "grain": "day"}],
            "orderBy": [{"ref": "admitted_at", "dir": "asc"}],
            "limit": limit,
            "filters": [],
        }
        if "urgenc" in texto:
            q["filters"].append({"field": "unit", "op": "contains", "value": "URGENC"})
        return q

    if "admissions" in disponibles:
        return {
            "dataset": "admissions",
            "metrics": [{"agg": "count"}],
            "groupBy": [{"field": "admitted_at", "grain": "day"}],
            "orderBy": [{"ref": "admitted_at", "dir": "asc"}],
            "limit": limit,
            "filters": [],
        }

    return None


def elegir_consulta(question: str, catalog: list[dict[str, Any]], max_rows: int = 100) -> dict[str, Any] | None:
    """
    Planificador: propone DSL alineado a la pregunta (con filtros cuando aplica).
    Solo datasets presentes en el catálogo del usuario.
    """
    disponibles = _datasets(catalog)
    texto = _norm(question)
    limit = min(max(1, max_rows), 100)

    quiere_serie = any(
        k in texto for k in ("predic", "tendenc", "proyecc", "anticip", "pronostic", "forecast", "evolucion")
    )
    if quiere_serie and "admissions" in disponibles:
        return {
            "dataset": "admissions",
            "metrics": [{"agg": "count"}],
            "groupBy": [{"field": "admitted_at", "grain": "day"}],
            "orderBy": [{"ref": "admitted_at", "dir": "asc"}],
            "limit": min(limit, 60),
            "filters": [],
        }

    # Inventario bajo / días de stock → alertas LOW_STOCK (no consumo de dispensación)
    pide_inventario = any(
        k in texto for k in ("inventario", "dias de", "días de", "bajo stock", "sin stock", "menos de")
    ) and any(k in texto for k in ("medic", "farmac", "stock", "invent"))
    if pide_inventario and "alerts" in disponibles:
        return {
            "dataset": "alerts",
            "metrics": [{"agg": "min", "field": "value"}],
            "groupBy": [{"field": "scope_id"}],
            "filters": [
                {"field": "type", "op": "eq", "value": "LOW_STOCK"},
                {"field": "status", "op": "in", "value": ["OPEN", "ACKNOWLEDGED"]},
            ],
            "orderBy": [{"ref": "metric:0", "dir": "asc"}],
            "limit": min(limit, 20),
        }

    if ("medicamento" in texto or "inventario" in texto or "farmacia" in texto or "stock" in texto) and "medications" in disponibles:
        return {
            "dataset": "medications",
            "metrics": [{"agg": "sum", "field": "quantity"}],
            "groupBy": [{"field": "code"}],
            "orderBy": [{"ref": "metric:0", "dir": "desc"}],
            "limit": min(limit, 20),
            "filters": [],
        }

    # Espera / triage / urgencias (antes que ocupación genérica)
    if ("espera" in texto or "triage" in texto) and "admissions" in disponibles:
        filters: list[dict[str, Any]] = []
        if "urgenc" in texto:
            filters.append({"field": "unit", "op": "contains", "value": "URGENC"})
        if "semana" in texto:
            filters.append({"field": "admitted_at", "op": "gte", "value": _hace_dias_iso(7)})
        elif "hoy" in texto:
            filters.append({"field": "admitted_at", "op": "gte", "value": _inicio_hoy_iso()})
        return {
            "dataset": "admissions",
            "metrics": [{"agg": "avg", "field": "wait_minutes"}],
            "groupBy": [{"field": "triage_level"}],
            "filters": filters,
            "limit": min(limit, 20),
        }

    if ("cirug" in texto or "quirurg" in texto) and "surgeries" in disponibles:
        return {
            "dataset": "surgeries",
            "metrics": [{"agg": "count"}],
            "groupBy": [{"field": "executed"}],
            "limit": min(limit, 20),
            "filters": [],
        }

    # UCI / camas / ocupación
    if ("uci" in texto or "cama" in texto or "ocupac" in texto) and "admissions" in disponibles:
        filters = []
        if "uci" in texto:
            filters.append({"field": "unit", "op": "contains", "value": "UCI"})
        if "hoy" in texto:
            filters.append({"field": "admitted_at", "op": "gte", "value": _inicio_hoy_iso()})
        # Si pide UCI: contar ingresos en esa unidad (proxy operativo de carga UCI)
        if "uci" in texto:
            return {
                "dataset": "admissions",
                "metrics": [{"agg": "count"}],
                "filters": filters,
                "limit": min(limit, 5),
            }
        return {
            "dataset": "admissions",
            "metrics": [{"agg": "count"}],
            "groupBy": [{"field": "unit"}],
            "filters": filters,
            "orderBy": [{"ref": "metric:0", "dir": "desc"}],
            "limit": min(limit, 20),
        }

    if ("alerta" in texto) and "alerts" in disponibles:
        return {
            "dataset": "alerts",
            "metrics": [{"agg": "count"}],
            "groupBy": [{"field": "type"}],
            "limit": min(limit, 20),
            "filters": [],
        }

    # "servicio con más ingresos / pacientes"
    if ("servicio" in texto or "ingres" in texto) and "admissions" in disponibles:
        filters = []
        if "mes" in texto:
            filters.append({"field": "admitted_at", "op": "gte", "value": _hace_dias_iso(30)})
        return {
            "dataset": "admissions",
            "metrics": [{"agg": "count"}],
            "groupBy": [{"field": "unit"}],
            "filters": filters,
            "orderBy": [{"ref": "metric:0", "dir": "desc"}],
            "limit": min(limit, 20),
        }

    if "admissions" in disponibles:
        return {
            "dataset": "admissions",
            "metrics": [{"agg": "count"}],
            "groupBy": [{"field": "unit"}],
            "orderBy": [{"ref": "metric:0", "dir": "desc"}],
            "limit": min(limit, 20),
            "filters": [],
        }

    if disponibles:
        ds = sorted(disponibles)[0]
        return {"dataset": ds, "metrics": [{"agg": "count"}], "limit": min(limit, 20), "filters": []}

    return None


def intent_desde_pregunta(question: str) -> str:
    t = _norm(question)
    if "medicamento" in t or "inventario" in t or "stock" in t:
        return "MEDICATION_STOCK"
    if "espera" in t or "triage" in t:
        return "WAIT_TIME"
    if "uci" in t or "cama" in t or "ocupac" in t:
        return "OCCUPANCY"
    if "demanda" in t or "ingres" in t or "servicio" in t:
        return "DEMAND"
    if "cirug" in t:
        return "SURGERY"
    return "GENERAL_ANALYTICS"
