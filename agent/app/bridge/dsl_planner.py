"""Elige una consulta DSL a partir de la pregunta y el catálogo lógico de Node."""

from __future__ import annotations

import unicodedata
from typing import Any


def _norm(text: str) -> str:
    nfkd = unicodedata.normalize("NFD", text.lower())
    return "".join(c for c in nfkd if unicodedata.category(c) != "Mn")


def _datasets(catalog: list[dict[str, Any]]) -> set[str]:
    return {str(d.get("dataset")) for d in catalog if d.get("dataset")}


def consulta_serie_temporal(
    question: str,
    catalog: list[dict[str, Any]],
    max_rows: int = 60,
) -> dict[str, Any] | None:
    """
    Segunda consulta solo para anticipar: serie diaria (o por periodo) sobre
    la que el Predictor calcula tendencia. No sustituye la respuesta principal.
    """
    disponibles = _datasets(catalog)
    texto = _norm(question)
    limit = min(max(7, max_rows), 60)

    if ("medicamento" in texto or "inventario" in texto or "stock" in texto) and "medications" in disponibles:
        # Sin dimensión temporal fiable en medications → no forzar serie.
        return None

    if ("espera" in texto or "triage" in texto) and "admissions" in disponibles:
        return {
            "dataset": "admissions",
            "metrics": [{"agg": "avg", "field": "wait_minutes"}],
            "groupBy": [{"field": "admitted_at", "grain": "day"}],
            "orderBy": [{"ref": "admitted_at", "dir": "asc"}],
            "limit": limit,
        }

    if "admissions" in disponibles:
        return {
            "dataset": "admissions",
            "metrics": [{"agg": "count"}],
            "groupBy": [{"field": "admitted_at", "grain": "day"}],
            "orderBy": [{"ref": "admitted_at", "dir": "asc"}],
            "limit": limit,
        }

    return None


def elegir_consulta(question: str, catalog: list[dict[str, Any]], max_rows: int = 100) -> dict[str, Any] | None:
    """
    Planificador determinístico (como agent-mock.mjs).
    Solo propone datasets presentes en el catálogo del usuario.
    """
    disponibles = _datasets(catalog)
    texto = _norm(question)
    limit = min(max(1, max_rows), 100)

    # Si piden predicción/tendencia de forma explícita, la consulta principal
    # ya es la serie temporal (el Predictor enriquecerá igual).
    quiere_serie = any(
        k in texto for k in ("predic", "tendenc", "proyecc", "anticip", "pronostic", "forecast")
    )
    if quiere_serie and "admissions" in disponibles:
        return {
            "dataset": "admissions",
            "metrics": [{"agg": "count"}],
            "groupBy": [{"field": "admitted_at", "grain": "day"}],
            "orderBy": [{"ref": "admitted_at", "dir": "asc"}],
            "limit": min(limit, 60),
        }

    if ("medicamento" in texto or "inventario" in texto or "farmacia" in texto or "stock" in texto) and "medications" in disponibles:
        return {
            "dataset": "medications",
            "metrics": [{"agg": "sum", "field": "quantity"}],
            "groupBy": [{"field": "code"}],
            "orderBy": [{"ref": "metric:0", "dir": "desc"}],
            "limit": min(limit, 20),
        }

    if ("espera" in texto or "triage" in texto or "urgenc" in texto) and "admissions" in disponibles:
        return {
            "dataset": "admissions",
            "metrics": [{"agg": "avg", "field": "wait_minutes"}],
            "groupBy": [{"field": "triage_level"}],
            "limit": min(limit, 20),
        }

    if ("cirug" in texto or "quirurg" in texto) and "surgeries" in disponibles:
        return {
            "dataset": "surgeries",
            "metrics": [{"agg": "count"}],
            "groupBy": [{"field": "executed"}],
            "limit": min(limit, 20),
        }

    if ("uci" in texto or "cama" in texto or "ocupac" in texto) and "admissions" in disponibles:
        return {
            "dataset": "admissions",
            "metrics": [{"agg": "count"}],
            "groupBy": [{"field": "unit"}],
            "limit": min(limit, 20),
        }

    if ("alerta" in texto) and "alerts" in disponibles:
        return {
            "dataset": "alerts",
            "metrics": [{"agg": "count"}],
            "groupBy": [{"field": "type"}],
            "limit": min(limit, 20),
        }

    if "admissions" in disponibles:
        return {
            "dataset": "admissions",
            "metrics": [{"agg": "count"}],
            "groupBy": [{"field": "unit"}],
            "limit": min(limit, 20),
        }

    # Primer dataset disponible como último recurso
    if disponibles:
        ds = sorted(disponibles)[0]
        return {"dataset": ds, "metrics": [{"agg": "count"}], "limit": min(limit, 20)}

    return None


def intent_desde_pregunta(question: str) -> str:
    """Mapeo simple para Recommender."""
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


def aclaracion_si_ambigua(question: str, catalog: list[dict[str, Any]]) -> str | None:
    """
    Si la pregunta es demasiado vaga para operar con seguridad,
    pide un dato concreto en lugar de inventar un corte.
    """
    t = _norm(question).strip()
    if len(t) < 8:
        return (
            "¿Puede precisar un poco más? Por ejemplo: ocupación de urgencias, "
            "tiempo de espera, medicamentos con bajo stock o el servicio con más ingresos."
        )

    # Preguntas genéricas tipo "cómo vamos" / "dame un resumen" sin tema
    genericas = (
        "como vamos",
        "como esta",
        "cómo está",
        "resumen",
        "todo",
        "general",
        "situacion",
        "situación",
        "que pasa",
        "qué pasa",
    )
    tiene_tema = any(
        k in t
        for k in (
            "uci",
            "cama",
            "ocupac",
            "espera",
            "triage",
            "medic",
            "stock",
            "invent",
            "cirug",
            "quirurg",
            "alerta",
            "demanda",
            "ingres",
            "servicio",
            "urgenc",
            "predic",
            "tendenc",
        )
    )
    if any(g in t for g in genericas) and not tiene_tema:
        disponibles = sorted(_datasets(catalog))
        ejemplos = []
        if "admissions" in disponibles:
            ejemplos.append("ocupación por unidad")
            ejemplos.append("tiempos de espera en urgencias")
        if "medications" in disponibles:
            ejemplos.append("medicamentos con mayor consumo")
        if "surgeries" in disponibles:
            ejemplos.append("cirugías programadas vs ejecutadas")
        if not ejemplos:
            ejemplos = ["ocupación", "esperas", "farmacia"]
        return (
            "Para orientarle mejor, indíqueme el tema. Por ejemplo: "
            + "; ".join(ejemplos[:3])
            + "."
        )
    return None
