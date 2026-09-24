"""Narrativa ejecutiva: plantillas + LLM anclado a AnswerBrief."""

from __future__ import annotations

import json
import logging
import re

from app.agent.answer_brief import AnswerBrief
from app.llm.client import get_llm_client
from app.llm.prompts import get_prompt_loader

logger = logging.getLogger(__name__)

_MAX_ANSWER = 4000

_FALLBACK_SYSTEM = """Eres el analista operativo de Susana-AI (Hospital Susana López de Valencia).
Responde en español, tono ejecutivo y humano (120-180 palabras).
Estructura en prosa: apertura con el dato clave; explicación breve; anticipación si hay forecast;
recomendación operativa si hay recommendations; limitación si hay limitations.
Nunca inventes cifras fuera del JSON. Sin PII, sin consejo clínico, sin SQL ni JSON en la respuesta.
"""


async def render_narrative_async(brief: AnswerBrief) -> str:
    """Versión async desde handle_ask."""
    if brief.clarify:
        return brief.clarify[:_MAX_ANSWER]

    text: str | None = None
    client = get_llm_client()
    if client.is_available:
        try:
            loader = get_prompt_loader()
            try:
                system = loader.load("narrative")
            except FileNotFoundError:
                system = _FALLBACK_SYSTEM
            user = (
                "Pregunta del usuario:\n"
                f"{brief.question}\n\n"
                "Hechos verificados (JSON). Solo puedes usar estos datos:\n"
                f"{json.dumps(brief.model_dump(), ensure_ascii=False)}"
            )
            content, _ = await client.chat(
                [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=0.2,
                max_tokens=450,
            )
            text = (content or "").strip()
            if text and not _grounding_ok(brief, text):
                logger.warning("Narrativa LLM rechazada por grounding; uso plantilla")
                text = None
        except Exception:
            logger.exception("Fallo narrativa LLM; fallback a plantilla")
            text = None

    if not text:
        text = render_template(brief)
    return text[:_MAX_ANSWER]


def render_template(brief: AnswerBrief) -> str:
    if brief.clarify:
        return brief.clarify

    if brief.empty:
        parts = [brief.empty_reason or "No encontré datos suficientes para responder."]
        if brief.forecast:
            parts.append(brief.forecast)
        if brief.recommendations:
            parts.append("Mientras tanto: " + " ".join(brief.recommendations[:2]))
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
        partes.append("Detalle del ranking: " + "; ".join(brief.ranking[:4]) + ".")

    if brief.root_cause:
        partes.append(brief.root_cause)

    if brief.forecast:
        partes.append(brief.forecast)

    if brief.recommendations:
        partes.append("Para la operación: " + " ".join(brief.recommendations[:2]))

    if brief.limitations:
        partes.append(brief.limitations[0])

    return " ".join(p for p in partes if p).strip()


def _grounding_ok(brief: AnswerBrief, text: str) -> bool:
    allowed = brief.allowed_numbers()
    found = re.findall(r"\d+(?:[.,]\d+)?", text)
    for raw in found:
        n = raw.replace(",", ".")
        whole = n.split(".")[0]
        if whole in allowed or n in allowed:
            continue
        if whole in {"1", "2", "3", "4", "5", "0"}:
            continue
        try:
            val = float(n)
        except ValueError:
            continue
        if val >= 10 and whole not in allowed:
            return False
    return True
