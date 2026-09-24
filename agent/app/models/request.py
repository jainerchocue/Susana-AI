"""Request models for analyze / interpret endpoints."""

from typing import Any

from pydantic import BaseModel, Field, field_validator


class UserContext(BaseModel):
    role: str = "ANALYST"
    permissions: list[str] = Field(default_factory=list)


class ConversationTurn(BaseModel):
    role: str
    content: str


class AnalyzeRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    user_context: UserContext = Field(default_factory=UserContext)
    conversation: list[ConversationTurn] = Field(default_factory=list)
    schema_version: str = "1.0"

    @field_validator("question")
    @classmethod
    def strip_question(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("question cannot be empty")
        return cleaned


class InterpretRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    intent: str | None = None
    sql: str | None = None
    rows: list[dict[str, Any]] = Field(default_factory=list)
    columns: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    user_context: UserContext = Field(default_factory=UserContext)
    conversation: list[ConversationTurn] = Field(default_factory=list)
