"""Interpretación + catálogo del usuario -> plan de consultas DSL.

Cada tema tiene una consulta base; la pregunta la ajusta con filtros reales
(unidad, periodo, triage, comparadores...), agrupación y ranking. El plan
lleva además el "alcance" en lenguaje natural para que la respuesta diga
exactamente QUÉ se midió (anti-alucinación: nada implícito).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.bridge.dsl import Catalogo, validar
from app.bridge.nlu import (
    Interpretacion,
    Periodo,
    has,
    norm,
    resolver_unidades,
    resolver_valores,
    sin_comparadores,
    termino_nombre,
)
from app.bridge.nlu import MESES
from app.bridge.textos import lista_natural, rango_fechas, titulo, valor_dim

DATASET_POR_TEMA = {
    "occupancy": "bed_occupancy",
    "inventory": "medication_inventory",
    "wait": "admissions",
    "stay": "admissions",
    "age": "admissions",
    "triage": "admissions",
    "diagnosis": "admissions",
    "admissions": "admissions",
    "medications": "medications",
    "services": "services",
    "surgeries": "surgeries",
    "alerts": "alerts",
}

NOMBRE_TEMA = {
    "occupancy": "ocupación de camas",
    "inventory": "inventario de medicamentos",
    "wait": "tiempos de espera",
    "stay": "estancia hospitalaria",
    "age": "edad de los pacientes",
    "triage": "clasificación de triage",
    "diagnosis": "diagnósticos de ingreso",
    "admissions": "ingresos hospitalarios",
    "medications": "consumo de medicamentos",
    "services": "servicios y procedimientos prestados",
    "surgeries": "programación de cirugías",
    "alerts": "alertas operativas",
}

_FECHA = {"admissions": "admitted_at", "services": "provided_at", "medications": "dispensed_at"}
_FOTO = {"bed_occupancy", "medication_inventory", "surgeries"}  # sin fecha: foto al corte / sin periodo

# Etiquetas de dimensiones para el alcance y el narrador.
ETIQUETA_DIM = {
    "unit": "unidad",
    "subunit": "subunidad",
    "admission_class": "clase de ingreso",
    "entry_route": "vía de ingreso",
    "risk_type": "tipo de riesgo",
    "diagnosis_name": "diagnóstico",
    "diagnosis_code": "código de diagnóstico",
    "triage_level": "nivel de triage",
    "patient_sex": "sexo",
    "patient_regime": "régimen",
    "patient_zone": "zona",
    "area": "área",
    "area_code": "código de área",
    "specialty": "especialidad",
    "code": "código",
    "name": "nombre",
    "kind": "tipo",
    "procedure_name": "procedimiento",
    "procedure_code": "código de procedimiento",
    "executed": "ejecución",
    "schedule_number": "programación",
    "type": "tipo de alerta",
    "severity": "severidad",
    "status": "estado",
    "scope": "ámbito",
    "scope_id": "recurso",
    "risk": "riesgo",
    "admitted_at": "fecha",
    "provided_at": "fecha",
    "dispensed_at": "fecha",
    "first_seen_at": "fecha",
    "last_seen_at": "fecha",
}

_UNIDAD_MEDIDA = {
    "wait_minutes": ("con espera", "minutos"),
    "stay_hours": ("con estancia", "horas"),
    "patient_age": ("con edad", "años"),
    "days_of_inventory": ("con inventario", "días"),
    "occupancy_pct": ("con ocupación", "%"),
}
_OP_TEXTO = {"gt": "mayor a", "gte": "de al menos", "lt": "menor a", "lte": "de hasta"}

# Filtros que se leen mejor como adjetivo: "alertas críticas abiertas", "cirugías no realizadas".
_ADJETIVOS = {
    "severity": {"CRITICAL": "críticas", "WARNING": "de advertencia"},
    "status": {"OPEN": "abiertas", "ACKNOWLEDGED": "reconocidas", "RESOLVED": "resueltas"},
    "executed": {"si": "realizadas", "no": "no realizadas", "desconocido": "sin dato de ejecución"},
    "risk": {"CRITICAL": "en riesgo crítico", "LOW": "en riesgo bajo", "OK": "con inventario suficiente", "insufficient_data": "sin consumo reciente"},
}


@dataclass
class Plan:
    tema: str
    dataset: str
    consulta: dict[str, Any]
    extras: list[dict[str, Any]] = field(default_factory=list)
    pronostico: bool = False
    horizonte: int = 3
    serie: bool = False
    periodo: Periodo | None = None
    alcance: list[str] = field(default_factory=list)
    avisos: list[str] = field(default_factory=list)
    unidades: list[str] = field(default_factory=list)
    ranking: str | None = None
    top: int | None = None
    pide_conteo: bool = False
    destacar: list[str] = field(default_factory=list)  # valores pedidos en un "¿qué porcentaje...?"


@dataclass
class SinPlan:
    """No se puede consultar: motivo para el usuario (nunca se inventa un dato)."""

    motivo: str  # 'sin_tema' | 'sin_permiso'
    tema: str | None = None


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


def _metricas_base(tema: str, cuenta: bool) -> list[dict[str, Any]]:
    if cuenta:
        return [{"agg": "count"}]
    return {
        "occupancy": [
            {"agg": "sum", "field": "census"},
            {"agg": "sum", "field": "physical_beds"},
            {"agg": "avg", "field": "occupancy_pct"},
            {"agg": "sum", "field": "virtual_census"},
        ],
        "inventory": [
            {"agg": "min", "field": "days_of_inventory"},
            {"agg": "sum", "field": "stock"},
            {"agg": "min", "field": "avg_daily_consumption"},
        ],
        "wait": [{"agg": "avg", "field": "wait_minutes"}],
        "stay": [{"agg": "avg", "field": "stay_hours"}],
        "age": [{"agg": "avg", "field": "patient_age"}],
        "medications": [{"agg": "sum", "field": "quantity"}],
        "services": [{"agg": "sum", "field": "quantity"}],
    }.get(tema, [{"agg": "count"}])


def _medida_de_comparador(tema: str, unidad: str | None) -> tuple[str, float] | None:
    """(medida, factor) a la que aplica un comparador según su unidad y el tema."""
    if unidad == "anos":
        return "patient_age", 1
    if unidad == "minutos":
        return "wait_minutes", 1
    if unidad == "horas":
        return ("stay_hours", 1) if tema == "stay" else ("wait_minutes", 60)
    if unidad in {"dias", "semanas"}:
        factor = 7 if unidad == "semanas" else 1
        if tema == "inventory":
            return "days_of_inventory", factor
        return ("stay_hours", 24 * factor) if tema in {"stay", "admissions"} else None
    if unidad == "pct":
        return ("occupancy_pct", 1) if tema == "occupancy" else None
    return {
        "inventory": ("days_of_inventory", 1),
        "wait": ("wait_minutes", 1),
        "occupancy": ("occupancy_pct", 1),
        "age": ("patient_age", 1),
        "stay": ("stay_hours", 1),
    }.get(tema)


def _num_json(v: float) -> int | float:
    return int(v) if float(v).is_integer() else round(v, 4)


def _agrupacion_por_defecto(tema: str, it: Interpretacion, ds: str) -> list[dict[str, Any]]:
    t = it.texto
    fecha = _FECHA.get(ds)
    if fecha and it.ranking and re.search(r"\b(dia|dias|fecha)\b", t):
        return [{"field": fecha, "grain": "day"}]
    if fecha and it.ranking and re.search(r"\b(que|cual) mes\b|\bmes con\b", t):
        return [{"field": fecha, "grain": "month"}]
    if tema == "occupancy":
        return [{"field": "unit"}]
    if tema == "inventory":
        return [{"field": "name"}, {"field": "code"}, {"field": "risk"}]
    if tema == "triage":
        return [{"field": "triage_level"}]
    if tema == "diagnosis":
        return [{"field": "diagnosis_name"}]
    if tema == "alerts":
        return [{"field": "type"}, {"field": "severity"}]
    if tema == "surgeries":
        if it.ranking or has(t, "procedimiento"):
            return [{"field": "procedure_name"}]
        return [{"field": "executed"}]
    if tema == "medications" and (it.ranking or it.top or re.search(r"\b(que|cuales)\s+(medicamentos|insumos|productos)\b", t)):
        return [{"field": "name"}]
    if tema == "services" and (it.ranking or it.top or re.search(r"\b(que|cuales)\s+(servicios|procedimientos|examenes)\b", t)):
        return [{"field": "procedure_name"}]
    if ds == "admissions" and (it.ranking or re.search(r"\b(que|cual|cuales) (unidad|unidades|servicio|servicios|area)\b", t)):
        return [{"field": "unit"}]
    return []


def _resolver_agrupaciones(it: Interpretacion, ds: str, cat: Catalogo) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    claves = [c for c in it.agrupaciones if not (c == "@type" and "risk_type" in it.agrupaciones)]
    for clave in claves:
        if clave.startswith("@") and clave != "@type":
            fecha = _FECHA.get(ds)
            if fecha:
                out.append({"field": fecha, "grain": clave[1:]})
            continue
        if clave == "@type":
            clave = {"alerts": "type", "medications": "kind", "medication_inventory": "kind", "admissions": "risk_type"}.get(ds, "")
        if clave and cat.dim(ds, clave) and all(g["field"] != clave for g in out):
            out.append({"field": clave})
    return out[:3]


def planificar(
    it: Interpretacion,
    cat: Catalogo,
    *,
    max_rows: int,
    ref: datetime,
) -> Plan | SinPlan:
    tema = it.tema
    if not tema:
        return SinPlan("sin_tema")
    ds = DATASET_POR_TEMA[tema]
    if it.pronostico or it.serie:
        return _planificar_serie(it, cat, tema, max_rows=max_rows, ref=ref)
    if not cat.has(ds):
        return SinPlan("sin_permiso", tema)

    t = it.texto
    filtros: list[dict[str, Any]] = []
    alcance: list[str] = []
    avisos: list[str] = []

    # Filtros de medida ("más de 2 horas"): si además piden "cuántos", se cuentan pacientes.
    medidas_filtradas: list[str] = []
    for c in it.comparadores:
        destino = _medida_de_comparador(tema, c.unidad)
        if not destino or not cat.measure(ds, destino[0]):
            continue
        medida, factor = destino
        filtros.append({"field": medida, "op": c.op, "value": _num_json(c.valor * factor)})
        medidas_filtradas.append(medida)
        prefijo, unidad = _UNIDAD_MEDIDA.get(medida, ("con", ""))
        alcance.append(f"{prefijo} {_OP_TEXTO[c.op]} {_fmt_simple(c.valor * factor)} {unidad}".strip())
    pide_conteo = bool(re.search(r"\b(cuantos|cuantas|numero de|cantidad de)\b", t)) and bool(medidas_filtradas) and tema in {
        "wait", "stay", "age"
    }
    metricas = _metricas_base(tema, pide_conteo)

    group_by = _resolver_agrupaciones(it, ds, cat) or _agrupacion_por_defecto(tema, it, ds)

    # Unidades reales mencionadas.
    unidades: list[str] = []
    pide_reparto = has(t, "porcentaje", "proporcion", "que parte", "cuanto representa")
    destacar: list[str] = []
    if cat.dim(ds, "unit"):
        unidades = resolver_unidades(t, cat.values(ds, "unit"))
        if unidades and pide_reparto and tema != "occupancy" and not group_by:
            # "¿Qué porcentaje de los ingresos son de urgencias?": el reparto por unidad da el porcentaje.
            group_by, destacar, unidades = [{"field": "unit"}], unidades, []
        if unidades:
            filtros.append({"field": "unit", "op": "eq", "value": unidades[0]} if len(unidades) == 1 else {"field": "unit", "op": "in", "value": unidades})
            alcance.insert(0, "en " + lista_natural([titulo(u) for u in unidades]))
            if len(unidades) > 1 and not group_by:
                group_by = [{"field": "unit"}]

    # Otras dimensiones con vocabulario real. Si el usuario agrupó EXPLÍCITAMENTE por esa
    # dimensión ("programadas vs ejecutadas"), se agrupa en vez de filtrar; si pide un
    # porcentaje ("qué porcentaje son mujeres"), también: el reparto da el porcentaje.
    explicitas = {g["field"] for g in _resolver_agrupaciones(it, ds, cat)}
    adjetivos: list[str] = []
    for dim in cat.datasets[ds]["dims"]:
        if dim in {"unit", "code", "name", "diagnosis_name", "diagnosis_code", "procedure_name", "procedure_code", "scope_id", "schedule_number", "area_code"}:
            continue
        if dim == "subunit" and not has(t, "subunidad"):
            continue
        valores = resolver_valores(t, dim, cat.values(ds, dim))
        if not valores or dim in explicitas:
            continue
        if pide_reparto and not explicitas and not any(g.get("grain") for g in group_by):
            group_by, destacar = [{"field": dim}], valores
            explicitas = {dim}
            continue
        filtros.append({"field": dim, "op": "eq", "value": valores[0]} if len(valores) == 1 else {"field": dim, "op": "in", "value": valores})
        if dim in _ADJETIVOS:
            adjetivos.append(lista_natural([_ADJETIVOS[dim].get(v, valor_dim(dim, v)) for v in valores], "o"))
        else:
            alcance.append(f"({ETIQUETA_DIM.get(dim, dim)}: {lista_natural([valor_dim(dim, v) for v in valores], 'o')})")
        if len(valores) == 1:
            group_by = [g for g in group_by if g["field"] != dim]
    alcance[:0] = adjetivos

    # Nombre libre (medicamento, diagnóstico, procedimiento): filtro "contiene", dicho en la respuesta.
    campo_nombre = {"medications": "name", "medication_inventory": "name", "services": "procedure_name", "surgeries": "procedure_name"}.get(ds)
    # En ingresos, un nombre libre solo es diagnóstico con una señal clara ("por apendicitis",
    # "con sepsis", "casos de dengue"): "de residencia" no es un diagnóstico.
    senal_diagnostico = r"\b(por|con|casos de|diagnostico de|diagnosticad[oa]s? con|a causa de) "
    if ds == "admissions":
        campo_nombre = "diagnosis_name"
    termino = termino_nombre(_sin_vocabulario(sin_comparadores(t), cat, ds)) if campo_nombre and cat.dim(ds, campo_nombre) else None
    if termino and (ds != "admissions" or tema == "diagnosis" or re.search(senal_diagnostico + re.escape(termino.split()[0]), t)):
        filtros.append({"field": campo_nombre, "op": "contains", "value": termino[:200]})
        alcance.append(
            {"name": f"cuyo nombre contiene «{termino}»", "diagnosis_name": f"con diagnóstico que contiene «{termino}»"}.get(
                campo_nombre, f"con procedimiento que contiene «{termino}»"
            )
        )
        if tema == "diagnosis":
            group_by = [g for g in group_by if g["field"] != "diagnosis_name"] or group_by

    if it.triage and cat.dim(ds, "triage_level"):
        filtros.append(
            {"field": "triage_level", "op": "eq", "value": it.triage[0]}
            if len(it.triage) == 1
            else {"field": "triage_level", "op": "in", "value": it.triage}
        )
        alcance.append("con triage " + lista_natural([str(n) for n in it.triage], "o"))
        if len(it.triage) == 1:
            group_by = [g for g in group_by if g["field"] != "triage_level"]

    # Periodo sobre la fecha del dataset; los datasets "foto" no tienen fecha.
    periodo = it.periodo
    fecha = _FECHA.get(ds)
    if periodo and fecha:
        filtros.append({"field": fecha, "op": "gte", "value": _iso(periodo.desde)})
        filtros.append({"field": fecha, "op": "lt", "value": _iso(periodo.hasta)})
    elif periodo and ds in _FOTO:
        # "hoy" ES la foto al corte; cualquier otro periodo no se puede aplicar y se dice.
        if periodo.etiqueta != "hoy":
            avisos.append("este indicador es una foto a la fecha de corte de los datos; no se puede filtrar por el periodo pedido")
        periodo = None
    elif periodo and ds == "alerts":
        avisos.append("las alertas se muestran sin filtro de fechas")
        periodo = None

    # Orden y límite.
    fecha_en_gb = next((g for g in group_by if g.get("grain")), None)
    order_by: list[dict[str, Any]] = []
    limite = 1 if not group_by else min(max_rows, 50)
    if tema == "inventory":
        order_by = [{"ref": "metric:0", "dir": "asc"}]
        limite = min(max_rows, 25)
    elif tema == "occupancy":
        order_by = [{"ref": "metric:2", "dir": "desc"}]
        limite = min(max_rows, 50)
    elif fecha_en_gb and not it.ranking:
        order_by = [{"ref": fecha_en_gb["field"], "dir": "asc"}]
        limite = min(max_rows, 200)
    elif group_by:
        order_by = [{"ref": "metric:0", "dir": it.ranking or "desc"}]
        limite = min(max_rows, it.top or (10 if tema in {"medications", "services", "diagnosis", "surgeries"} else 50))

    consulta: dict[str, Any] = {"dataset": ds, "metrics": metricas, "limit": max(1, limite)}
    if group_by:
        consulta["groupBy"] = group_by
    if filtros:
        consulta["filters"] = filtros
    if order_by:
        consulta["orderBy"] = order_by

    extras: list[dict[str, Any]] = []
    if tema == "inventory" and filtros:
        # Contexto honesto: cuántos medicamentos tienen stock registrado, por riesgo.
        extras.append({"dataset": ds, "metrics": [{"agg": "count"}], "groupBy": [{"field": "risk"}], "limit": 10})
    if tema == "surgeries" and any(f["field"] == "executed" for f in filtros):
        # "Canceladas" sin contexto engaña: la mayoría puede ser "desconocido".
        extras.append({"dataset": ds, "metrics": [{"agg": "count"}], "groupBy": [{"field": "executed"}], "limit": 5})

    if periodo:
        alcance.append(etiqueta_con_fechas(periodo))

    return Plan(
        tema=tema,
        dataset=ds,
        consulta=consulta,
        extras=[e for e in extras if not validar(e, cat, max_rows)],
        periodo=periodo,
        alcance=alcance,
        avisos=avisos,
        unidades=unidades,
        ranking=it.ranking,
        top=it.top,
        pide_conteo=pide_conteo,
        destacar=destacar,
    )


def _planificar_serie(it: Interpretacion, cat: Catalogo, tema: str, *, max_rows: int, ref: datetime) -> Plan | SinPlan:
    """Serie temporal (tendencia) y, si se pide, pronóstico sobre ella."""
    if tema == "wait":
        ds, metricas, medida = "admissions", [{"agg": "avg", "field": "wait_minutes"}], "wait"
    elif tema == "medications":
        ds, metricas, medida = "medications", [{"agg": "sum", "field": "quantity"}], "medications"
    elif tema == "services":
        ds, metricas, medida = "services", [{"agg": "sum", "field": "quantity"}], "services"
    else:
        # Ocupación, ingresos, demanda...: la serie es de ingresos diarios (demanda).
        ds, metricas, medida = "admissions", [{"agg": "count"}], "admissions"
    if not cat.has(ds):
        return SinPlan("sin_permiso", tema)

    t = it.texto
    filtros: list[dict[str, Any]] = []
    alcance: list[str] = []
    unidades: list[str] = []
    if cat.dim(ds, "unit"):
        unidades = resolver_unidades(t, cat.values(ds, "unit"))
        if unidades:
            filtros.append({"field": "unit", "op": "eq", "value": unidades[0]} if len(unidades) == 1 else {"field": "unit", "op": "in", "value": unidades})
            alcance.append("en " + lista_natural([titulo(u) for u in unidades]))
    if it.triage and cat.dim(ds, "triage_level"):
        filtros.append({"field": "triage_level", "op": "in", "value": it.triage})
        alcance.append("con triage " + lista_natural([str(n) for n in it.triage], "o"))

    fecha = _FECHA[ds]
    grain = "day"
    if it.serie and not it.pronostico:
        grain = next((c[1:] for c in it.agrupaciones if c in {"@day", "@week", "@month"}), "week")
    avisos: list[str] = []
    if it.pronostico and tema == "occupancy":
        avisos.append("la proyección se hace sobre los ingresos diarios (demanda), que es lo que anticipa la ocupación")

    periodo = it.periodo if not it.pronostico else None
    if periodo:
        filtros.append({"field": fecha, "op": "gte", "value": _iso(periodo.desde)})
        filtros.append({"field": fecha, "op": "lt", "value": _iso(periodo.hasta)})
        alcance.append(etiqueta_con_fechas(periodo))

    # Pronóstico: los días MÁS RECIENTES (orden desc + límite), el narrador los reordena.
    consulta: dict[str, Any] = {
        "dataset": ds,
        "metrics": metricas,
        "groupBy": [{"field": fecha, "grain": grain}],
        "orderBy": [{"ref": fecha, "dir": "desc" if it.pronostico else "asc"}],
        "limit": min(max_rows, 120 if it.pronostico else 200),
    }
    if filtros:
        consulta["filters"] = filtros
    horizonte = 7 if has(t, "semana") else 3
    return Plan(
        tema=medida,
        dataset=ds,
        consulta=consulta,
        pronostico=it.pronostico,
        horizonte=horizonte,
        serie=True,
        periodo=periodo,
        alcance=alcance,
        avisos=avisos,
        unidades=unidades,
    )


def etiqueta_con_fechas(p: Periodo) -> str:
    """'durante la última semana (del 15 al 21 de septiembre de 2026)'; sin paréntesis si ya trae fechas."""
    e = p.etiqueta if any(c.isdigit() for c in p.etiqueta) else f"{p.etiqueta} ({rango_fechas(p.desde, p.hasta)})"
    if e.startswith(("la ", "el ", "los ", "las ")):
        return "durante " + e
    if e[0].isdigit() or e.split()[0] in MESES:
        return "en " + e
    return e


def _sin_vocabulario(t: str, cat: Catalogo, ds: str) -> str:
    """Quita del texto los valores reales del catálogo que ya se usan como filtro (no son un nombre libre)."""
    for info in cat.datasets.get(ds, {}).get("dims", {}).values():
        for v in info.get("values") or []:
            nv = norm(str(v))
            for trozo in [nv] + [x.strip() for x in re.split(r"\s+-\s+|-", nv)]:
                if len(trozo) >= 4:
                    t = re.sub(r"(?<![a-z])" + re.escape(trozo) + r"(?![a-z])", " ", t)
    return t


def _fmt_simple(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else f"{v:g}".replace(".", ",")


