"""NL2SQL generation — LLM + schema slice + deterministic fallback."""

from __future__ import annotations

import json
import re
from pathlib import Path

from app.config.settings import settings
from app.llm.client import LLMClient, get_llm_client
from app.llm.prompts import PromptLoader, get_prompt_loader
from app.llm.schemas import NL2SQLResult, QueryPlan
from app.schema.loader import SchemaLoader, get_schema_loader


class NL2SQLGenerator:
    def __init__(
        self,
        llm: LLMClient | None = None,
        prompts: PromptLoader | None = None,
        schema: SchemaLoader | None = None,
    ) -> None:
        self.llm = llm or get_llm_client()
        self.prompts = prompts or get_prompt_loader()
        self.schema = schema or get_schema_loader()
        self._fallback = self._load_fallback()

    def _load_fallback(self) -> dict:
        path = settings.prompts_dir / "fallback.sql.json"
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
        return {"queries": []}

    def match_fallback(self, question: str) -> NL2SQLResult | None:
        q = question.lower().strip()
        for item in self._fallback.get("queries", []):
            patterns = item.get("patterns", [])
            if any(re.search(p, q, re.IGNORECASE) for p in patterns):
                return NL2SQLResult(
                    intent=item["intent"],
                    sql=item["sql"],
                    parameters=item.get("parameters", {}),
                    tables=item.get("tables", []),
                    columns=item.get("columns", []),
                    explanation=item.get("explanation", "Consulta predefinida (fallback)"),
                )
        return None

    async def generate(self, question: str, plan: QueryPlan) -> tuple[NL2SQLResult, bool]:
        """Returns (result, fallback_used)."""
        fallback = self.match_fallback(question)
        if not self.llm.is_available:
            if fallback:
                return fallback, True
            raise RuntimeError("LLM no disponible y sin fallback para la pregunta")

        schema_fragment = self.schema.schema_prompt_fragment(plan.tables)
        system = self.prompts.load("system")
        user = self.prompts.render(
            "nl2sql",
            question=question,
            plan=json.dumps(plan.model_dump(), ensure_ascii=False, indent=2),
            schema=schema_fragment,
            limit=str(plan.limit or settings.default_sql_limit),
        )
        try:
            data, _ = await self.llm.chat_json(
                [{"role": "system", "content": system}, {"role": "user", "content": user}]
            )
            result = NL2SQLResult.model_validate(data)
            if not result.tables:
                result.tables = plan.tables
            if not result.intent:
                result.intent = plan.intent
            return result, False
        except Exception:
            if fallback:
                return fallback, True
            raise
