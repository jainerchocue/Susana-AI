"""Filas -> texto: cada cifra sale de las filas; sin filas, se dice; nunca se rellena."""

from __future__ import annotations

import re
from datetime import datetime, timedelta

from app.bridge.nlu import TZ, interpretar
from app.bridge.narrator import describir_filtros, redactar
from app.bridge.planner import Plan, planificar
from app.bridge.textos import fmt_num, rango_fechas


def plan_de(pregunta: str, cat, ref) -> Plan:
    p = planificar(interpretar(pregunta, ref), cat, max_rows=200, ref=ref)
    assert isinstance(p, Plan)
    return p


def res(rows: list[dict], truncated: bool = False) -> dict:
    return {"columns": list(rows[0]) if rows else [], "rows": rows, "rowCount": len(rows), "truncated": truncated}


def test_formato_numeros() -> None:
    assert fmt_num(7489, 0) == "7.489"
    assert fmt_num(57.33921568, 1) == "57,3"
    assert fmt_num(78.38, 2) == "78,38"
    assert fmt_num(100.0, 2) == "100"
    assert fmt_num(1234567.891, 2) == "1.234.567,89"


def test_rango_fechas() -> None:
    assert rango_fechas(datetime(2026, 9, 15, tzinfo=TZ), datetime(2026, 9, 22, tzinfo=TZ)) == "del 15 al 21 de septiembre de 2026"
    assert rango_fechas(datetime(2026, 9, 21, tzinfo=TZ), datetime(2026, 9, 22, tzinfo=TZ)) == "21 de septiembre de 2026"


def test_ocupacion_uci(cat, ref) -> None:
    p = plan_de("¿Cuántas camas de UCI están ocupadas hoy?", cat, ref)
    fila = {"unit": "UNIDAD DE CUIDADO INTENSIVO", "sum_census": 29, "sum_physical_beds": 37, "avg_occupancy_pct": 78.38, "sum_virtual_census": 4}
    texto = redactar(p, [res([fila])], ref)
    assert "21 de septiembre de 2026 a las 14:33" in texto
    assert "29 camas ocupadas de 37 camas físicas (78,38 % de ocupación)" in texto
    assert "4 pacientes en camas virtuales" in texto
    assert "censo es estimado" in texto


def test_ocupacion_global_suma_y_destaca(cat, ref) -> None:
    p = plan_de("¿Cuál es la ocupación del hospital?", cat, ref)
    filas = [
        {"unit": "PEDIATRIA", "sum_census": 46, "sum_physical_beds": 38, "avg_occupancy_pct": 121.05, "sum_virtual_census": 18},
        {"unit": "URGENCIAS", "sum_census": 60, "sum_physical_beds": 65, "avg_occupancy_pct": 92.31, "sum_virtual_census": 0},
        {"unit": "SALA PARTOS", "sum_census": 5, "sum_physical_beds": 6, "avg_occupancy_pct": 83.33, "sum_virtual_census": 0},
    ]
    texto = redactar(p, [res(filas)], ref)
    assert "111 camas ocupadas de 109 camas físicas (101,83 % de ocupación global)" in texto  # 111/109
    assert texto.index("Pediatria (121,05 %") < texto.index("Urgencias (92,31 %")
    assert "1 unidad supera el 100 % de su capacidad física: Pediatria" in texto


def test_ocupacion_menos_ocupada_ordena_ascendente(cat, ref) -> None:
    p = plan_de("¿Qué unidad está menos ocupada?", cat, ref)
    filas = [
        {"unit": "A", "sum_census": 9, "sum_physical_beds": 10, "avg_occupancy_pct": 90.0, "sum_virtual_census": 0},
        {"unit": "B", "sum_census": 5, "sum_physical_beds": 10, "avg_occupancy_pct": 50.0, "sum_virtual_census": 0},
    ]
    assert "menor ocupación son B (50 %" in redactar(p, [res(filas)], ref)


def test_inventario_con_resultados_y_contexto(cat, ref) -> None:
    p = plan_de("¿Cuáles son los medicamentos con menos de 5 días de inventario?", cat, ref)
    fila = {"name": "ACETAMINOFEN 500 mg TABLETA", "code": "N02BA001400", "risk": "CRITICAL", "min_days_of_inventory": 0.02, "sum_stock": 10, "min_avg_daily_consumption": 497.53}
    riesgo = [{"risk": "CRITICAL", "count_all": 1}, {"risk": "insufficient_data", "count_all": 1}]
    texto = redactar(p, [res([fila]), res(riesgo)], ref)
    assert "hay 1 medicamento con inventario menor a 5 días" in texto
    assert "ACETAMINOFEN 500 mg TABLETA: 0,02 días de inventario (stock de 10 unidades y consumo medio de 497,53 por día), riesgo crítico" in texto
    assert "En total, 2 medicamentos tienen stock registrado" in texto


def test_inventario_vacio_dice_la_verdad(cat, ref) -> None:
    p = plan_de("¿Cuáles son los medicamentos con menos de 5 días de inventario?", cat, ref)
    assert "no hay medicamentos con inventario menor a 5 días entre los 2 que tienen stock registrado" in redactar(
        p, [res([]), res([{"risk": "OK", "count_all": 2}])], ref
    )
    assert "Farmacia aún no ha registrado stock" in redactar(p, [res([]), res([])], ref)


def test_espera_promedio_con_alcance_y_corte(cat, ref) -> None:
    p = plan_de("¿Cuál es el tiempo de espera promedio en urgencias en la última semana?", cat, ref)
    texto = redactar(p, [res([{"avg_wait_minutes": 57.33921568627447}])], ref)
    assert texto.startswith(
        "El tiempo de espera promedio en Urgencias durante la última semana (del 15 al 21 de septiembre de 2026) fue de 57,3 minutos."
    )
    assert "Tomo como «hoy» la fecha del último registro disponible en el HIS (21 de septiembre de 2026)" in texto


def test_espera_sin_datos(cat, ref) -> None:
    p = plan_de("¿Cuál es el tiempo de espera promedio en urgencias hoy?", cat, ref)
    assert redactar(p, [res([{"avg_wait_minutes": None}])], ref).startswith("No hay registros con ese dato en Urgencias")


def test_ranking_unidades_con_porcentaje(cat, ref) -> None:
    p = plan_de("¿Qué servicio tiene más pacientes ingresados este mes?", cat, ref)
    filas = [{"unit": "URGENCIAS", "count_all": 1169}, {"unit": "PEDIATRIA", "count_all": 409}, {"unit": "HOSPITALIZACION", "count_all": 401}]
    texto = redactar(p, [res(filas)], ref)
    assert texto.startswith("Urgencias es la unidad con más ingresos este mes (del 1 al 21 de septiembre de 2026): 1.169 (59,1 %) de un total de 1.979")
    assert "Le siguen Pediatria (409) y Hospitalizacion (401)" in texto


def test_conteo_simple(cat, ref) -> None:
    p = plan_de("¿Cuántos ingresos hubo en urgencias en agosto?", cat, ref)
    assert redactar(p, [res([{"count_all": 1523}])], ref) == "Se registraron 1.523 ingresos en Urgencias en agosto de 2026."


def test_cirugias_distribucion_explica_desconocido(cat, ref) -> None:
    p = plan_de("cirugías programadas vs ejecutadas", cat, ref)
    filas = [{"executed": "desconocido", "count_all": 9506}, {"executed": "si", "count_all": 2216}, {"executed": "no", "count_all": 1048}]
    texto = redactar(p, [res(filas)], ref)
    assert "De 12.770 programaciones de cirugía: 2.216 realizadas, 1.048 no realizadas y 9.506 sin dato de ejecución" in texto
    assert "ingreso verificable" in texto


def test_top_medicamentos(cat, ref) -> None:
    p = plan_de("Top 3 medicamentos más dispensados en agosto", cat, ref)
    filas = [{"name": "OXIGENO", "sum_quantity": 94429}, {"name": "ACETAMINOFEN 500 mg TABLETA", "sum_quantity": 64323}]
    texto = redactar(p, [res(filas)], ref)
    assert "1) Oxigeno: 94.429 unidades; 2) ACETAMINOFEN 500 mg TABLETA: 64.323 unidades" in texto


def _serie(ref: datetime, n: int, base: float = 100) -> list[dict]:
    """Serie diaria que termina en el día de corte (incompleto), ordenada DESC como la pide el plan."""
    dias = [(ref - timedelta(days=i)).strftime("%Y-%m-%dT00:00:00.000Z") for i in range(n)]
    return [{"admitted_at": d, "count_all": base + (i % 7) * 3} for i, d in enumerate(dias)]


def test_pronostico_excluye_dia_de_corte_y_empieza_despues(cat, ref) -> None:
    p = plan_de("¿Cómo se ve la demanda la próxima semana?", cat, ref)
    texto = redactar(p, [res(_serie(ref, 60))], ref)
    assert "próximos 7 días (del 22 al 28 de septiembre de 2026)" in texto
    assert "hasta el 20 de septiembre de 2026" in texto  # el 21 (corte) está incompleto
    assert "Margen de error típico" in texto
    assert "orientativa" in texto


def test_pronostico_sin_historial(cat, ref) -> None:
    p = plan_de("¿Cómo se ve la demanda la próxima semana?", cat, ref)
    assert "No hay historial suficiente" in redactar(p, [res(_serie(ref, 4))], ref)


def test_serie_tendencia(cat, ref) -> None:
    p = plan_de("Tendencia de ingresos en urgencias", cat, ref)
    filas = [{"admitted_at": f"2026-08-{d:02d}T00:00:00.000Z", "count_all": v} for d, v in [(3, 700), (10, 720), (17, 800), (24, 820)]]
    texto = redactar(p, [res(filas)], ref)
    assert "Evolución de ingresos en Urgencias por semana" in texto
    assert "máximo de 820 (semana del 24 ago)" in texto
    assert "La tendencia es creciente" in texto


def test_describir_filtros() -> None:
    q = {
        "dataset": "admissions",
        "metrics": [{"agg": "count"}],
        "filters": [
            {"field": "unit", "op": "eq", "value": "URGENCIAS"},
            {"field": "wait_minutes", "op": "gt", "value": 120},
            {"field": "admitted_at", "op": "gte", "value": "2026-08-01T00:00:00-05:00"},
        ],
    }
    assert describir_filtros(q) == ["(unidad: Urgencias)", "(con espera (minutos) mayor a 120)", "desde el 1 de agosto de 2026"]


def test_ninguna_cifra_inventada_en_la_bateria(cat, ref) -> None:
    """Para filas conocidas, toda cifra del texto sale de las filas, la pregunta, el corte o el alcance."""
    casos = {
        "¿Cuántos ingresos hubo en urgencias en agosto?": [{"count_all": 1523}],
        "Tiempo de espera por nivel de triage": [{"triage_level": 1, "avg_wait_minutes": 12.5}, {"triage_level": 3, "avg_wait_minutes": 64.25}],
        "¿Qué unidad tiene la mayor espera?": [{"unit": "URGENCIAS", "avg_wait_minutes": 61.5}, {"unit": "PEDIATRIA", "avg_wait_minutes": 58.9}],
        "Distribución de ingresos por sexo": [{"patient_sex": "Femenino", "count_all": 600}, {"patient_sex": "Masculino", "count_all": 400}],
    }
    for pregunta, filas in casos.items():
        p = plan_de(pregunta, cat, ref)
        texto = redactar(p, [res(filas)], ref)
        permitido = " ".join([pregunta, *p.alcance, "21 de septiembre de 2026 14:33 2026"])
        valores = [v for f in filas for v in f.values() if isinstance(v, (int, float))]
        permitidos = {fmt_num(v, d) for v in valores for d in (0, 1, 2)} | set(re.findall(r"\d+", permitido))
        total = sum(v for f in filas for k, v in f.items() if k == "count_all")
        if total:
            permitidos |= {fmt_num(total, 0)} | {fmt_num(f["count_all"] / total * 100, 1) for f in filas}
        for cifra in re.findall(r"\d+(?:[.,]\d+)*", texto):
            assert cifra in permitidos, (pregunta, cifra, texto)


# ── Regresiones encontradas en la prueba en vivo contra hospital_local ───────


def test_pronostico_ignora_dias_posteriores_al_corte(cat, ref) -> None:
    """Las dispensaciones llegan al 22-sep aunque el último ingreso sea del 21: ninguno de los dos entra."""
    p = plan_de("Proyección de consumo de medicamentos para los próximos días", cat, ref)
    dias = [(ref + timedelta(days=1) - timedelta(days=i)).strftime("%Y-%m-%dT00:00:00.000Z") for i in range(40)]
    filas = [{"dispensed_at": d, "sum_quantity": 1000 + (i % 7) * 10} for i, d in enumerate(dias)]
    texto = redactar(p, [res(filas)], ref)
    assert "hasta el 20 de septiembre de 2026" in texto
    assert "(del 22 al 24 de septiembre de 2026)" in texto


def test_serie_de_conteo_excluye_periodos_incompletos(cat, ref) -> None:
    p = plan_de("¿Qué día hubo más ingresos este mes?", cat, ref)
    filas = [{"admitted_at": f"2026-09-{d:02d}T00:00:00.000Z", "count_all": v} for d, v in [(18, 150), (19, 108), (20, 92), (21, 75)]]
    texto = redactar(p, [res(filas)], ref)
    assert "fue 18 sep, con 150" in texto
    assert "mínimo de 92 (20 sep)" in texto  # el 21 (día de corte) no cuenta como mínimo
    assert "periodos incompletos (21 sep)" in texto


def test_primera_semana_anterior_al_inicio_de_datos_es_incompleta(cat, ref) -> None:
    p = plan_de("Tendencia de ingresos en urgencias", cat, ref)
    filas = [{"admitted_at": f"2026-{m}T00:00:00.000Z", "count_all": v} for m, v in [("04-27", 120), ("05-04", 400), ("05-11", 410), ("05-18", 430)]]
    inicio = datetime(2026, 5, 1, 0, 6, tzinfo=TZ)
    texto = redactar(p, [res(filas)], ref, inicio)
    assert "mínimo de 400 (semana del 4 may)" in texto
    assert "periodos incompletos (semana del 27 abr)" in texto


def test_mes_completo_pedido_mas_alla_del_corte_avisa(cat, ref) -> None:
    p = plan_de("¿Cuántos pacientes mayores de 60 años ingresaron en septiembre?", cat, ref)
    texto = redactar(p, [res([{"count_all": 451}])], ref)
    assert "Los datos disponibles llegan hasta el 21 de septiembre de 2026 a las 14:33" in texto


def test_riesgo_critico_no_arrastra_bajo(cat, ref) -> None:
    p = plan_de("¿Qué medicamentos están en riesgo crítico?", cat, ref)
    assert p.consulta["filters"] == [{"field": "risk", "op": "eq", "value": "CRITICAL"}]
    assert p.alcance == ["en riesgo crítico"]


def test_cirugias_con_nombre_frase_correcta(cat, ref) -> None:
    p = plan_de("¿Cuántas cirugías de colecistectomía se programaron?", cat, ref)
    filas = [{"executed": "si", "count_all": 43}, {"executed": "no", "count_all": 7}, {"executed": "desconocido", "count_all": 147}]
    assert redactar(p, [res(filas)], ref).startswith(
        "De 197 programaciones de cirugía con procedimiento que contiene «colecistectomia»: 43 realizadas, 7 no realizadas y 147 sin dato de ejecución."
    )


def test_ranking_con_mas_al_final(cat, ref) -> None:
    p = plan_de("¿Qué procedimientos quirúrgicos se programan más?", cat, ref)
    assert p.ranking == "desc" and p.consulta["groupBy"] == [{"field": "procedure_name"}]


def test_riesgo_filtrado_no_sale_como_sin_dato(cat, ref) -> None:
    """Con filtro de un solo riesgo la columna no viene: no se debe escribir "riesgo sin dato"."""
    p = plan_de("¿Qué medicamentos están en riesgo crítico?", cat, ref)
    fila = {"name": "ACETAMINOFEN 500 mg TABLETA", "code": "N02BA001400", "min_days_of_inventory": 0.02, "sum_stock": 10, "min_avg_daily_consumption": 497.53}
    texto = redactar(p, [res([fila]), res([{"risk": "CRITICAL", "count_all": 1}])], ref)
    assert "hay 1 medicamento en riesgo crítico" in texto
    assert "sin dato" not in texto


def test_ranking_no_lo_encabeza_un_nombre_vacio(cat, ref) -> None:
    p = plan_de("¿Qué procedimientos quirúrgicos se programan más?", cat, ref)
    filas = [{"procedure_name": None, "count_all": 1050}, {"procedure_name": "BLOQUEO DE UNIÓN MIONEURAL", "count_all": 426}]
    texto = redactar(p, [res(filas)], ref)
    assert texto.startswith("Bloqueo de Unión Mioneural es el procedimiento con más programaciones de cirugía: 426")
    assert "Además, 1.050 programaciones de cirugía tienen procedimiento sin nombre en el catálogo." in texto


def test_porcentaje_destaca_el_valor_pedido(cat, ref) -> None:
    p = plan_de("¿Qué porcentaje de los ingresos son de urgencias?", cat, ref)
    filas = [{"unit": "URGENCIAS", "count_all": 7489}, {"unit": "PEDIATRIA", "count_all": 2511}]
    assert redactar(p, [res(filas)], ref).startswith("Urgencias representa el 74,9 % (7.489 de 10.000) de los ingresos.")


def test_cada_zona_agrupa_y_no_inventa_diagnostico(cat, ref) -> None:
    p = plan_de("¿Cuántos pacientes distintos tuvo cada zona de residencia?", cat, ref)
    assert p.consulta["groupBy"] == [{"field": "patient_zone"}]
    assert "filters" not in p.consulta


def test_casos_de_es_diagnostico(cat, ref) -> None:
    p = plan_de("¿Cuántos casos de dengue hubo en agosto?", cat, ref)
    assert {"field": "diagnosis_name", "op": "contains", "value": "dengue"} in p.consulta["filters"]


def test_series_de_conteo_rellenan_dias_sin_registros(cat, ref) -> None:
    """UCI: días sin ingresos no vienen del GROUP BY; cuentan como 0, no desaparecen."""
    p = plan_de("pronóstico de ocupación de la UCI para mañana", cat, ref)
    filas = [{"admitted_at": (ref - timedelta(days=i)).strftime("%Y-%m-%dT00:00:00.000Z"), "count_all": 2} for i in range(1, 41, 2)]
    texto = redactar(p, [res(filas)], ref)
    assert "basada en 39 días de historial" in texto  # 39 días entre el primero y el 20-sep, con los ceros
    assert "frente a 1,1 de promedio en los últimos 7 días completos" in texto  # 7 días: 4 con 2 y 3 con 0 -> 8/7


def test_serie_por_dia_rellena_huecos(cat, ref) -> None:
    p = plan_de("Ingresos por día en pediatría la última semana", cat, ref)
    filas = [{"admitted_at": f"2026-09-{d:02d}T00:00:00.000Z", "count_all": v} for d, v in [(15, 10), (17, 12), (20, 14)]]
    texto = redactar(p, [res(filas)], ref)
    assert "(6 periodos)" in texto and "mínimo de 0 (16 sep)" in texto
