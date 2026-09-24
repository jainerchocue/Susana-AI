"""Comprensión determinista: tema, periodo, unidades, comparadores, ranking, charla."""

from __future__ import annotations

from datetime import datetime

import pytest

from app.bridge.nlu import (
    TZ,
    clasificar_conversacion,
    detectar_comparadores,
    detectar_periodo,
    detectar_ranking,
    detectar_tema,
    detectar_triage,
    interpretar,
    norm,
    resolver_unidades,
    resolver_valores,
    sin_comparadores,
    termino_nombre,
)


def d(*a: int) -> datetime:
    return datetime(*a, tzinfo=TZ)


@pytest.mark.parametrize(
    ("pregunta", "tema"),
    [
        ("¿Cuántas camas de UCI están ocupadas hoy?", "occupancy"),
        ("¿Cuáles son los medicamentos con menos de 5 días de inventario?", "inventory"),
        ("¿Cuál es el tiempo de espera promedio en urgencias en la última semana?", "wait"),
        ("¿Qué servicio tiene más pacientes ingresados este mes?", "admissions"),
        ("¿Cómo se ve la demanda la próxima semana?", "admissions"),
        ("¿Cuántos pacientes hay en urgencias?", "occupancy"),
        ("¿Cuántos pacientes hubo en urgencias en agosto?", "admissions"),
        ("Estancia promedio en la UCI", "stay"),
        ("Edad promedio de los pacientes de pediatría", "age"),
        ("Top 10 medicamentos más dispensados", "medications"),
        ("¿Qué medicamentos están en riesgo crítico?", "inventory"),
        ("¿Cuáles son los diagnósticos más frecuentes?", "diagnosis"),
        ("servicios de laboratorio clínico en agosto", "services"),
        ("¿Cuántas cirugías no se realizaron?", "surgeries"),
        ("¿Qué alertas críticas están abiertas?", "alerts"),
        ("Distribución por nivel de triage", "triage"),
        ("¿Cuánto se demoran en atender en urgencias?", "wait"),
        ("tiempo promedio de atención en urgencias", "wait"),
        ("¿Cuántos ingresos se esperan mañana?", "admissions"),  # "se esperan" es pronóstico, no espera
        ("¿Cómo está el clima?", None),
        # Paráfrasis frecuentes
        ("¿Cómo está urgencias?", "occupancy"),
        ("¿Qué tan llena está la UCI?", "occupancy"),
        ("dame un resumen del hospital", "occupancy"),
        ("¿Cuántas camas libres hay en pediatría?", "occupancy"),
        ("¿Cuántos pacientes llegaron ayer a urgencias?", "admissions"),
        ("¿Cuál es la tasa de cancelación de cirugías?", "surgeries"),
        ("los medicamentos que más se gastan", "medications"),
        ("¿Cuánto se demoran en atender a los niños?", "wait"),
    ],
)
def test_tema(pregunta: str, tema: str | None) -> None:
    assert detectar_tema(norm(pregunta)) == tema


REF = d(2026, 9, 21, 14, 33, 44)


@pytest.mark.parametrize(
    ("texto", "desde", "hasta", "etiqueta"),
    [
        ("hoy", d(2026, 9, 21), d(2026, 9, 22), "hoy"),
        ("ayer", d(2026, 9, 20), d(2026, 9, 21), "ayer"),
        ("en la ultima semana", d(2026, 9, 15), d(2026, 9, 22), "la última semana"),
        ("esta semana", d(2026, 9, 21), d(2026, 9, 22), "esta semana"),  # 21-sep-2026 es lunes
        ("la semana pasada", d(2026, 9, 14), d(2026, 9, 21), "la semana pasada"),
        ("este mes", d(2026, 9, 1), d(2026, 9, 22), "este mes"),
        ("el mes pasado", d(2026, 8, 1), d(2026, 9, 1), "el mes pasado"),
        ("los ultimos 3 dias", d(2026, 9, 19), d(2026, 9, 22), "los últimos 3 dias"),
        ("en agosto", d(2026, 8, 1), d(2026, 9, 1), "agosto de 2026"),
        ("en diciembre", d(2025, 12, 1), d(2026, 1, 1), "diciembre de 2025"),  # mes futuro -> año anterior
        ("del 1 al 15 de agosto", d(2026, 8, 1), d(2026, 8, 16), "del 1 al 15 de agosto de 2026"),
    ],
)
def test_periodo_relativo_a_la_fecha_de_corte(texto: str, desde: datetime, hasta: datetime, etiqueta: str) -> None:
    p = detectar_periodo(norm(texto), REF)
    assert p is not None
    assert (p.desde, p.hasta, p.etiqueta) == (desde, hasta, etiqueta)


def test_sin_periodo() -> None:
    assert detectar_periodo(norm("¿cuál es la espera promedio en urgencias?"), REF) is None


def test_pronostico_no_filtra_periodo() -> None:
    it = interpretar("¿Cómo se ve la demanda la próxima semana?", REF)
    assert it.pronostico and it.periodo is None


UNIDADES = [
    "GINECO OBSTRETICIA", "HOSPITALIZACION", "PEDIATRIA", "RECUPERACION", "SALA PARTOS", "UNIDAD DE CUIDADO BASICO",
    "UNIDAD DE CUIDADO INTENSIVO", "UNIDAD DE CUIDADO INTERMEDIO", "URGENCIAS",
]


@pytest.mark.parametrize(
    ("texto", "esperado"),
    [
        ("camas de uci", ["UNIDAD DE CUIDADO INTENSIVO"]),
        ("cuidados intensivos", ["UNIDAD DE CUIDADO INTENSIVO"]),
        ("unidad de cuidado intermedio", ["UNIDAD DE CUIDADO INTERMEDIO"]),
        ("urgencias", ["URGENCIAS"]),
        ("emergencias", ["URGENCIAS"]),
        ("pediatria", ["PEDIATRIA"]),
        ("ginecobstetricia", ["GINECO OBSTRETICIA"]),
        ("sala de partos", ["SALA PARTOS"]),
        ("urgencias y hospitalizacion", ["HOSPITALIZACION", "URGENCIAS"]),
        ("todo el hospital", []),
    ],
)
def test_unidades_se_resuelven_a_valores_reales(texto: str, esperado: list[str]) -> None:
    assert sorted(resolver_unidades(norm(texto), UNIDADES)) == sorted(esperado)


def test_unidades_sin_vocabulario_no_inventa() -> None:
    assert resolver_unidades("uci", []) == []


def test_comparadores() -> None:
    [c] = detectar_comparadores(norm("pacientes que esperaron más de 2 horas"))
    assert (c.op, c.valor, c.unidad) == ("gt", 2, "horas")
    [c] = detectar_comparadores(norm("mayores de 60 años"))
    assert (c.op, c.valor, c.unidad) == ("gte", 60, "anos")
    [c] = detectar_comparadores(norm("con menos de cinco días de inventario"))
    assert (c.op, c.valor, c.unidad) == ("lt", 5, "dias")
    [c] = detectar_comparadores(norm("ocupación superior al 90%"))
    assert (c.op, c.valor, c.unidad) == ("gt", 90, "pct")
    assert detectar_comparadores(norm("más de lo normal")) == []


def test_ranking_ignora_comparadores() -> None:
    t = norm("medicamentos con menos de 5 días de inventario")
    assert detectar_ranking(sin_comparadores(t)) == (None, None)
    assert detectar_ranking(norm("¿qué unidad está menos ocupada?")) == ("asc", None)
    assert detectar_ranking(norm("los 5 diagnósticos más frecuentes")) == ("desc", 5)
    assert detectar_ranking(norm("top 10 medicamentos")) == ("desc", 10)
    assert detectar_ranking(norm("al menos un ingreso")) == (None, None)


def test_triage() -> None:
    assert detectar_triage(norm("pacientes con triage 2")) == [2]
    assert detectar_triage(norm("niveles 1 y 2")) == [1, 2]
    assert detectar_triage(norm("triage III")) == [3]
    assert detectar_triage(norm("espera por nivel de triage")) == []


@pytest.mark.parametrize(
    ("dim", "texto", "valores", "esperado"),
    [
        ("patient_sex", "cuantas mujeres ingresaron", ["Femenino", "Masculino"], ["Femenino"]),
        ("executed", "cirugias que no se realizaron", ["si", "no", "desconocido"], ["no"]),
        ("executed", "cirugias realizadas", ["si", "no", "desconocido"], ["si"]),
        ("status", "alertas activas", ["OPEN", "ACKNOWLEDGED", "RESOLVED"], ["OPEN", "ACKNOWLEDGED"]),
        ("severity", "alertas criticas", ["WARNING", "CRITICAL"], ["CRITICAL"]),
        ("area", "servicios de laboratorio clinico", ["APOYO DIAGNOSTICO - LABORATORIO CLINICO", "APOYO TERAPEUTICO - FARMACIA"], ["APOYO DIAGNOSTICO - LABORATORIO CLINICO"]),
        # "farmacia" es tema, no filtro de área.
        ("area", "consumo de medicamentos en farmacia", ["APOYO TERAPEUTICO - FARMACIA"], []),
        ("patient_sex", "mujeres", [], []),  # sin vocabulario no hay filtro
    ],
)
def test_valores_de_dimension(dim: str, texto: str, valores: list[str], esperado: list[str]) -> None:
    assert resolver_valores(norm(texto), dim, valores) == esperado


@pytest.mark.parametrize(
    ("pregunta", "esperado"),
    [
        ("¿Cuántas dosis de acetaminofén se dispensaron en agosto?", "acetaminofen"),
        ("¿Cuántos ingresos por infección de vías urinarias hubo en julio?", "infeccion de vias urinarias"),
        ("Top 10 medicamentos más dispensados en agosto", None),
        ("¿Cuántos ingresos hubo durante el fin de semana?", None),
        ("¿Cuáles son los medicamentos con menos de 5 días de inventario?", None),
        ("¿Qué servicio tiene más pacientes ingresados este mes?", None),
    ],
)
def test_termino_nombre(pregunta: str, esperado: str | None) -> None:
    assert termino_nombre(sin_comparadores(norm(pregunta))) == esperado


@pytest.mark.parametrize(
    ("texto", "tipo"),
    [
        ("Hola", "greeting"),
        ("buenos días", "greeting"),
        ("gracias", "thanks"),
        ("¿Qué puedes hacer?", "help"),
        ("¿quién eres?", "help"),
        ("¿Qué dosis de acetaminofén le doy a un niño?", "clinical"),
        ("tengo dolor de cabeza, qué tomo", "clinical"),
        ("Dame el nombre del paciente con más estancia", "pii"),
        ("¿Cuántas dosis de acetaminofén se dispensaron?", None),  # dato operativo, no consejo
        ("¿Cuántas camas hay en la UCI?", None),
    ],
)
def test_conversacion(texto: str, tipo: str | None) -> None:
    assert clasificar_conversacion(norm(texto)) == tipo
