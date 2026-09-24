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
    # (en el backend se llama AGENT_API_KEY)
    agent_api_key: str = ""
    # Alias legacy (demo flujo.html / rutas /internal/agent/*)
    internal_api_key: str = "change-me-internal-key"

    rate_limit_per_minute: int = 60

    # Callback hacia Node (puerto interno)
    node_internal_url: str = "http://127.0.0.1:3001"
    # Clave que Python envía a Node en POST /internal/agent/query
    node_internal_api_key: str = ""

    # LLM (OpenRouter — OpenAI compatible)
    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    llm_model: str = "openai/gpt-4o-mini"
    llm_timeout_seconds: float = 30.0
    llm_max_tokens: int = 2048
    llm_temperature: float = 0.1
    llm_enabled: bool = True

    # Paths
    prompts_dir: Path = AGENT_ROOT / "prompts"
    data_dir: Path = AGENT_ROOT / "data"
    sqlite_path: Path = AGENT_ROOT / "data" / "hospital.db"
    # docs del monorepo hackaton (padre de Susana-AI)
    docs_dir: Path = AGENT_ROOT.parent.parent / "docs"
    diccionario_path: Path = AGENT_ROOT.parent.parent / "docs" / "diccionario.txt"
    glosario_path: Path = AGENT_ROOT.parent.parent / "docs" / "glosario.txt"
    raw_data_dir: Path = (
        AGENT_ROOT.parent.parent / "docs" / "OneDrive_1_9-23-2026" / "Datos"
    )

    # Timeouts / limits
    request_timeout_seconds: float = 60.0
    analysis_timeout_seconds: float = 45.0
    node_query_timeout_seconds: float = 25.0
    max_question_length: int = 2000
    default_sql_limit: int = 100
    schema_version: str = "1.0"

    def expected_ask_key(self) -> str:
        """Clave válida para /v1/ask (prioriza AGENT_API_KEY)."""
        return (self.agent_api_key or self.internal_api_key).strip()


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
