"""/v1/ask de punta a punta con Node simulado: contrato HTTP, flujo y respuestas honestas."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.bridge import ask_service
from app.main import app

CLAVE = "clave-de-test"


class NodeFalso:
    """Imita el puerto interno de Node: registra cada consulta y responde filas fijas por dataset."""

    def __init__(self, filas: dict[str, list[dict[str, Any]]] | None = None, caido: bool = False):
        self.filas = filas or {}
        self.caido = caido
        self.consultas: list[dict[str, Any]] = []

    async def __call__(self, ticket: str, query: dict[str, Any]) -> dict[str, Any] | None:
        assert ticket == "t" * 43
        self.consultas.append(query)
        if self.caido:
            return None
        filas = self.filas.get(query["dataset"], [])
        return {"columns": list(filas[0]) if filas else [], "rows": filas, "rowCount": len(filas), "truncated": False}


@pytest.fixture
def node(monkeypatch):
    def instalar(**kw) -> NodeFalso:
        falso = NodeFalso(**kw)
        monkeypatch.setattr(ask_service, "ejecutar_en_node", falso)
        return falso

    return instalar


def preguntar(pregunta: str, catalogo, ref_iso, limits=None) -> dict[str, str]:
    return asyncio.run(
        ask_service.handle_ask(
            question=pregunta,
            ticket="t" * 43,
            catalog=catalogo,
            limits=limits or {"maxQueries": 2, "maxRows": 200},
            context={"referenceDate": ref_iso, "timezone": "America/Bogota"},
        )
    )


# ── Contrato HTTP ───────────────────────────────────────────────────────────


def test_health() -> None:
    assert TestClient(app).get("/health").json() == {"status": "up"}


@pytest.mark.parametrize("cabecera", [{}, {"X-Internal-Key": "otra"}, {"X-Internal-Key": ""}])
def test_v1_ask_exige_la_clave(cabecera) -> None:
    r = TestClient(app).post("/v1/ask", json={"question": "hola", "ticket": "t" * 43}, headers=cabecera)
    assert r.status_code == 401


def test_v1_ask_contrato_completo(node, catalogo_json, ref_iso) -> None:
    falso = node(filas={"bed_occupancy": [{"unit": "UNIDAD DE CUIDADO INTENSIVO", "sum_census": 29, "sum_physical_beds": 37, "avg_occupancy_pct": 78.38, "sum_virtual_census": 4}]})
    r = TestClient(app).post(
        "/v1/ask",
        headers={"X-Internal-Key": CLAVE},
        json={
            "question": "¿Cuántas camas de UCI están ocupadas hoy?",
            "ticket": "t" * 43,
            "catalog": catalogo_json,
            "limits": {"maxQueries": 2, "maxRows": 200},
            "context": {"referenceDate": ref_iso, "timezone": "America/Bogota"},
            "campoNuevoDeNode": "se ignora",
        },
    )
    assert r.status_code == 200
    cuerpo = r.json()
    assert set(cuerpo) == {"status", "answer", "visual"} and cuerpo["status"] == "ok"
    assert "29 camas ocupadas de 37" in cuerpo["answer"]
    # Una sola unidad: cifras destacadas; sin datos en la especificación (salen de las filas de Node).
    assert cuerpo["visual"]["type"] == "kpi" and cuerpo["visual"]["queryIndex"] == 0
    assert [c["key"] for c in cuerpo["visual"]["columns"]] == ["sum_census", "sum_physical_beds", "avg_occupancy_pct", "sum_virtual_census"]
    assert falso.consultas[0]["dataset"] == "bed_occupancy"


def test_v1_ask_sin_context_sigue_funcionando(node, catalogo_json) -> None:
    """Un Node anterior (sin `context` ni `values`) no rompe el contrato."""
    node(filas={"admissions": [{"count_all": 12}]})
    catalogo_viejo = [{**d, "dimensions": [{k: v for k, v in dim.items() if k != "values"} for dim in d["dimensions"]]} for d in catalogo_json]
    r = TestClient(app).post(
        "/v1/ask",
        headers={"X-Internal-Key": CLAVE},
        json={"question": "¿Cuántos ingresos hubo en agosto?", "ticket": "t" * 43, "catalog": catalogo_viejo},
    )
    assert r.status_code == 200 and r.json()["status"] == "ok"
    assert "12 ingresos" in r.json()["answer"]


# ── Flujo ───────────────────────────────────────────────────────────────────


def test_saludo_no_consulta_el_his(node, catalogo_json, ref_iso) -> None:
    falso = node()
    r = preguntar("Hola", catalogo_json, ref_iso)
    assert r["status"] == "ok" and "Susana-AI" in r["answer"]
    assert falso.consultas == []


def test_saludo_con_pregunta_si_consulta(node, catalogo_json, ref_iso) -> None:
    falso = node(filas={"bed_occupancy": [{"unit": "PEDIATRIA", "sum_census": 46, "sum_physical_beds": 38, "avg_occupancy_pct": 121.05, "sum_virtual_census": 18}]})
    r = preguntar("hola, ¿cuántas camas hay ocupadas en pediatría?", catalogo_json, ref_iso)
    assert r["status"] == "ok" and "46 camas ocupadas de 38" in r["answer"]
    assert len(falso.consultas) == 1


@pytest.mark.parametrize("pregunta", ["¿Qué dosis de acetaminofén le doy a un niño?", "Dame el nombre del paciente con más estancia"])
def test_rechazos_clinico_y_pii(node, catalogo_json, ref_iso, pregunta: str) -> None:
    falso = node()
    r = preguntar(pregunta, catalogo_json, ref_iso)
    assert r["status"] == "cannot_answer"
    assert falso.consultas == []


def test_ayuda_solo_ofrece_lo_permitido(node, catalogo_json, ref_iso) -> None:
    node()
    solo_farmacia = [d for d in catalogo_json if d["dataset"] in {"medications", "medication_inventory", "alerts"}]
    r = preguntar("¿Qué puedes hacer?", solo_farmacia, ref_iso)
    assert "inventario" in r["answer"] and "ocupación de camas" not in r["answer"]


def test_sin_permiso_lo_dice(node, catalogo_json, ref_iso) -> None:
    falso = node()
    solo_farmacia = [d for d in catalogo_json if d["dataset"] in {"medications", "medication_inventory"}]
    r = preguntar("¿Cuántas camas de UCI están ocupadas hoy?", solo_farmacia, ref_iso)
    assert r["status"] == "cannot_answer" and "no tiene acceso a los datos de ocupación de camas" in r["answer"]
    assert falso.consultas == []


def test_pregunta_fuera_de_dominio_sin_llm(node, catalogo_json, ref_iso) -> None:
    falso = node()
    r = preguntar("¿Cómo está el clima?", catalogo_json, ref_iso)
    assert r["status"] == "cannot_answer" and "No identifiqué" in r["answer"]
    assert falso.consultas == []


def test_node_caido_no_inventa(node, catalogo_json, ref_iso) -> None:
    node(caido=True)
    r = preguntar("¿Cuántos ingresos hubo en agosto?", catalogo_json, ref_iso)
    assert r["status"] == "cannot_answer" and "No pude obtener los datos" in r["answer"]
    assert not any(c.isdigit() for c in r["answer"])


def test_extras_respetan_el_cupo(node, catalogo_json, ref_iso) -> None:
    falso = node(filas={"medication_inventory": []})
    preguntar("¿Cuáles son los medicamentos con menos de 5 días de inventario?", catalogo_json, ref_iso, {"maxQueries": 1, "maxRows": 200})
    assert len(falso.consultas) == 1
    falso = node(filas={"medication_inventory": []})
    preguntar("¿Cuáles son los medicamentos con menos de 5 días de inventario?", catalogo_json, ref_iso, {"maxQueries": 2, "maxRows": 200})
    assert len(falso.consultas) == 2


def test_las_cuatro_preguntas_del_reto(node, catalogo_json, ref_iso) -> None:
    node(
        filas={
            "bed_occupancy": [{"unit": "UNIDAD DE CUIDADO INTENSIVO", "sum_census": 29, "sum_physical_beds": 37, "avg_occupancy_pct": 78.38, "sum_virtual_census": 4}],
            "medication_inventory": [{"name": "ACETAMINOFEN 500 mg TABLETA", "code": "N02BA001400", "risk": "CRITICAL", "min_days_of_inventory": 0.02, "sum_stock": 10, "min_avg_daily_consumption": 497.53}],
            "admissions": [{"unit": "URGENCIAS", "count_all": 1169, "avg_wait_minutes": 57.33921568627447}],
        }
    )
    esperado = {
        "¿Cuántas camas de UCI están ocupadas hoy?": "29 camas ocupadas de 37 camas físicas (78,38 % de ocupación)",
        "¿Cuáles son los medicamentos con menos de 5 días de inventario?": "ACETAMINOFEN 500 mg TABLETA: 0,02 días de inventario",
        "¿Cuál es el tiempo de espera promedio en urgencias en la última semana?": "fue de 57,3 minutos",
        "¿Qué servicio tiene más pacientes ingresados este mes?": "Urgencias es la unidad con más ingresos este mes",
    }
    for pregunta, fragmento in esperado.items():
        r = preguntar(pregunta, catalogo_json, ref_iso)
        assert r["status"] == "ok" and fragmento in r["answer"], (pregunta, r)
