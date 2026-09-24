"""Formato en español (Colombia) de números, fechas y listas para las respuestas."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from app.bridge.nlu import MESES, TZ

_ENUMS: dict[tuple[str, str], str] = {
    ("type", "LOW_STOCK"): "stock bajo",
    ("type", "HIGH_OCCUPANCY"): "ocupación alta",
    ("type", "LONG_WAIT"): "espera prolongada",
    ("type", "DEMAND_SPIKE"): "pico de demanda",
    ("type", "SURGERY_CANCELLATIONS"): "cancelaciones de cirugía",
    ("severity", "WARNING"): "advertencia",
    ("severity", "CRITICAL"): "crítica",
    ("status", "OPEN"): "abierta",
    ("status", "ACKNOWLEDGED"): "reconocida",
    ("status", "RESOLVED"): "resuelta",
    ("scope", "medication"): "medicamento",
    ("scope", "service"): "servicio",
    ("scope", "triage"): "triage",
    ("scope", "surgery"): "cirugía",
    ("risk", "CRITICAL"): "crítico",
    ("risk", "LOW"): "bajo",
    ("risk", "OK"): "suficiente",
    ("risk", "insufficient_data"): "sin consumo reciente",
    ("executed", "si"): "realizadas",
    ("executed", "no"): "no realizadas",
    ("executed", "desconocido"): "sin dato de ejecución",
}

_SIN_DATO = {"diagnosis_name": "sin diagnóstico registrado", "procedure_name": "procedimiento sin nombre en el catálogo"}


_MINUSCULAS = {"de", "del", "la", "las", "el", "los", "y", "en", "a", "por", "con", "para", "o"}


def fmt_num(v: Any, decimales: int = 1) -> str:
    """7489 -> '7.489'; 61.53 -> '61,5'; 78.38 (decimales=2) -> '78,38'."""
    try:
        n = float(v)
    except (TypeError, ValueError):
        return str(v)
    n = round(n, decimales)
    if n.is_integer():
        return f"{int(n):,}".replace(",", ".")
    entero, _, frac = f"{n:.{decimales}f}".partition(".")
    frac = frac.rstrip("0")
    entero_fmt = f"{int(entero):,}".replace(",", ".") if entero not in {"-0"} else "-0"
    return f"{entero_fmt},{frac}" if frac else entero_fmt


def titulo(valor: Any) -> str:
    """'UNIDAD DE CUIDADO INTENSIVO' -> 'Unidad de Cuidado Intensivo' (solo si viene en mayúsculas)."""
    texto = str(valor).strip()
    if not texto or texto != texto.upper() or not any(c.isalpha() for c in texto):
        return texto
    palabras = texto.lower().split()
    return " ".join(p if (i > 0 and p in _MINUSCULAS) else p[:1].upper() + p[1:] for i, p in enumerate(palabras))


def lista_natural(items: list[str], conj: str = "y") -> str:
    items = [i for i in items if i]
    if len(items) <= 1:
        return items[0] if items else ""
    return ", ".join(items[:-1]) + f" {conj} " + items[-1]


def _local(dt: datetime) -> datetime:
    return dt.astimezone(TZ) if dt.tzinfo else dt.replace(tzinfo=TZ)


def fecha_larga(dt: datetime) -> str:
    d = _local(dt)
    return f"{d.day} de {MESES[d.month - 1]} de {d.year}"


def fecha_hora(dt: datetime) -> str:
    d = _local(dt)
    return f"{fecha_larga(d)} a las {d:%H:%M}"


def fecha_corta(dt: datetime) -> str:
    d = _local(dt)
    return f"{d.day} {MESES[d.month - 1][:3]}"


def rango_fechas(desde: datetime, hasta_exclusivo: datetime) -> str:
    """Rango legible con el ÚLTIMO día incluido (hasta es exclusivo)."""
    a = _local(desde)
    b = _local(hasta_exclusivo) - timedelta(microseconds=1)
    if a.date() == b.date():
        return fecha_larga(a)
    if (a.year, a.month) == (b.year, b.month):
        return f"del {a.day} al {b.day} de {MESES[b.month - 1]} de {b.year}"
    if a.year == b.year:
        return f"del {a.day} de {MESES[a.month - 1]} al {b.day} de {MESES[b.month - 1]} de {b.year}"
    return f"del {fecha_larga(a)} al {fecha_larga(b)}"


def parse_fecha(valor: Any) -> datetime | None:
    """Fechas de Node: los cortes por día/semana/mes llegan como medianoche 'Z' del día LOCAL."""
    if not isinstance(valor, str) or not valor:
        return None
    try:
        d = datetime.fromisoformat(valor.replace("Z", "+00:00"))
    except ValueError:
        return None
    return d.replace(tzinfo=TZ) if d.tzinfo is None else d.replace(tzinfo=None).replace(tzinfo=TZ)


def etiqueta_periodo(valor: Any, grain: str | None) -> str:
    d = parse_fecha(valor)
    if not d:
        return str(valor)
    if grain == "month":
        return f"{MESES[d.month - 1]} de {d.year}"
    if grain == "year":
        return str(d.year)
    if grain == "week":
        return f"semana del {fecha_corta(d)}"
    return fecha_corta(d) + f" {d.year}" if grain is None else fecha_corta(d)


_MASCULINAS = {
    "sexo", "régimen", "tipo de riesgo", "nivel de triage", "diagnóstico", "código de diagnóstico", "procedimiento",
    "código de procedimiento", "tipo de alerta", "estado", "tipo", "código", "nombre", "recurso", "riesgo", "ámbito",
}


def articulo(etiqueta: str) -> str:
    """Artículo definido de una etiqueta de dimensión ("la unidad", "el diagnóstico")."""
    return "el" if etiqueta.split(" y ")[0] in _MASCULINAS else "la"


def valor_dim(dim: str, v: Any) -> str:
    """Valor de una dimensión en lenguaje natural (enums traducidos, nombres en formato título)."""
    if v is None or v == "":
        return _SIN_DATO.get(dim, "sin dato")
    if (dim, str(v)) in _ENUMS:
        return _ENUMS[(dim, str(v))]
    if dim == "triage_level":
        try:
            return f"triage {int(float(v))}"
        except (TypeError, ValueError):
            return f"triage {v}"
    if dim.endswith("_at"):
        return etiqueta_periodo(v, "day")
    return titulo(v)
