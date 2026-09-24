"""Especificación de tabla/gráfica: el tipo adecuado, columnas reales del resultado y cero datos propios."""

from __future__ import annotations

from datetime import timedelta

from app.bridge.narrator import redactar_con_visual
from app.bridge.nlu import interpretar
from app.bridge.planner import Plan, planificar


def plan_de(pregunta: str, cat, ref) -> Plan:
    p = planificar(interpretar(pregunta, ref), cat, max_rows=200, ref=ref)
    assert isinstance(p, Plan)
    return p


def res(rows: list[dict]) -> dict:
    return {"columns": list(rows[0]) if rows else [], "rows": rows, "rowCount": len(rows), "truncated": False}


def visual(pregunta: str, filas: list[dict], cat, ref, extras: list[list[dict]] | None = None) -> dict | None:
    p = plan_de(pregunta, cat, ref)
    return redactar_con_visual(p, [res(filas), *[res(e) for e in extras or []]], ref)[1]


def test_kpi_para_una_cifra(cat, ref) -> None:
    v = visual("¿Cuál es el tiempo de espera promedio en urgencias en la última semana?", [{"avg_wait_minutes": 57.3392}], cat, ref)
    assert v == {
        "title": "Tiempos de espera",
        "subtitle": "en Urgencias · durante la última semana (del 15 al 21 de septiembre de 2026)",
        "queryIndex": 0,
        "type": "kpi",
        "columns": [{"key": "avg_wait_minutes", "label": "Espera promedio", "decimals": 1, "unit": "min"}],
    }


def test_barras_por_unidad_con_etiquetas_legibles(cat, ref) -> None:
    filas = [{"unit": "URGENCIAS", "count_all": 1169}, {"unit": "PEDIATRIA", "count_all": 409}]
    v = visual("¿Qué servicio tiene más pacientes ingresados este mes?", filas, cat, ref)
    assert v["type"] == "bar" and v["x"] == "unit" and v["xLabel"] == "Unidad"
    assert v["columns"] == [{"key": "count_all", "label": "Ingresos", "decimals": 0}]
    assert v["valueLabels"] == {"URGENCIAS": "Urgencias", "PEDIATRIA": "Pediatria"}


def test_ocupacion_varias_unidades_dos_series(cat, ref) -> None:
    filas = [
        {"unit": "PEDIATRIA", "sum_census": 46, "sum_physical_beds": 38, "avg_occupancy_pct": 121.05, "sum_virtual_census": 18},
        {"unit": "URGENCIAS", "sum_census": 60, "sum_physical_beds": 65, "avg_occupancy_pct": 92.31, "sum_virtual_census": 45},
    ]
    v = visual("¿Cuál es la ocupación del hospital?", filas, cat, ref)
    assert v["type"] == "bar"
    assert [c["key"] for c in v["columns"]] == ["sum_census", "sum_physical_beds"]


def test_ocupacion_una_unidad_es_kpi_con_la_unidad(cat, ref) -> None:
    fila = {"unit": "UNIDAD DE CUIDADO INTENSIVO", "sum_census": 29, "sum_physical_beds": 37, "avg_occupancy_pct": 78.38, "sum_virtual_census": 4}
    v = visual("¿Cuántas camas de UCI están ocupadas hoy?", [fila], cat, ref)
    assert v["type"] == "kpi" and "Unidad de Cuidado Intensivo" in v["subtitle"]
    assert v["title"] == "Ocupación de camas"


def test_inventario_es_tabla_con_riesgo_traducido(cat, ref) -> None:
    fila = {"name": "ACETAMINOFEN 500 mg TABLETA", "code": "N02BA001400", "risk": "CRITICAL", "min_days_of_inventory": 0.02, "sum_stock": 10, "min_avg_daily_consumption": 497.53}
    v = visual("¿Cuáles son los medicamentos con menos de 5 días de inventario?", [fila], cat, ref, [[{"risk": "CRITICAL", "count_all": 1}]])
    assert v["type"] == "table" and v["title"] == "Inventario de medicamentos"
    assert [c["key"] for c in v["columns"]] == ["name", "code", "risk", "min_days_of_inventory", "sum_stock", "min_avg_daily_consumption"]
    assert v["valueLabels"]["CRITICAL"] == "crítico"


def test_linea_con_proyeccion_y_dia_de_corte_omitido(cat, ref) -> None:
    filas = [{"admitted_at": (ref - timedelta(days=i)).strftime("%Y-%m-%dT00:00:00.000Z"), "count_all": 100 + (i % 7) * 5} for i in range(40)]
    v = visual("¿Cómo se ve la demanda la próxima semana?", filas, cat, ref)
    assert v["type"] == "line" and v["x"] == "admitted_at" and v["grain"] == "day" and v["fillMissing"] is True
    assert v["omit"] == ["2026-09-21T00:00:00.000Z"]  # el día de corte está incompleto
    puntos = v["projection"]["points"]
    assert [p["x"] for p in puntos] == [f"2026-09-{d}" for d in range(22, 29)]
    assert all(isinstance(p["y"], float) for p in puntos)


def test_serie_semanal_omite_periodos_incompletos(cat, ref) -> None:
    filas = [{"admitted_at": f"2026-{m}T00:00:00.000Z", "count_all": v} for m, v in [("09-07", 400), ("09-14", 410), ("09-21", 60)]]
    v = visual("Tendencia de ingresos en urgencias", filas, cat, ref)
    assert v["type"] == "line" and v["grain"] == "week" and v["omit"] == ["2026-09-21T00:00:00.000Z"]
    assert "projection" not in v


def test_promedio_por_dia_no_rellena_ceros(cat, ref) -> None:
    filas = [{"admitted_at": "2026-09-01T00:00:00.000Z", "avg_wait_minutes": 60.0}, {"admitted_at": "2026-09-03T00:00:00.000Z", "avg_wait_minutes": 55.0}]
    v = visual("espera promedio por día en urgencias este mes", filas, cat, ref)
    assert v["type"] == "line" and "fillMissing" not in v and "omit" not in v


def test_muchas_categorias_pasan_a_tabla(cat, ref) -> None:
    filas = [{"diagnosis_name": f"DIAGNOSTICO {i}", "count_all": 100 - i} for i in range(20)]
    v = visual("Distribución de ingresos por diagnóstico", filas, cat, ref)
    assert v["type"] == "table"


def test_sin_filas_no_hay_visual(cat, ref) -> None:
    assert visual("¿Cuántas cirugías no se realizaron?", [], cat, ref) is None


def test_las_columnas_existen_en_las_filas(cat, ref) -> None:
    """Node rechazaría una columna que no esté en el resultado: el agente nunca la propone."""
    casos = {
        "Tiempo de espera por nivel de triage": [{"triage_level": 1, "avg_wait_minutes": 26.7}, {"triage_level": 2, "avg_wait_minutes": 47.8}],
        "alertas activas por tipo": [{"type": "HIGH_OCCUPANCY", "count_all": 4}, {"type": "LOW_STOCK", "count_all": 1}],
        "Top 3 medicamentos más dispensados en agosto": [{"name": "OXIGENO", "sum_quantity": 1}, {"name": "GASA", "sum_quantity": 2}],
    }
    for pregunta, filas in casos.items():
        v = visual(pregunta, filas, cat, ref)
        claves = {c["key"] for c in v["columns"]} | ({v["x"]} if "x" in v else set())
        assert claves <= set(filas[0]), (pregunta, v)
