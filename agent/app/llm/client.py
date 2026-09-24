"""OpenRouter client (OpenAI-compatible)."""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any

from openai import AsyncOpenAI

from app.config.settings import settings

logger = logging.getLogger(__name__)


class LLMClient:
    def __init__(self) -> None:
        self.model = settings.llm_model
        self.timeout = settings.llm_timeout_seconds
        self.enabled = settings.llm_enabled and bool(settings.openrouter_api_key)
        self._async: AsyncOpenAI | None = None

    @property
    def is_available(self) -> bool:
        return self.enabled

    def _async_client(self) -> AsyncOpenAI:
        if self._async is None:
            self._async = AsyncOpenAI(
                api_key=settings.openrouter_api_key,
                base_url=settings.openrouter_base_url,
                timeout=self.timeout,
                # Sin reintentos internos: el presupuesto de la pregunta lo controla bridge/llm.py.
                max_retries=0,
            )
        return self._async

    async def chat(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
        response_json: bool = False,
    ) -> tuple[str, dict[str, Any]]:
        """Returns (content, usage_meta). Raises if LLM unavailable."""
        if not self.is_available:
            raise RuntimeError("LLM no configurado o deshabilitado")

        kwargs: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature if temperature is not None else settings.llm_temperature,
            "max_tokens": max_tokens or settings.llm_max_tokens,
        }
        if response_json:
            kwargs["response_format"] = {"type": "json_object"}

        client = self._async_client()
        response = await client.chat.completions.create(**kwargs)
        content = response.choices[0].message.content or ""
        usage = {
            "model": self.model,
            "prompt_tokens": getattr(response.usage, "prompt_tokens", None) if response.usage else None,
            "completion_tokens": getattr(response.usage, "completion_tokens", None) if response.usage else None,
        }
        return content, usage


@lru_cache
def get_llm_client() -> LLMClient:
    return LLMClient()
