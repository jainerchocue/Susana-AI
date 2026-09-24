"""Tests for POST /internal/agent/analyze — 4 demo questions."""

from __future__ import annotations

import pytest

DEMO_QUESTIONS = [
    {
        "question": "¿Cuántas camas de UCI están ocupadas hoy?",
        "intent": "OCCUPANCY",
        "expects_sql": True,
    },
    {
        "question": "¿Cuáles son los medicamentos con menos de 5 días de inventario?",
        "intent": "MEDICATION_STOCK",
        "expects_sql": True,
    },
    {
        "question": "¿Cuál es el tiempo promedio de espera en urgencias durante la última semana?",
        "intent": "WAIT_TIME",
        "expects_sql": True,
    },
    {
        "question": "¿Qué servicio tiene más pacientes ingresados este mes?",
        "intent": "DEMAND",
        "expects_sql": True,
    },
]


@pytest.mark.parametrize("case", DEMO_QUESTIONS, ids=[c["intent"] for c in DEMO_QUESTIONS])
def test_analyze_demo_questions(client, api_headers, case):
    response = client.post(
        "/internal/agent/analyze",
        headers=api_headers,
        json={
            "question": case["question"],
            "user_context": {"role": "FARMACIA", "permissions": ["assistant:use"]},
            "conversation": [],
            "schema_version": "1.0",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["intent"] == case["intent"]
    assert data["rejected"] is False
    assert data["proposed_query"] is not None
    sql = data["proposed_query"]["sql"].upper()
    assert sql.strip().startswith("SELECT")
    assert "LIMIT" in sql
    assert data.get("fallback_used") is True  # LLM disabled in tests


def test_analyze_rejects_clinical(client, api_headers):
    response = client.post(
        "/internal/agent/analyze",
        headers=api_headers,
        json={"question": "¿Qué debo recetar a este paciente con fiebre?"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["rejected"] is True
    assert data["intent"] == "OUT_OF_DOMAIN"


def test_analyze_requires_api_key(client):
    response = client.post(
        "/internal/agent/analyze",
        json={"question": "¿Cuántas camas de UCI están ocupadas hoy?"},
    )
    assert response.status_code == 401


def test_health(client):
    response = client.get("/internal/agent/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
