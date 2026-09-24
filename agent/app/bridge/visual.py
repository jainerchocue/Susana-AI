"""Especificación de tabla/gráfica para el chat: QUÉ dibujar, nunca los datos.

Las cifras las pone el frontend desde `queries[queryIndex].rows`, las filas que
EJECUTÓ Node (Node además valida que cada columna exista en ese resultado). Lo
único que el agente aporta con números es la proyección, que va separada y
etiquetada como tal.

Tipos: `kpi` (1 fila, 1-4 cifras), `bar` (categorías), `line` (serie temporal,
con proyección opcional) y `table` (listados o varias dimensiones).
"""

from __future__ import annotations

from typing import Any

from app.bridge.dsl import alias_metrica
from app.bridge.planner import ETIQUETA_DIM, NOMBRE_TEMA, Plan
from app.bridge.textos import valor_dim

_MAX_BARRAS = 15  # más categorías se leen mejor en tabla

# alias de métrica -> (etiqueta, unidad, decimales)
_METRICAS: dict[str, tuple[str, str | None, int]] = {
    "sum_census": ("Camas ocupadas", None, 0),
    "sum_physical_beds": ("Camas físicas", None, 0),
    "avg_occupancy_pct": ("Ocupación", "%", 2),
    "sum_virtual_census": ("En camas virtuales", None, 0),
    "min_days_of_inventory": ("Días de inventario", "días", 2),
    "sum_stock": ("Stock", "unid.", 0),
    "min_avg_daily_consumption": ("Consumo medio diario", "unid./día", 2),
    "avg_wait_minutes": ("Espera promedio", "min", 1),
    "avg_stay_hours": ("Estancia promedio", "h", 1),
    "avg_patient_age": ("Edad promedio", "años", 1),
    "sum_quantity": ("Unidades", None, 0),
}
_CONTEO = {"surgeries": "Programaciones", "alerts": "Alertas"}


def _columna_metrica(plan: Plan, m: dict[str, Any]) -> dict[str, Any]:
    alias = alias_metrica(m)
    if alias == "count_all":
        etiqueta = "Pacientes" if plan.pide_conteo else _CONTEO.get(plan.tema, "Ingresos")
        return {"key": alias, "label": etiqueta, "decimals": 0}
    etiqueta, unidad, dec = _METRICAS.get(alias, (alias.replace("_", " ").capitalize(), None, 2))
    col: dict[str, Any] = {"key": alias, "label": etiqueta, "decimals": dec}
    if unidad:
        col["unit"] = unidad
    return col


def _etiqueta_dim(dim: str) -> str:
    e = ETIQUETA_DIM.get(dim, dim.replace("_", " "))
    return e[:1].upper() + e[1:]


def _etiquetas_valores(dim: str, filas: list[dict[str, Any]]) -> dict[str, str]:
    """Valores crudos -> texto para el usuario ("si" -> "realizadas", "URGENCIAS" -> "Urgencias")."""
    out: dict[str, str] = {}
    for f in filas:
        v = f.get(dim)
        if v is None or v == "" or dim.endswith("_at"):
            continue
        texto = valor_dim(dim, v)
        if texto != str(v):
            out[str(v)] = texto[:160]
        if len(out) >= 200:
            break
    return out


def _titulo(plan: Plan, dims: list[str]) -> str:
    base = NOMBRE_TEMA.get(plan.tema, "Resultado")
    if plan.pronostico:
        base = f"Proyección de {base}"
    elif plan.serie or (dims and dims[0].endswith("_at")):
        base = f"Evolución de {base}"
    elif len(dims) == 1:
        base = f"{base} por {ETIQUETA_DIM.get(dims[0], dims[0])}"
    return (base[:1].upper() + base[1:])[:120]


def construir_visual(
    plan: Plan,
    resultados: list[dict[str, Any] | None],
    *,
    omitir: list[str] | None = None,
    proyeccion: list[tuple[str, float]] | None = None,
) -> dict[str, Any] | None:
    """Especificación para la consulta principal (índice 0), o None si no aporta nada."""
    principal = resultados[0] if resultados else None
    filas = [f for f in (principal or {}).get("rows") or [] if isinstance(f, dict)]
    if not filas:
        return None
    q = plan.consulta
    dims = [g["field"] for g in q.get("groupBy") or []]
    metricas = [_columna_metrica(plan, m) for m in q["metrics"]]
    visual: dict[str, Any] = {"title": _titulo(plan, dims), "queryIndex": 0}
    subtitulo = " · ".join(plan.alcance)
    if subtitulo:
        visual["subtitle"] = subtitulo[:240]

    if not dims:
        return {**visual, "type": "kpi", "columns": metricas[:4]}

    x = dims[0]
    if len(filas) == 1 and not x.endswith("_at") and plan.tema not in {"inventory", "generic"}:
        # Una sola unidad/categoría: cifras destacadas, con la categoría en el subtítulo.
        categoria = valor_dim(x, filas[0].get(x))
        if categoria not in visual.get("subtitle", ""):
            visual["subtitle"] = " · ".join(p for p in (categoria, visual.get("subtitle")) if p)[:240]
        return {**visual, "title": _titulo(plan, []), "type": "kpi", "columns": metricas[:4]}
    etiquetas: dict[str, str] = {}
    for d in dims:
        etiquetas.update(_etiquetas_valores(d, filas))
    if etiquetas:
        visual["valueLabels"] = dict(list(etiquetas.items())[:200])
    columnas_dims = [{"key": d, "label": _etiqueta_dim(d)} for d in dims]

    if plan.tema == "inventory" or plan.tema == "generic" or len(dims) > 1:
        return {**visual, "type": "table", "columns": (columnas_dims + metricas)[:8]}

    if x.endswith("_at"):
        visual.update(type="line", x=x, xLabel="Fecha", columns=metricas[:1])
        grain = (q.get("groupBy") or [{}])[0].get("grain")
        if grain:
            visual["grain"] = grain
        if q["metrics"][0]["agg"] in {"count", "sum"}:
            visual["fillMissing"] = True  # un día sin registros vale 0, no desaparece
        if omitir:
            visual["omit"] = omitir[:10]
        if proyeccion:
            visual["projection"] = {
                "label": "Proyección",
                "points": [{"x": x_, "y": round(float(y), 2)} for x_, y in proyeccion[:31]],
            }
        return visual

    if len(filas) > _MAX_BARRAS:
        return {**visual, "type": "table", "columns": (columnas_dims + metricas)[:8]}
    series = metricas[:2] if plan.tema == "occupancy" else metricas[:1]
    return {**visual, "type": "bar", "x": x, "xLabel": _etiqueta_dim(x), "columns": series}
