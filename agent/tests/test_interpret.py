"""Tests for POST /internal/agent/interpret — 4 demo scenarios."""

from __future__ import annotations

import pytest

CASES = [
    {
        "question": "¿Cuántas camas de UCI están ocupadas hoy?",
        "intent": "OCCUPANCY",
        "columns": ["camas_ocupadas", "fecha_referencia"],
        "rows": [{"camas_ocupadas": 12, "fecha_referencia": "2026-08-15"}],
        "expect_substring": "12",
    },
    {
        "question": "¿Cuáles son los medicamentos con menos de 5 días de inventario?",
        "intent": "MEDICATION_STOCK",
        "columns": ["NombreServicio", "dias_inventario_estimado"],
        "rows": [
            {"NombreServicio": "AMOXICILINA 500MG", "dias_inventario_estimado": 2.1},
            {"NombreServicio": "IBUPROFENO 400MG", "dias_inventario_estimado": 4.0},
        ],
        "expect_substring": "AMOXICILINA",
    },
    {
        "question": "¿Cuál es el tiempo promedio de espera en urgencias?",
        "intent": "WAIT_TIME",
        "columns": ["horas_espera_promedio", "casos"],
        "rows": [{"horas_espera_promedio": 3.45, "casos": 120}],
        "expect_substring": "3.45",
    },
    {
        "question": "¿Qué servicio tiene más pacientes ingresados este mes?",
        "intent": "DEMAND",
        "columns": ["ViaIngreso", "total"],
        "rows": [
            {"ViaIngreso": "Urgencias", "total": 540},
            {"ViaIngreso": "Hospitalización", "total": 210},
        ],
        "expect_substring": "Urgencias",
    },
]


@pytest.mark.parametrize("case", CASES, ids=[c["intent"] for c in CASES])
def test_interpret_demo(client, api_headers, case):
    response = client.post(
        "/internal/agent/interpret",
        headers=api_headers,
        json={
            "question": case["question"],
            "intent": case["intent"],
            "columns": case["columns"],
            "rows": case["rows"],
            "metadata": {},
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["intent"] == case["intent"]
    assert case["expect_substring"] in data["answer"]
    assert data["confidence"] in {"HIGH", "MEDIUM", "LOW"}
    assert isinstance(data["insights"], list)


def test_interpret_empty_rows(client, api_headers):
    response = client.post(
        "/internal/agent/interpret",
        headers=api_headers,
        json={
            "question": "¿Cuántas camas de UCI están ocupadas hoy?",
            "intent": "OCCUPANCY",
            "columns": ["camas_ocupadas"],
            "rows": [],
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "no permiten" in data["answer"].lower() or "vacío" in data["answer"].lower() or "vacio" in data["answer"].lower()
