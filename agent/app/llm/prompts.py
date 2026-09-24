"""Prompt loading and simple versioning."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from app.config.settings import settings

PROMPT_VERSION = "1.0.0"


class PromptLoader:
    def __init__(self, prompts_dir: Path | None = None) -> None:
        self.prompts_dir = prompts_dir or settings.prompts_dir
        self.version = PROMPT_VERSION
        self._cache: dict[str, str] = {}

    def load(self, name: str) -> str:
        """Load prompt file by stem, e.g. 'system' → system.txt."""
        if name in self._cache:
            return self._cache[name]
        path = self.prompts_dir / f"{name}.txt"
        if not path.exists():
            raise FileNotFoundError(f"Prompt not found: {path}")
        text = path.read_text(encoding="utf-8")
        self._cache[name] = text
        return text

    def render(self, name: str, **kwargs: str) -> str:
        template = self.load(name)
        try:
            return template.format(**kwargs)
        except KeyError:
            # Allow partial templates with unused placeholders left as-is via replace
            result = template
            for key, value in kwargs.items():
                result = result.replace("{" + key + "}", str(value))
            return result


@lru_cache
def get_prompt_loader() -> PromptLoader:
    return PromptLoader()
