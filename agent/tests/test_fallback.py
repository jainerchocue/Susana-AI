"""Fallback behavior when LLM is disabled."""

from __future__ import annotations

import pytest

from app.agent.nl2sql import NL2SQLGenerator
from app.llm.schemas import QueryPlan
from app.security.query_analyzer import QueryAnalyzer


def test_fallback_matches_four_demo_questions():
    gen = NL2SQLGenerator()
    questions = [
        "¿Cuántas camas de UCI están ocupadas hoy?",
        "¿Cuáles son los medicamentos con menos de 5 días de inventario?",
        "¿Cuál es el tiempo promedio de espera en urgencias durante la última semana?",
        "¿Qué servicio tiene más pacientes ingresados este mes?",
    ]
    for q in questions:
        match = gen.match_fallback(q)
        assert match is not None, f"Sin fallback para: {q}"
        assert match.sql.upper().startswith("SELECT")


@pytest.mark.asyncio
async def test_generate_uses_fallback_without_llm():
    gen = NL2SQLGenerator()
    plan = QueryPlan(intent="OCCUPANCY", tables=["Ingresos"], limit=100)
    result, used = await gen.generate("¿Cuántas camas de UCI están ocupadas hoy?", plan)
    assert used is True
    assert "UCI" in result.sql.upper() or "uci" in result.explanation.lower()


def test_fallback_sql_passes_validation():
    gen = NL2SQLGenerator()
    analyzer = QueryAnalyzer()
    for item in gen._fallback.get("queries", []):
        validation = analyzer.validate(item["sql"])
        assert validation.valid, f"{item['id']}: {validation.errors}"
        assert validation.has_limit
