"""Pregunta -> consulta DSL: exacta para las preguntas del reto y siempre válida para Node."""

from __future__ import annotations

from typing import Any

import pytest

from app.bridge.dsl import Catalogo, validar
from app.bridge.nlu import interpretar
from app.bridge.planner import Plan, SinPlan, planificar


def plan(pregunta: str, cat: Catalogo, ref, max_rows: int = 200) -> Plan:
    p = planificar(interpretar(pregunta, ref), cat, max_rows=max_rows, ref=ref)
    assert isinstance(p, Plan), p
    return p


def filtros(p: Plan) -> dict[str, Any]:
    return {f["field"] + ":" + f["op"]: f["value"] for f in p.consulta.get("filters", [])}


# ── Las 4 preguntas oficiales del reto (+ la de predicción) ──────────────────


def test_camas_uci_ocupadas_hoy(cat, ref) -> None:
    p = plan("¿Cuántas camas de UCI están ocupadas hoy?", cat, ref)
    assert p.consulta == {
        "dataset": "bed_occupancy",
        "metrics": [
            {"agg": "sum", "field": "census"},
            {"agg": "sum", "field": "physical_beds"},
            {"agg": "avg", "field": "occupancy_pct"},
            {"agg": "sum", "field": "virtual_census"},
        ],
        "groupBy": [{"field": "unit"}],
        "filters": [{"field": "unit", "op": "eq", "value": "UNIDAD DE CUIDADO INTENSIVO"}],
        "orderBy": [{"ref": "metric:2", "dir": "desc"}],
        "limit": 50,
    }
    assert p.avisos == []  # "hoy" ES la foto al corte: no hay aviso


def test_medicamentos_menos_de_5_dias(cat, ref) -> None:
    p = plan("¿Cuáles son los medicamentos con menos de 5 días de inventario?", cat, ref)
    assert p.dataset == "medication_inventory"
    assert p.consulta["filters"] == [{"field": "days_of_inventory", "op": "lt", "value": 5}]
    assert p.consulta["orderBy"] == [{"ref": "metric:0", "dir": "asc"}]
    assert p.consulta["groupBy"] == [{"field": "name"}, {"field": "code"}, {"field": "risk"}]
    # Contexto honesto: cuántos medicamentos tienen stock registrado.
    assert p.extras == [{"dataset": "medication_inventory", "metrics": [{"agg": "count"}], "groupBy": [{"field": "risk"}], "limit": 10}]


def test_espera_urgencias_ultima_semana(cat, ref) -> None:
    p = plan("¿Cuál es el tiempo de espera promedio en urgencias en la última semana?", cat, ref)
    assert p.consulta == {
        "dataset": "admissions",
        "metrics": [{"agg": "avg", "field": "wait_minutes"}],
        "filters": [
            {"field": "unit", "op": "eq", "value": "URGENCIAS"},
            {"field": "admitted_at", "op": "gte", "value": "2026-09-15T00:00:00-05:00"},
            {"field": "admitted_at", "op": "lt", "value": "2026-09-22T00:00:00-05:00"},
        ],
        "limit": 1,
    }
    assert "durante la última semana (del 15 al 21 de septiembre de 2026)" in p.alcance


def test_servicio_con_mas_ingresos_este_mes(cat, ref) -> None:
    p = plan("¿Qué servicio tiene más pacientes ingresados este mes?", cat, ref)
    assert p.consulta["dataset"] == "admissions"
    assert p.consulta["metrics"] == [{"agg": "count"}]
    assert p.consulta["groupBy"] == [{"field": "unit"}]
    assert p.consulta["orderBy"] == [{"ref": "metric:0", "dir": "desc"}]
    assert filtros(p) == {"admitted_at:gte": "2026-09-01T00:00:00-05:00", "admitted_at:lt": "2026-09-22T00:00:00-05:00"}
    assert p.ranking == "desc"


def test_demanda_proxima_semana(cat, ref) -> None:
    p = plan("¿Cómo se ve la demanda la próxima semana?", cat, ref)
    assert p.pronostico and p.horizonte == 7
    assert p.consulta == {
        "dataset": "admissions",
        "metrics": [{"agg": "count"}],
        "groupBy": [{"field": "admitted_at", "grain": "day"}],
        "orderBy": [{"ref": "admitted_at", "dir": "desc"}],  # los días MÁS recientes
        "limit": 120,
    }


# ── Casos concretos ─────────────────────────────────────────────────────────


def test_cuantos_esperaron_mas_de_2_horas_cuenta_pacientes(cat, ref) -> None:
    p = plan("¿Cuántos pacientes esperaron más de 2 horas en urgencias este mes?", cat, ref)
    assert p.consulta["metrics"] == [{"agg": "count"}] and p.pide_conteo
    assert filtros(p)["wait_minutes:gt"] == 120
    assert filtros(p)["unit:eq"] == "URGENCIAS"


def test_cirugias_no_realizadas_filtra_y_da_contexto(cat, ref) -> None:
    p = plan("¿Cuántas cirugías no se realizaron?", cat, ref)
    assert filtros(p) == {"executed:eq": "no"}
    assert "groupBy" not in p.consulta
    assert p.extras and p.extras[0]["groupBy"] == [{"field": "executed"}]


def test_programadas_vs_ejecutadas_agrupa(cat, ref) -> None:
    p = plan("cirugías programadas vs ejecutadas", cat, ref)
    assert p.consulta["groupBy"] == [{"field": "executed"}]
    assert "filters" not in p.consulta


def test_alertas_criticas_abiertas(cat, ref) -> None:
    p = plan("¿Qué alertas críticas están abiertas?", cat, ref)
    assert filtros(p) == {"severity:eq": "CRITICAL", "status:eq": "OPEN"}
    assert p.consulta["groupBy"] == [{"field": "type"}]


def test_nombre_libre_contains(cat, ref) -> None:
    p = plan("¿Cuántas dosis de acetaminofén se dispensaron en agosto?", cat, ref)
    assert filtros(p)["name:contains"] == "acetaminofen"
    p = plan("¿Cuántos ingresos por apendicitis hubo?", cat, ref)
    assert filtros(p)["diagnosis_name:contains"] == "apendicitis"


def test_porcentaje_agrupa_en_vez_de_filtrar(cat, ref) -> None:
    p = plan("¿Qué porcentaje de pacientes son del régimen subsidiado?", cat, ref)
    assert p.consulta["groupBy"] == [{"field": "patient_regime"}]
    assert "filters" not in p.consulta


def test_foto_con_periodo_avisa(cat, ref) -> None:
    p = plan("ocupación de camas en agosto", cat, ref)
    assert "filters" not in p.consulta
    assert p.avisos and "foto" in p.avisos[0]


def test_sin_permiso_no_consulta(catalogo_json, ref) -> None:
    solo_alertas = Catalogo([d for d in catalogo_json if d["dataset"] == "alerts"])
    p = planificar(interpretar("¿Cuántas camas de UCI están ocupadas?", ref), solo_alertas, max_rows=200, ref=ref)
    assert isinstance(p, SinPlan) and p.motivo == "sin_permiso"


def test_sin_tema(cat, ref) -> None:
    p = planificar(interpretar("¿Cómo está el clima?", ref), cat, max_rows=200, ref=ref)
    assert isinstance(p, SinPlan) and p.motivo == "sin_tema"


def test_limite_respeta_max_rows(cat, ref) -> None:
    p = plan("Ingresos por día en pediatría", cat, ref, max_rows=30)
    assert p.consulta["limit"] == 30


# ── Batería: todo plan debe ser válido para Node ─────────────────────────────

BATERIA = [
    "¿Cuántas camas de UCI están ocupadas hoy?",
    "¿Cuál es la ocupación del hospital?",
    "¿Qué unidad está menos ocupada?",
    "¿Cuántos pacientes hay en urgencias?",
    "¿Cuál es el porcentaje de ocupación de la unidad de cuidado intermedio?",
    "unidades con ocupación superior al 90%",
    "¿Cuáles son los medicamentos con menos de 5 días de inventario?",
    "¿Qué medicamentos están en riesgo crítico?",
    "¿Cuál es el stock de la gasa estéril?",
    "inventario de insumos",
    "¿Cuál es el tiempo de espera promedio en urgencias en la última semana?",
    "Tiempo de espera por nivel de triage",
    "¿Qué unidad tiene la mayor espera?",
    "espera promedio por día en urgencias este mes",
    "¿Cuántos pacientes esperaron más de 2 horas en urgencias este mes?",
    "Estancia promedio en la UCI",
    "estancias de más de 5 días en hospitalización",
    "¿Cuál es la edad promedio de los pacientes de pediatría?",
    "¿Cuántos pacientes mayores de 60 años ingresaron en septiembre?",
    "¿Qué servicio tiene más pacientes ingresados este mes?",
    "¿Cuántos ingresos hubo en urgencias en agosto?",
    "Ingresos por día en pediatría la última semana",
    "ingresos semanales por unidad",
    "¿Qué día hubo más ingresos este mes?",
    "¿Qué mes tuvo más ingresos?",
    "Distribución de ingresos por sexo",
    "¿Cuántas mujeres ingresaron a ginecobstetricia en julio?",
    "ingresos del régimen subsidiado por unidad",
    "¿Cuántos pacientes rurales hay por unidad?",
    "¿Cuántos ingresos con triage 1 hubo ayer?",
    "Comparar urgencias y hospitalización en ingresos este mes",
    "¿Cuántos pacientes remitidos ingresaron del 1 al 15 de agosto?",
    "¿Qué porcentaje de pacientes son del régimen subsidiado?",
    "¿Cuáles son los 5 diagnósticos más frecuentes en urgencias?",
    "¿Cuántos ingresos por infección de vías urinarias hubo en julio?",
    "Estancia promedio de pacientes con sepsis",
    "Top 10 medicamentos más dispensados en agosto",
    "¿Cuántas unidades de medicamentos se dispensaron este mes?",
    "¿Qué insumos se consumen más?",
    "consumo de medicamentos por especialidad",
    "¿Cuántas dosis de acetaminofén se dispensaron en agosto?",
    "¿Qué procedimientos se prestaron más este mes?",
    "servicios de laboratorio clínico en agosto",
    "¿Cuántas cirugías no se realizaron?",
    "¿Qué procedimientos quirúrgicos se programan más?",
    "cirugías programadas vs ejecutadas",
    "¿Cuántas cirugías de colecistectomía se programaron?",
    "¿Qué alertas críticas están abiertas?",
    "alertas activas por tipo",
    "¿Cuántas alertas de stock hay?",
    "Tendencia de ingresos en urgencias",
    "Evolución mensual de la espera en urgencias",
    "¿Cómo se ve la demanda la próxima semana?",
    "¿Cuántos ingresos se esperan mañana en urgencias?",
    "Proyección de consumo de medicamentos para los próximos días",
    "¿Cómo va a estar la ocupación la próxima semana?",
    "pronóstico de la espera en urgencias",
    "¿Cómo está urgencias?",
    "¿Qué tan llena está la UCI?",
    "dame un resumen del hospital",
    "¿Cuántas camas libres hay en pediatría?",
    "¿Cuántos pacientes llegaron ayer a urgencias?",
    "¿Cuál es la tasa de cancelación de cirugías?",
    "los medicamentos que más se gastan",
    "¿Qué porcentaje de los ingresos son de urgencias?",
    "¿Cuántos niños ingresaron este mes?",
    "pronóstico de ocupación de la UCI para mañana",
    "urgencias vs hospitalización: espera promedio",
    "estancia media en hospitalización en julio",
]


@pytest.mark.parametrize("pregunta", BATERIA)
def test_todo_plan_es_valido_para_node(pregunta: str, cat, ref) -> None:
    p = plan(pregunta, cat, ref)
    assert validar(p.consulta, cat, 200) == [], p.consulta
    for extra in p.extras:
        assert validar(extra, cat, 200) == []
    # Ningún filtro de texto con "eq"/"in" usa un valor fuera del vocabulario real.
    for f in p.consulta.get("filters", []):
        valores = cat.values(p.dataset, f["field"])
        if valores and f["op"] in {"eq", "in"}:
            propuestos = f["value"] if isinstance(f["value"], list) else [f["value"]]
            assert set(propuestos) <= set(valores), f


def test_porcentaje_de_una_unidad_agrupa_por_unidad(cat, ref) -> None:
    p = plan("¿Qué porcentaje de los ingresos son de urgencias?", cat, ref)
    assert p.consulta["groupBy"] == [{"field": "unit"}] and "filters" not in p.consulta


def test_tasa_de_cancelacion(cat, ref) -> None:
    p = plan("¿Cuál es la tasa de cancelación de cirugías?", cat, ref)
    assert p.consulta["filters"] == [{"field": "executed", "op": "eq", "value": "no"}]
    assert p.extras  # la distribución total para calcular la tasa
