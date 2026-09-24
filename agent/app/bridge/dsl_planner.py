"""Elige una consulta DSL a partir de la pregunta y el catálogo lógico de Node."""

from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Any

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


def _umbral_dias(texto: str, default: int = 5) -> int:
    m = re.search(r"menos de\s+(\d+)", texto)
    if m:
        return max(1, int(m.group(1)))
    m = re.search(r"(\d+)\s*dias", texto)
    if m:
        return max(1, int(m.group(1)))
    return default


def consulta_serie_temporal(
    question: str,
    catalog: list[dict[str, Any]],
    max_rows: int = 60,
) -> dict[str, Any] | None:
    disponibles = _datasets(catalog)
    texto = _norm(question)
    limit = min(max(7, max_rows), 60)

    if any(k in texto for k in ("medicamento", "inventario", "stock", "farmac")):
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


def consulta_uci_alternativa(
    question: str,
    catalog: list[dict[str, Any]],
    max_rows: int = 100,
    *,
    campo: str = "subunit",
    texto_filtro: str = "UCI",
    con_hoy: bool = True,
) -> dict[str, Any] | None:
    """Variantes de búsqueda UCI (unidad/subunidad / intensivo; con o sin filtro hoy)."""
    if "admissions" not in _datasets(catalog):
        return None
    texto = _norm(question)
    if "uci" not in texto:
        return None
    filters: list[dict[str, Any]] = [
        {"field": campo, "op": "contains", "value": texto_filtro},
    ]
    if con_hoy and "hoy" in texto:
        filters.append({"field": "admitted_at", "op": "gte", "value": _inicio_hoy_iso()})
    return {
        "dataset": "admissions",
        "metrics": [{"agg": "count"}],
        "groupBy": [{"field": campo}],
        "filters": filters,
        "orderBy": [{"ref": "metric:0", "dir": "desc"}],
        "limit": min(max(1, max_rows), 20),
    }


def consulta_inventario_bajo(
    catalog: list[dict[str, Any]],
    max_rows: int = 20,
) -> dict[str, Any] | None:
    """Alertas LOW_STOCK activas (el umbral de días se filtra en el agente)."""
    if "alerts" not in _datasets(catalog):
        return None
    return {
        "dataset": "alerts",
        "metrics": [{"agg": "min", "field": "value"}],
        "groupBy": [{"field": "scope_id"}],
        "filters": [
            {"field": "type", "op": "eq", "value": "LOW_STOCK"},
            {"field": "status", "op": "in", "value": ["OPEN", "ACKNOWLEDGED"]},
        ],
        "orderBy": [{"ref": "metric:0", "dir": "asc"}],
        "limit": min(max_rows, 30),
    }


def elegir_consulta(question: str, catalog: list[dict[str, Any]], max_rows: int = 100) -> dict[str, Any] | None:
    disponibles = _datasets(catalog)
    texto = _norm(question)
    limit = min(max(1, max_rows), 100)

    quiere_serie = any(
        k in texto
        for k in ("predic", "tendenc", "proyecc", "anticip", "pronostic", "forecast", "evolucion")
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

    # Medicamentos con pocos días de inventario → alertas LOW_STOCK
    pide_inventario = any(
        k in texto for k in ("inventario", "dias de", "bajo stock", "sin stock", "menos de")
    ) and any(k in texto for k in ("medic", "farmac", "stock", "invent"))
    if pide_inventario and "alerts" in disponibles:
        return consulta_inventario_bajo(catalog, max_rows=limit) or {
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

    if (
        "medicamento" in texto or "inventario" in texto or "farmacia" in texto or "stock" in texto
    ) and "medications" in disponibles:
        return {
            "dataset": "medications",
            "metrics": [{"agg": "sum", "field": "quantity"}],
            "groupBy": [{"field": "code"}],
            "orderBy": [{"ref": "metric:0", "dir": "desc"}],
            "limit": min(limit, 20),
            "filters": [],
        }

    if ("espera" in texto or "triage" in texto) and "admissions" in disponibles:
        filters: list[dict[str, Any]] = []
        if "urgenc" in texto:
            filters.append({"field": "unit", "op": "contains", "value": "URGENC"})
        if "semana" in texto:
            filters.append({"field": "admitted_at", "op": "gte", "value": _hace_dias_iso(7)})
        elif "hoy" in texto:
            filters.append({"field": "admitted_at", "op": "gte", "value": _inicio_hoy_iso()})
        # Promedio general (sin partir solo por triage) + detalle por triage en 2ª lectura
        # Una sola query con triage da el detalle; el brief calcula el promedio global.
        return {
            "dataset": "admissions",
            "metrics": [{"agg": "avg", "field": "wait_minutes"}],
            "groupBy": [{"field": "triage_level"}],
            "filters": filters,
            "orderBy": [{"ref": "triage_level", "dir": "asc"}],
            "limit": min(limit, 10),
        }

    if ("cirug" in texto or "quirurg" in texto) and "surgeries" in disponibles:
        return {
            "dataset": "surgeries",
            "metrics": [{"agg": "count"}],
            "groupBy": [{"field": "executed"}],
            "limit": min(limit, 20),
            "filters": [],
        }

    if ("uci" in texto or "cama" in texto or "ocupac" in texto) and "admissions" in disponibles:
        filters = []
        if "hoy" in texto:
            filters.append({"field": "admitted_at", "op": "gte", "value": _inicio_hoy_iso()})
        if "uci" in texto:
            # Primero por unidad; ask_service reintenta por subunidad si viene vacío
            return {
                "dataset": "admissions",
                "metrics": [{"agg": "count"}],
                "groupBy": [{"field": "unit"}],
                "filters": filters + [{"field": "unit", "op": "contains", "value": "UCI"}],
                "orderBy": [{"ref": "metric:0", "dir": "desc"}],
                "limit": min(limit, 20),
            }
        return {
            "dataset": "admissions",
            "metrics": [{"agg": "count"}],
            "groupBy": [{"field": "unit"}],
            "filters": filters,
            "orderBy": [{"ref": "metric:0", "dir": "desc"}],
            "limit": min(limit, 20),
        }

    if "alerta" in texto and "alerts" in disponibles:
        return {
            "dataset": "alerts",
            "metrics": [{"agg": "count"}],
            "groupBy": [{"field": "type"}],
            "limit": min(limit, 20),
            "filters": [],
        }

    if ("servicio" in texto or "ingres" in texto or "paciente" in texto) and "admissions" in disponibles:
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
    if "demanda" in t or "ingres" in t or "servicio" in t or "paciente" in t:
        return "DEMAND"
    if "cirug" in t:
        return "SURGERY"
    return "GENERAL_ANALYTICS"
