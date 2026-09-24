"""DSL de consultas: validación local (espejo de Node) sobre el catálogo del usuario.

Node es la autoridad (vuelve a validar y ejecuta). Validar aquí antes evita
gastar cupo del ticket en consultas que Node rechazaría y permite descartar lo
que proponga el LLM sin llegar a enviarlo. Reglas copiadas de
`src/modules/assistant/assistant.schemas.ts` y `assistant.query.ts`.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

_CAMPO = re.compile(r"^[a-z][a-z0-9_]{0,62}$")
_REF = re.compile(r"^(metric:[0-4]|[a-z][a-z0-9_]{0,62})$")
AGGS = {"count", "count_distinct", "sum", "avg", "min", "max"}
OPS = {"eq", "neq", "gt", "gte", "lt", "lte", "in", "between", "contains"}
GRAINS = {"day", "week", "month", "year"}
_OPS_ORDEN = {"gt", "gte", "lt", "lte", "between"}


class Catalogo:
    """Índice del catálogo lógico que manda Node (solo nombres lógicos)."""

    def __init__(self, entries: list[dict[str, Any]]):
        self.datasets: dict[str, dict[str, Any]] = {}
        for e in entries:
            ds = str(e.get("dataset") or "")
            if not ds:
                continue
            dims = {str(d["name"]): d for d in e.get("dimensions") or [] if d.get("name")}
            meas = {str(m["name"]): m for m in e.get("measures") or [] if m.get("name")}
            self.datasets[ds] = {"dims": dims, "measures": meas, "description": e.get("description", "")}

    def has(self, dataset: str) -> bool:
        return dataset in self.datasets

    def dim(self, dataset: str, name: str) -> dict[str, Any] | None:
        return self.datasets.get(dataset, {}).get("dims", {}).get(name)

    def measure(self, dataset: str, name: str) -> dict[str, Any] | None:
        return self.datasets.get(dataset, {}).get("measures", {}).get(name)

    def values(self, dataset: str, dim: str) -> list[str]:
        d = self.dim(dataset, dim)
        return [str(v) for v in (d or {}).get("values") or []]

    def field_type(self, dataset: str, name: str) -> tuple[str, str] | None:
        """(clase, tipo): ('dimension', 'string'|'number'|'date') o ('measure', 'number')."""
        d = self.dim(dataset, name)
        if d:
            return "dimension", str(d.get("type") or "string")
        if self.measure(dataset, name):
            return "measure", "number"
        return None


def _es_fecha(v: Any) -> bool:
    if not isinstance(v, str):
        return False
    try:
        datetime.fromisoformat(v.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def _tipo_js(v: Any) -> str:
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, (int, float)):
        return "number"
    if isinstance(v, str):
        return "string"
    return "otro"


def _validar_filtro(cat: Catalogo, ds: str, f: Any, i: int, errores: list[str]) -> None:
    if not isinstance(f, dict) or set(f) - {"field", "op", "value"}:
        errores.append(f"filters.{i}: forma inválida")
        return
    campo, op, valor = f.get("field"), f.get("op"), f.get("value")
    if not isinstance(campo, str) or not _CAMPO.match(campo) or op not in OPS:
        errores.append(f"filters.{i}: campo u operador inválido")
        return
    info = cat.field_type(ds, campo)
    if not info:
        errores.append(f"filters.{i}: campo desconocido {campo}")
        return
    _, tipo = info
    if op == "contains" and tipo != "string":
        errores.append(f"filters.{i}: contains solo en texto")
    if op in _OPS_ORDEN and tipo == "string":
        errores.append(f"filters.{i}: {op} no aplica a texto")
    if op == "between" and not (isinstance(valor, list) and len(valor) == 2):
        errores.append(f"filters.{i}: between exige 2 valores")
    if op == "in" and not (isinstance(valor, list) and 1 <= len(valor) <= 50):
        errores.append(f"filters.{i}: in exige un array")
    if op not in {"between", "in"} and isinstance(valor, list):
        errores.append(f"filters.{i}: {op} no admite array")
    valores = valor if isinstance(valor, list) else [valor]
    tipos = {_tipo_js(v) for v in valores}
    if len(tipos) != 1 or tipos & {"boolean", "otro"}:
        errores.append(f"filters.{i}: tipo de valor inválido")
        return
    (tv,) = tipos
    if any(isinstance(v, str) and len(v) > 200 for v in valores):
        errores.append(f"filters.{i}: valor demasiado largo")
    if tipo == "number" and tv != "number":
        errores.append(f"filters.{i}: el campo es numérico")
    elif tipo == "string" and tv != "string":
        errores.append(f"filters.{i}: el campo es de texto")
    elif tipo == "date" and (tv != "string" or not all(_es_fecha(v) for v in valores)):
        errores.append(f"filters.{i}: fecha inválida")


def validar(query: Any, cat: Catalogo, max_rows: int) -> list[str]:
    """Lista de errores (vacía = Node la aceptará)."""
    if not isinstance(query, dict):
        return ["la consulta no es un objeto"]
    extra = set(query) - {"dataset", "metrics", "groupBy", "filters", "orderBy", "limit"}
    if extra:
        return [f"campos desconocidos: {sorted(extra)}"]
    ds = query.get("dataset")
    if not isinstance(ds, str) or not cat.has(ds):
        return ["dataset desconocido o no permitido"]

    errores: list[str] = []
    metrics = query.get("metrics")
    if not isinstance(metrics, list) or not 1 <= len(metrics) <= 5:
        return ["metrics: entre 1 y 5"]
    vistas: set[str] = set()
    for i, m in enumerate(metrics):
        if not isinstance(m, dict) or set(m) - {"agg", "field"} or m.get("agg") not in AGGS:
            errores.append(f"metrics.{i}: forma inválida")
            continue
        agg, campo = m["agg"], m.get("field")
        clave = f"{agg}:{campo or ''}"
        if clave in vistas:
            errores.append(f"metrics.{i}: repetida")
        vistas.add(clave)
        if agg == "count":
            if campo is not None:
                errores.append(f"metrics.{i}: count no admite field")
            continue
        if not isinstance(campo, str) or not _CAMPO.match(campo):
            errores.append(f"metrics.{i}: {agg} exige field")
            continue
        info = cat.field_type(ds, campo)
        if not info:
            errores.append(f"metrics.{i}: campo desconocido {campo}")
        elif agg == "count_distinct" and info[0] != "dimension":
            errores.append(f"metrics.{i}: count_distinct exige dimensión")
        elif agg != "count_distinct" and info[0] != "measure":
            errores.append(f"metrics.{i}: {agg} exige medida")

    group_by = query.get("groupBy", [])
    if not isinstance(group_by, list) or len(group_by) > 3:
        return errores + ["groupBy: máximo 3"]
    campos_gb: list[str] = []
    for i, g in enumerate(group_by):
        if not isinstance(g, dict) or set(g) - {"field", "grain"}:
            errores.append(f"groupBy.{i}: forma inválida")
            continue
        campo = g.get("field")
        d = cat.dim(ds, campo) if isinstance(campo, str) else None
        if not d:
            errores.append(f"groupBy.{i}: dimensión desconocida {campo}")
            continue
        if campo in campos_gb:
            errores.append(f"groupBy.{i}: repetido")
        campos_gb.append(campo)
        grain = g.get("grain")
        if grain is not None and (grain not in GRAINS or d.get("type") != "date"):
            errores.append(f"groupBy.{i}: grain solo en fechas")

    filters = query.get("filters", [])
    if not isinstance(filters, list) or len(filters) > 10:
        return errores + ["filters: máximo 10"]
    for i, f in enumerate(filters):
        _validar_filtro(cat, ds, f, i, errores)

    order_by = query.get("orderBy", [])
    if not isinstance(order_by, list) or len(order_by) > 3:
        return errores + ["orderBy: máximo 3"]
    for i, o in enumerate(order_by):
        if not isinstance(o, dict) or set(o) - {"ref", "dir"} or o.get("dir", "desc") not in {"asc", "desc"}:
            errores.append(f"orderBy.{i}: forma inválida")
            continue
        ref = o.get("ref")
        if not isinstance(ref, str) or not _REF.match(ref):
            errores.append(f"orderBy.{i}: ref inválida")
        elif ref.startswith("metric:"):
            if int(ref.split(":")[1]) >= len(metrics):
                errores.append(f"orderBy.{i}: no existe {ref}")
        elif ref not in campos_gb:
            errores.append(f"orderBy.{i}: {ref} no está en groupBy")

    limit = query.get("limit", 100)
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= min(1000, max_rows):
        errores.append(f"limit: entre 1 y {min(1000, max_rows)}")
    return errores


def alias_metrica(m: dict[str, Any]) -> str:
    """Nombre de columna que Node da a una métrica (`{agg}_{field|all}`)."""
    return f"{m['agg']}_{m.get('field') or 'all'}"
