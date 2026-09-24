"""Intent detection — deterministic rules first, LLM few-shot fallback."""

from __future__ import annotations

import re

from app.llm.client import LLMClient, get_llm_client
from app.llm.prompts import PromptLoader, get_prompt_loader
from app.llm.schemas import IntentResult
from app.schema.glossary import Glossary, get_glossary

CLINICAL_PATTERNS = [
    r"\brecetar\b",
    r"\bprescribir\b",
    r"\bdiagn[oó]stico cl[ií]nico\b",
    r"\bqu[eé] tratamiento\b",
    r"\bdosis\b",
    r"\bmedicaci[oó]n para (el|la|este|esta) paciente\b",
]

RULES: list[tuple[str, list[str]]] = [
    ("OCCUPANCY", [r"camas?\b", r"\buci\b", r"ocupad", r"ocupaci[oó]n", r"disponib"]),
    ("WAIT_TIME", [r"tiempo.*espera", r"espera.*urgenc", r"demora", r"promedio de espera"]),
    ("MEDICATION_STOCK", [r"d[ií]as de inventario", r"stock", r"inventario", r"menos de \d+ d[ií]as"]),
    ("MEDICATION_CONSUMPTION", [r"consumo.*medicament", r"dispens", r"medicament.*consum"]),
    ("SURGERY", [r"cirug", r"quir[uú]rg", r"programaci[oó]n"]),
    ("TRIAGE", [r"\btriage\b", r"clasificaci[oó]n de urgencia"]),
    ("DEMAND", [r"mayor demanda", r"m[aá]s pacientes", r"demanda", r"ingresados"]),
    ("SERVICE_ANALYSIS", [r"servicio.*prestad", r"\bcups\b", r"procedimiento"]),
    ("ROOT_CAUSE", [r"\bpor qu[eé]\b", r"causa", r"raz[oó]n del aumento"]),
    ("RECOMMENDATION", [r"recomienda", r"qu[eé] debo hacer", r"sugerencia"]),
    ("GENERAL_ANALYTICS", [r"cu[aá]ntos", r"promedio", r"tendencia", r"estad[ií]st"]),
]


class IntentDetector:
    def __init__(
        self,
        llm: LLMClient | None = None,
        prompts: PromptLoader | None = None,
        glossary: Glossary | None = None,
    ) -> None:
        self.llm = llm or get_llm_client()
        self.prompts = prompts or get_prompt_loader()
        self.glossary = glossary or get_glossary()

    def detect_rules(self, question: str) -> IntentResult | None:
        q = question.lower()

        for pattern in CLINICAL_PATTERNS:
            if re.search(pattern, q, re.IGNORECASE):
                return IntentResult(
                    intent="OUT_OF_DOMAIN",
                    out_of_domain=True,
                    confidence="HIGH",
                    reason="Pregunta clínica fuera del dominio operativo/administrativo",
                )

        entities = self.glossary.resolve_entities(question)
        for intent, patterns in RULES:
            if any(re.search(p, q, re.IGNORECASE) for p in patterns):
                return IntentResult(
                    intent=intent,
                    entities=entities,
                    confidence="HIGH",
                )
        return None

    async def detect(self, question: str, conversation: list[dict[str, str]] | None = None) -> IntentResult:
        ruled = self.detect_rules(question)
        if ruled and ruled.intent != "UNKNOWN":
            return ruled

        if not self.llm.is_available:
            entities = self.glossary.resolve_entities(question)
            return IntentResult(intent="UNKNOWN", entities=entities, confidence="LOW")

        system = self.prompts.load("system")
        intent_prompt = self.prompts.render(
            "intent",
            question=question,
            conversation=self._format_conversation(conversation or []),
        )
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": intent_prompt},
        ]
        try:
            data, _ = await self.llm.chat_json(messages)
            return IntentResult.model_validate(data)
        except Exception:  # noqa: BLE001
            return IntentResult(
                intent="UNKNOWN",
                entities=self.glossary.resolve_entities(question),
                confidence="LOW",
            )

    @staticmethod
    def _format_conversation(conversation: list[dict[str, str]]) -> str:
        if not conversation:
            return "(sin historial)"
        return "\n".join(f"{t.get('role', '?')}: {t.get('content', '')}" for t in conversation[-6:])
