"""Pydantic Settings — environment configuration."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

AGENT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(AGENT_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Service
    app_name: str = "Hospital Intelligence Agent"
    app_env: str = "development"
    debug: bool = False

    # Clave que Node envía en X-Internal-Key al llamar POST /v1/ask
    # (en el backend se llama AGENT_API_KEY). Vacía -> /v1/ask rechaza todo.
    agent_api_key: str = ""

    # Callback hacia Node (puerto interno)
    node_internal_url: str = "http://127.0.0.1:3001"
    # Clave que Python envía a Node en POST /internal/agent/query
    node_internal_api_key: str = ""

    # LLM (OpenRouter — OpenAI compatible)
    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    llm_model: str = "openai/gpt-6-luna-pro"
    llm_timeout_seconds: float = 16.0
    llm_max_tokens: int = 700
    llm_temperature: float = 0.2
    llm_enabled: bool = True
    # Reescritura natural de la respuesta verificada (se descarta si altera los hechos).
    llm_polish: bool = True
    # Tope del pulido: es cosmético, no debe hacer esperar al usuario más que esto.
    llm_polish_timeout_seconds: float = 6.0
    # Presupuesto total de /v1/ask: por debajo del AGENT_TIMEOUT_MS de Node (20 s).
    ask_budget_seconds: float = 17.0

    # Timeouts
    node_query_timeout_seconds: float = 8.0


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
