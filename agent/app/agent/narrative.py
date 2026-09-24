"""Narrativa ejecutiva: plantillas + LLM anclado a AnswerBrief (anti-alucinación)."""

from __future__ import annotations

import asyncio
import json
import logging
import re

from app.agent.answer_brief import AnswerBrief
from app.config.settings import settings
from app.llm.client import get_llm_client
from app.llm.prompts import get_prompt_loader

logger = logging.getLogger(__name__)

_MAX_ANSWER = 4000
# Por debajo del timeout típico de Node (20s) para no tumbar el BFF.
_LLM_BUDGET_S = min(8.0, float(getattr(settings, "llm_timeout_seconds", 30.0) or 30.0))

_FALLBACK_SYSTEM = """Eres Susana-AI, analista operativo hospitalario (no clínico).
Responde en español, tono profesional de gestión en salud (90-150 palabras).
SOLO usa hechos del JSON. No inventes cifras, umbrales ni causas clínicas.
Sin PII, sin SQL, sin JSON en la salida. Prosa fluida, sin viñetas etiquetadas.
"""


async def render_narrative_async(brief: AnswerBrief) -> str:
    if brief.clarify:
        return brief.clarify[:_MAX_ANSWER]

    text: str | None = None
    client = get_llm_client()
    if client.is_available and not brief.empty:
        try:
            text = await asyncio.wait_for(_llm_narrate(brief), timeout=_LLM_BUDGET_S)
            text = _clean_llm_text(text)
            if text and not _grounding_ok(brief, text):
                logger.warning("Narrativa LLM rechazada por grounding; uso plantilla")
                text = None
        except asyncio.TimeoutError:
            logger.warning("Narrativa LLM timeout (%.1ss); fallback plantilla", _LLM_BUDGET_S)
            text = None
        except Exception:
            logger.exception("Fallo narrativa LLM; fallback a plantilla")
            text = None

    if not text:
        text = render_template(brief)
    return text[:_MAX_ANSWER]


async def _llm_narrate(brief: AnswerBrief) -> str:
    loader = get_prompt_loader()
    try:
        system = loader.load("narrative")
    except FileNotFoundError:
        system = _FALLBACK_SYSTEM

    # Payload mínimo: menos tentación de inventar
    payload = {
        "question": brief.question,
        "intent": brief.intent,
        "dataset_label": brief.dataset_label,
        "row_count": brief.row_count,
        "empty": brief.empty,
        "headline": brief.headline,
        "points": [p.model_dump() for p in brief.points],
        "ranking": brief.ranking[:5],
        "forecast": brief.forecast,
        "forecast_method": brief.forecast_method,
        "recommendations": brief.recommendations[:3],
        "root_cause": brief.root_cause,
        "limitations": brief.limitations[:3],
    }
    user = (
        "Redacta la respuesta para el equipo de operaciones del hospital.\n"
        "Pregunta:\n"
        f"{brief.question}\n\n"
        "Hechos verificados (único origen de verdad; no inventes nada fuera de aquí):\n"
        f"{json.dumps(payload, ensure_ascii=False)}"
    )
    content, _ = await get_llm_client().chat(
        [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.1,
        max_tokens=380,
    )
    return (content or "").strip()


def render_template(brief: AnswerBrief) -> str:
    """Narrativa determinística — siempre grounded (demo-safe)."""
    if brief.clarify:
        return brief.clarify

    if brief.empty:
        parts = [
            brief.empty_reason
            or "Con la información disponible no puedo responder esa consulta con seguridad."
        ]
        if brief.forecast:
            parts.append(brief.forecast)
        if brief.recommendations:
            parts.append(brief.recommendations[0])
        if brief.limitations:
            parts.append(brief.limitations[0])
        return " ".join(parts)

    partes: list[str] = []
    if brief.headline:
        partes.append(brief.headline)
    elif brief.points:
        partes.append(
            "Según "
            + brief.dataset_label
            + ", "
            + "; ".join(f"{p.label}: {p.value}" for p in brief.points[:4])
            + "."
        )

    if brief.ranking and len(brief.ranking) > 1:
        partes.append(
            "En el detalle destacan: "
            + "; ".join(brief.ranking[:3])
            + "."
        )

    if brief.root_cause:
        partes.append(brief.root_cause)

    if brief.forecast:
        metodo = ""
        if brief.forecast_method == "random_forest":
            metodo = " (proyección con Random Forest sobre la serie del HIS)"
        elif brief.forecast_method == "tendencia":
            metodo = " (proyección por tendencia explicable; aún hay pocos puntos para el modelo ML)"
        partes.append(brief.forecast if brief.forecast.endswith(".") else brief.forecast + ".")
        if metodo and metodo.strip(" ()") not in brief.forecast.lower():
            # Evitar duplicar si el mensaje ya menciona el método
            if "random forest" not in brief.forecast.lower() and "tendencia" not in brief.forecast.lower():
                partes[-1] = partes[-1].rstrip(".") + metodo + "."

    if brief.recommendations:
        tip = brief.recommendations[0]
        if not tip.endswith("."):
            tip += "."
        partes.append(tip)

    if brief.limitations:
        partes.append(brief.limitations[0])

    return " ".join(p for p in partes if p).strip()


def _clean_llm_text(text: str | None) -> str | None:
    if not text:
        return None
    t = text.strip()
    # Quitar fences markdown si el modelo las añade
    if t.startswith("```"):
        t = re.sub(r"^```(?:json|markdown|text)?\s*", "", t)
        t = re.sub(r"\s*```$", "", t)
    t = t.strip().strip('"')
    return t or None


def _grounding_ok(brief: AnswerBrief, text: str) -> bool:
    """Rechaza números 'nuevos' relevantes que no estén en el brief."""
    allowed = brief.allowed_numbers()
    # También aceptar enteros de porcentajes ya en el brief (ej. 65 de "~65%")
    found = re.findall(r"\d+(?:[.,]\d+)?", text)
    for raw in found:
        n = raw.replace(",", ".")
        whole = n.split(".")[0]
        if whole in allowed or n in allowed:
            continue
        # Enumeraciones y redondeos triviales
        if whole in {"1", "2", "3", "4", "5", "0", "90", "150", "100"}:
            continue
        try:
            val = float(n)
        except ValueError:
            continue
        if val >= 10 and whole not in allowed:
            logger.info("Grounding fail: número %s no está en hechos", raw)
            return False
    # Frases típicas de invención clínica
    banned = (
        "diagnóstico",
        "prescri",
        "dosis",
        "tratamiento del paciente",
        "debe tomar",
    )
    low = text.lower()
    if any(b in low for b in banned):
        return False
    return True
