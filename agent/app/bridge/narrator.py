"""Filas ejecutadas por Node -> respuesta en español, sin inventar nada.

Toda cifra del texto sale de las filas que Node devolvió (o de una operación
aritmética explícita sobre ellas: totales, porcentajes, equivalencias). Cada
respuesta dice QUÉ se midió, DÓNDE y CUÁNDO (el "alcance" del plan), y
declara los límites del dato (censo estimado, stock registrado, día de corte
incompleto...). Si no hay filas, lo dice; nunca rellena.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from app.agent.predictor import _DIAS_ES, proyectar
from app.analytics.statistics import mean, safe_number, simple_trend
from app.bridge.dsl import alias_metrica
from app.bridge.planner import ETIQUETA_DIM, Plan
from app.bridge.textos import (
    articulo,
    etiqueta_periodo,
    fecha_hora,
    fecha_larga,
    fmt_num,
    lista_natural,
    parse_fecha,
    rango_fechas,
    titulo,
    valor_dim,
)

# (singular, plural) de lo que se cuenta, por tema.
_CONTEO = {
    "surgeries": ("programación de cirugía", "programaciones de cirugía"),
    "alerts": ("alerta", "alertas"),
}

_PROMEDIO = {
    "wait": ("wait_minutes", "El tiempo de espera promedio", "minutos"),
    "stay": ("stay_hours", "La estancia promedio", "horas"),
    "age": ("patient_age", "La edad promedio de los pacientes", "años"),
}
_PROMEDIO_RANKING = {"wait": "La espera promedio", "stay": "La estancia promedio", "age": "La edad promedio"}
_PROMEDIO_SERIE = {"wait": "minutos de espera promedio", "stay": "horas de estancia promedio", "age": "años de edad promedio"}

_NOTA_CENSO = (
    "El censo es estimado: el HIS no registra la fecha de egreso, así que cada paciente cuenta "
    "como ingresado hasta su última actividad registrada."
)
_NOTA_INVENTARIO = (
    "Los días de inventario se calculan como el stock registrado por Farmacia dividido entre el "
    "consumo medio diario de los últimos 30 días."
)


def _alcance(plan: Plan) -> str:
    return " ".join(plan.alcance)


def _con(texto: str, alcance: str) -> str:
    return f"{texto} {alcance}".strip() if alcance else texto


def _filas(resultado: dict[str, Any] | None) -> list[dict[str, Any]]:
    filas = (resultado or {}).get("rows") or []
    return [f for f in filas if isinstance(f, dict)]


def _cierre(plan: Plan, ref: datetime | None, resultado: dict[str, Any] | None) -> list[str]:
    notas: list[str] = []
    # Un ranking o un "top N" se corta a propósito; un listado cortado sí hay que decirlo.
    if (resultado or {}).get("truncated") and not (plan.pronostico or plan.ranking or plan.top):
        notas.append(f"Se muestran los primeros {(resultado or {}).get('rowCount')} resultados.")
    for aviso in plan.avisos:
        notas.append(f"Nota: {aviso}.")
    if plan.periodo and ref:
        if plan.periodo.relativo_hoy:
            notas.append(f"Tomo como «hoy» la fecha del último registro disponible en el HIS ({fecha_larga(ref)}).")
        elif plan.periodo.hasta > ref + timedelta(days=1):
            notas.append(f"Los datos disponibles llegan hasta el {fecha_hora(ref)}, así que ese periodo está incompleto.")
    return notas


@dataclass
class Corte:
    """Límites temporales de los datos: `ref` es el "hoy" (último registro); `inicio`, el primero."""

    ref: datetime | None
    inicio: datetime | None = None


def redactar(
    plan: Plan, resultados: list[dict[str, Any] | None], ref: datetime | None, inicio: datetime | None = None
) -> str:
    """Respuesta final. `resultados` va alineado con [plan.consulta, *plan.extras]."""
    corte = Corte(ref, inicio)
    principal = resultados[0] if resultados else None
    extras = resultados[1:]
    if plan.pronostico:
        cuerpo = _pronostico(plan, _filas(principal), ref)
    elif plan.serie:
        cuerpo = _serie(plan, _filas(principal), corte)
    elif plan.tema == "occupancy":
        cuerpo = _ocupacion(plan, _filas(principal), ref)
    elif plan.tema == "inventory":
        cuerpo = _inventario(plan, _filas(principal), _filas(extras[0]) if extras else None, ref)
    elif plan.tema in _PROMEDIO and not plan.pide_conteo:
        cuerpo = _promedio(plan, _filas(principal), corte)
    elif plan.tema in {"medications", "services"}:
        cuerpo = _suma(plan, _filas(principal), corte)
    elif plan.tema == "generic":
        cuerpo = _generico(plan, _filas(principal))
    else:
        cuerpo = _conteo(plan, _filas(principal), _filas(extras[0]) if extras else None, corte)
    return " ".join([cuerpo, *_cierre(plan, ref, principal)]).strip()


# ── Ocupación ────────────────────────────────────────────────────────────────


def _ocupacion(plan: Plan, filas: list[dict[str, Any]], ref: datetime | None) -> str:
    corte = f"Con corte al {fecha_hora(ref)} (último registro del HIS)" if ref else "Con los últimos datos disponibles"
    if not filas:
        return f"{corte}, no hay datos de ocupación {_alcance(plan)}.".replace(" .", ".")

    def pct(f: dict[str, Any]) -> float | None:
        return safe_number(f.get("avg_occupancy_pct"))

    filas = sorted(filas, key=lambda f: (pct(f) is None, -(pct(f) or 0)))
    if plan.ranking == "asc":
        filas = sorted(filas, key=lambda f: (pct(f) is None, pct(f) or 0))

    def frase(f: dict[str, Any]) -> str:
        censo, camas, p = f.get("sum_census"), f.get("sum_physical_beds"), pct(f)
        texto = f"{titulo(f.get('unit'))} tiene {fmt_num(censo, 0)} camas ocupadas de {fmt_num(camas, 0)} camas físicas"
        texto += f" ({fmt_num(p, 2)} % de ocupación)" if p is not None else " (sin camas físicas registradas para calcular el porcentaje)"
        virtuales = safe_number(f.get("sum_virtual_census")) or 0
        if virtuales > 0:
            texto += f"; el censo incluye {fmt_num(virtuales, 0)} pacientes en camas virtuales"
        if p is not None and p > 100:
            texto += ": está por encima de su capacidad física"
        elif camas is not None and censo is not None and camas > censo:
            libres = camas - censo
            texto += f"; quedan {fmt_num(libres, 0)} {'cama física libre' if libres == 1 else 'camas físicas libres'}"
        return texto

    if plan.unidades:
        return f"{corte}, " + "; ".join(frase(f) for f in filas) + f". {_NOTA_CENSO}"

    censo = sum(safe_number(f.get("sum_census")) or 0 for f in filas)
    camas = sum(safe_number(f.get("sum_physical_beds")) or 0 for f in filas)
    partes = [f"{corte}, el hospital tiene {fmt_num(censo, 0)} camas ocupadas de {fmt_num(camas, 0)} camas físicas"]
    if camas:
        partes[0] += f" ({fmt_num(censo / camas * 100, 2)} % de ocupación global)"
    partes[0] += "."
    destacadas = [f for f in filas if pct(f) is not None][:3]
    if destacadas:
        orden = "menor" if plan.ranking == "asc" else "mayor"
        partes.append(
            f"Las unidades con {orden} ocupación son "
            + lista_natural(
                [
                    f"{titulo(f.get('unit'))} ({fmt_num(pct(f), 2)} %, {fmt_num(f.get('sum_census'), 0)} de {fmt_num(f.get('sum_physical_beds'), 0)} camas)"
                    for f in destacadas
                ]
            )
            + "."
        )
    sobre = [f for f in filas if (pct(f) or 0) > 100]
    if sobre:
        partes.append(
            f"{len(sobre)} {'unidad supera' if len(sobre) == 1 else 'unidades superan'} el 100 % de su capacidad física: "
            + lista_natural([titulo(f.get("unit")) for f in sobre])
            + "."
        )
    partes.append(_NOTA_CENSO)
    return " ".join(partes)


# ── Inventario ───────────────────────────────────────────────────────────────


def _inventario(plan: Plan, filas: list[dict[str, Any]], por_riesgo: list[dict[str, Any]] | None, ref: datetime | None) -> str:
    alcance = _alcance(plan)
    corte = f"Con corte al {fecha_larga(ref)}" if ref else "Con los datos disponibles"
    total = sum(int(safe_number(f.get("count_all")) or 0) for f in por_riesgo) if por_riesgo is not None else None

    if not filas:
        if total == 0 or (total is None and not alcance):
            return (
                "Farmacia aún no ha registrado stock de ningún medicamento, así que no puedo calcular días de "
                "inventario. Cuando se registre el stock, podré decir cuáles están en riesgo."
            )
        if total:
            return (
                f"{corte}, no hay medicamentos {alcance} entre los {fmt_num(total, 0)} que tienen stock registrado "
                f"por Farmacia. {_NOTA_INVENTARIO}"
            )
        return f"{corte}, no hay medicamentos con stock registrado {alcance}. {_NOTA_INVENTARIO}"

    def item(f: dict[str, Any]) -> str:
        nombre = titulo(f.get("name") or f.get("code"))
        dias = safe_number(f.get("min_days_of_inventory"))
        stock = fmt_num(f.get("sum_stock"), 0)
        if dias is None:
            return f"{nombre}: stock de {stock} unidades sin consumo en los últimos 30 días (no se puede estimar cuánto dura)"
        texto = (
            f"{nombre}: {fmt_num(dias, 2)} días de inventario (stock de {stock} unidades y consumo medio de "
            f"{fmt_num(f.get('min_avg_daily_consumption'), 2)} por día)"
        )
        # Si se filtró por un único riesgo, la columna no viene (ya lo dice el alcance).
        return texto + (f", riesgo {valor_dim('risk', f['risk'])}" if f.get("risk") else "")

    n = len(filas)
    cabecera = (
        f"{corte}, hay {n} medicamento{'s' if n != 1 else ''} {alcance}".strip()
        if alcance
        else f"{corte}, estos son los {n} medicamentos con stock registrado, ordenados por días de inventario"
    )
    texto = cabecera + ": " + "; ".join(item(f) for f in filas[:10]) + "."
    if n > 10:
        texto += f" (y {n - 10} más)."
    if total is not None and total > n:
        texto += f" En total, {fmt_num(total, 0)} medicamentos tienen stock registrado por Farmacia."
    return f"{texto} {_NOTA_INVENTARIO}"


# ── Promedios (espera, estancia, edad) ───────────────────────────────────────


def _dim_de(plan: Plan) -> str | None:
    gb = plan.consulta.get("groupBy") or []
    return gb[0]["field"] if gb else None


def _clave(f: dict[str, Any], dims: list[str]) -> str:
    return " · ".join(valor_dim(d, f.get(d)) for d in dims)


def _dims(plan: Plan) -> list[str]:
    return [g["field"] for g in plan.consulta.get("groupBy") or []]


def _promedio(plan: Plan, filas: list[dict[str, Any]], corte: Corte) -> str:
    medida, sujeto, unidad = _PROMEDIO[plan.tema]
    col = f"avg_{medida}"
    alcance = _alcance(plan)
    dims = _dims(plan)
    if not dims:
        v = safe_number(filas[0].get(col)) if filas else None
        if v is None:
            return _con("No hay registros con ese dato", alcance) + "."
        texto = _con(sujeto, alcance) + f" fue de {fmt_num(v, 1)} {unidad}"
        if plan.tema == "wait" and v >= 90:
            texto += f" (unas {int(v // 60)} h {int(round(v % 60))} min)"
        if plan.tema == "stay" and v >= 48:
            texto += f" (unos {fmt_num(v / 24, 1)} días)"
        return texto + "."

    if dims[0].endswith("_at"):
        pts = [(f.get(dims[0]), safe_number(f.get(col))) for f in filas]
        return _serie_texto(plan, [(k, v) for k, v in pts if v is not None], _PROMEDIO_SERIE[plan.tema], corte, 1, acumulada=False)
    datos = [(_clave(f, dims), safe_number(f.get(col))) for f in filas]
    datos = [(k, v) for k, v in datos if v is not None]
    if not datos:
        return _con("No hay registros con ese dato", alcance) + "."
    datos.sort(key=lambda kv: kv[1] if plan.ranking == "asc" else -kv[1])
    por = lista_natural([ETIQUETA_DIM.get(d, d) for d in dims])
    lista = "; ".join(f"{k}: {fmt_num(v, 1)} {unidad}" for k, v in datos[:12])
    if plan.ranking:
        extremo = "más baja" if plan.ranking == "asc" else "más alta"
        k, v = datos[0]
        return (
            _con(f"{_PROMEDIO_RANKING[plan.tema]} {extremo}", alcance)
            + f" corresponde a {k}: {fmt_num(v, 1)} {unidad}. Detalle por {por}: {lista}."
        )
    return _con(sujeto, alcance) + f", por {por}: {lista}."


# ── Conteos ─────────────────────────────────────────────────────────────────


def _sustantivo(plan: Plan) -> tuple[str, str]:
    if plan.pide_conteo:
        return "paciente", "pacientes"
    return _CONTEO.get(plan.tema, ("ingreso", "ingresos"))


def _conteo(plan: Plan, filas: list[dict[str, Any]], contexto: list[dict[str, Any]] | None, corte: Corte) -> str:
    sing, plur = _sustantivo(plan)
    alcance = _alcance(plan)
    dims = _dims(plan)
    if not dims:
        n = int(safe_number(filas[0].get("count_all")) or 0) if filas else 0
        if plan.tema in {"surgeries", "alerts"}:
            verbo = "Hay"
        else:
            verbo = "Se registró" if n == 1 else "Se registraron"
        texto = _con(f"{verbo} {fmt_num(n, 0)} {sing if n == 1 else plur}", alcance)
        total = sum(int(safe_number(f.get("count_all")) or 0) for f in contexto or [])
        if plan.tema == "surgeries" and total:
            texto += f", el {fmt_num(n / total * 100, 1)} % del total. " + _distribucion_cirugias(contexto, prefijo="En total hay")
            return texto
        return texto + "."

    if not filas:
        return _con(f"No hay {plur}", alcance) + "."
    if dims[0].endswith("_at"):
        return _serie_texto(plan, _puntos(plan, filas), plur, corte)
    if plan.tema == "surgeries" and dims == ["executed"] and not plan.ranking:
        return _distribucion_cirugias(filas, prefijo="De", alcance=alcance)

    datos = [(_clave(f, dims), int(safe_number(f.get("count_all")) or 0)) for f in filas]
    completo = not plan.top and len(datos) < int(plan.consulta.get("limit") or 0)
    total = sum(v for _, v in datos) if completo else None
    por = lista_natural([ETIQUETA_DIM.get(d, d) for d in dims])

    def con_pct(v: int) -> str:
        return f"{fmt_num(v, 0)} ({fmt_num(v / total * 100, 1)} %)" if total else fmt_num(v, 0)

    if plan.ranking:
        # "Sin nombre/diagnóstico registrado" no encabeza un ranking: se informa aparte.
        sin_nombre = [(k, v) for (k, v), f in zip(datos, filas, strict=True) if f.get(dims[0]) in (None, "")]
        con_nombre = [kv for kv in datos if kv not in sin_nombre] or datos
        k, v = con_nombre[0]
        extremo = "menos" if plan.ranking == "asc" else "más"
        texto = _con(f"{k} es {articulo(por)} {por} con {extremo} {plur}", alcance) + f": {con_pct(v)}"
        if total:
            texto += f" de un total de {fmt_num(total, 0)}"
        siguientes = con_nombre[1:5]
        if siguientes:
            texto += ". Le siguen " + lista_natural([f"{a} ({fmt_num(b, 0)})" for a, b in siguientes])
        texto += "."
        if sin_nombre and con_nombre is not datos:
            texto += f" Además, {fmt_num(sin_nombre[0][1], 0)} {plur} tienen {sin_nombre[0][0]}."
        return texto[0].upper() + texto[1:]
    lista = "; ".join(f"{k}: {con_pct(v)}" for k, v in datos[:12])
    texto = _con(plur[0].upper() + plur[1:], alcance) + f", por {por}: {lista}."
    if total and plan.destacar:
        claves = {valor_dim(dims[0], d) for d in plan.destacar}
        elegidos = [(k, v) for k, v in datos if k in claves]
        if elegidos:
            texto = (
                lista_natural([f"{k} representa el {fmt_num(v / total * 100, 1)} % ({fmt_num(v, 0)} de {fmt_num(total, 0)})" for k, v in elegidos])
                + f" de los {plur}"
                + (f" {alcance}" if alcance else "")
                + ". Detalle: "
                + texto
            )
    if len(datos) > 12:
        texto += f" (y {len(datos) - 12} grupos más)."
    if total:
        texto += f" Total: {fmt_num(total, 0)}."
    return texto


def _distribucion_cirugias(filas: list[dict[str, Any]], prefijo: str, alcance: str = "") -> str:
    conteo = {str(f.get("executed")): int(safe_number(f.get("count_all")) or 0) for f in filas}
    total = sum(conteo.values())
    partes = [f"{fmt_num(conteo[k], 0)} {valor_dim('executed', k)}" for k in ("si", "no", "desconocido") if k in conteo]
    texto = _con(f"{prefijo} {fmt_num(total, 0)} programaciones de cirugía", alcance) + f": {lista_natural(partes)}."
    if conteo.get("desconocido"):
        texto += " «Sin dato de ejecución» significa que la programación no tiene un ingreso verificable en el extracto del HIS."
    return texto


# ── Sumas (medicamentos, servicios) ─────────────────────────────────────────


def _suma(plan: Plan, filas: list[dict[str, Any]], corte: Corte) -> str:
    alcance = _alcance(plan)
    med = plan.tema == "medications"
    dim = _dim_de(plan)
    if not dim:
        n = safe_number(filas[0].get("sum_quantity")) if filas else None
        if n is None:
            return _con("No hay dispensaciones registradas" if med else "No hay servicios registrados", alcance) + "."
        base = "Se dispensaron {n} unidades de medicamentos e insumos" if med else "Se prestaron {n} unidades de servicios y procedimientos"
        return _con(base.format(n=fmt_num(n, 0)), alcance) + "."

    if dim.endswith("_at"):
        return _serie_texto(plan, _puntos(plan, filas), "unidades" if med else "unidades de servicio", corte)
    datos = [(_clave(f, _dims(plan)), safe_number(f.get("sum_quantity"))) for f in filas]
    datos = [(k, v) for k, v in datos if v is not None]
    if not datos:
        return _con("No hay registros", alcance) + "."
    que = {"name": "medicamentos e insumos", "procedure_name": "servicios y procedimientos"}.get(dim, ETIQUETA_DIM.get(dim, dim) + "s")
    extremo = "menor" if plan.ranking == "asc" else "mayor"
    titular = f"Los {que} con {extremo} {'consumo' if med else 'volumen'}" if dim in {"name", "procedure_name"} else (
        f"{'Consumo' if med else 'Volumen de servicios'} por {ETIQUETA_DIM.get(dim, dim)}"
    )
    lista = "; ".join(f"{i}) {k}: {fmt_num(v, 0)} unidades" for i, (k, v) in enumerate(datos[:10], 1))
    return _con(titular, alcance) + f" son: {lista}."


# ── Series y pronóstico ─────────────────────────────────────────────────────

_MEDIDA_SERIE = {
    "admissions": ("ingresos", 0),
    "wait": ("minutos de espera promedio", 1),
    "medications": ("unidades dispensadas", 0),
    "services": ("unidades de servicio", 0),
}


def _puntos(plan: Plan, filas: list[dict[str, Any]]) -> list[tuple[Any, float]]:
    gb = plan.consulta["groupBy"][0]["field"]
    col = alias_metrica(plan.consulta["metrics"][0])
    pts = [(f.get(gb), safe_number(f.get(col))) for f in filas]
    pts = [(k, v) for k, v in pts if v is not None and parse_fecha(k)]
    pts = sorted(pts, key=lambda kv: parse_fecha(kv[0]) or datetime.min)
    # GROUP BY no devuelve los periodos SIN registros: en un conteo/suma esos periodos valen 0.
    # Sin rellenarlos, una unidad con pocos ingresos (UCI) parecería tener carga todos los días.
    if plan.consulta["metrics"][0]["agg"] in {"count", "sum"}:
        pts = _densificar(pts, plan.consulta["groupBy"][0].get("grain") or "day")
    return pts


def _densificar(pts: list[tuple[Any, float]], grain: str) -> list[tuple[Any, float]]:
    if len(pts) < 2:
        return pts
    por_dia = {(parse_fecha(k) or datetime.min).date(): (k, v) for k, v in pts}
    actual = parse_fecha(pts[0][0])
    fin = parse_fecha(pts[-1][0])
    out: list[tuple[Any, float]] = []
    while actual and fin and actual <= fin:
        out.append(por_dia.get(actual.date(), (actual.strftime("%Y-%m-%dT00:00:00"), 0.0)))
        actual = _fin_periodo(actual, grain)
    return out


def _serie(plan: Plan, filas: list[dict[str, Any]], corte: Corte) -> str:
    medida, dec = _MEDIDA_SERIE.get(plan.tema, ("registros", 0))
    return _serie_texto(plan, _puntos(plan, filas), medida, corte, dec, acumulada=plan.tema != "wait")


def _fin_periodo(inicio: datetime, grain: str) -> datetime:
    if grain == "day":
        return inicio + timedelta(days=1)
    if grain == "week":
        return inicio + timedelta(days=7)
    if grain == "month":
        return inicio.replace(year=inicio.year + 1, month=1) if inicio.month == 12 else inicio.replace(month=inicio.month + 1)
    return inicio.replace(year=inicio.year + 1)


def _incompletos(plan: Plan, pts: list[tuple[Any, float]], grain: str, corte: Corte) -> set[int]:
    """Índices de periodos que no están completos: empiezan antes de los datos/del filtro o contienen el corte."""
    out: set[int] = set()
    desde = max(
        [d for d in (plan.periodo.desde if plan.periodo else None, corte.inicio) if d is not None],
        default=None,
    )
    primero = parse_fecha(pts[0][0])
    if desde and primero and primero.date() < desde.date():
        out.add(0)
    ultimo = parse_fecha(pts[-1][0])
    if corte.ref and ultimo and ultimo.date() <= corte.ref.date() < _fin_periodo(ultimo, grain).date():
        out.add(len(pts) - 1)
    return out


def _serie_texto(
    plan: Plan, pts: list[tuple[Any, float]], medida: str, corte: Corte, dec: int = 0, *, acumulada: bool = True
) -> str:
    """Resumen de una serie temporal. En conteos/sumas, los periodos incompletos no entran en las
    estadísticas (una semana a medias parecería una caída); en promedios sí, pero se avisa."""
    grain = (plan.consulta.get("groupBy") or [{}])[0].get("grain") or "day"
    alcance = _alcance(plan)
    if not pts:
        return _con(f"No hay {medida} registrados", alcance) + "."
    pts = sorted(pts, key=lambda kv: parse_fecha(kv[0]) or datetime.min)
    nombre = {"day": "día", "week": "semana", "month": "mes", "year": "año"}[grain]
    incompletos = _incompletos(plan, pts, grain, corte) if len(pts) > 1 else set()
    base = [p for i, p in enumerate(pts) if not (acumulada and i in incompletos)] or pts
    valores = [v for _, v in base]
    k_max = max(base, key=lambda kv: kv[1])
    k_min = min(base, key=lambda kv: kv[1])
    texto = _con(f"Evolución de {medida}", alcance) + (
        f" por {nombre}, entre {etiqueta_periodo(pts[0][0], grain)} y {etiqueta_periodo(pts[-1][0], grain)}"
        f" ({len(pts)} periodos): promedio de {fmt_num(mean(valores), dec or 1)} por {nombre};"
        f" máximo de {fmt_num(k_max[1], dec)} ({etiqueta_periodo(k_max[0], grain)})"
        f" y mínimo de {fmt_num(k_min[1], dec)} ({etiqueta_periodo(k_min[0], grain)})."
    )
    if plan.ranking and len(base) > 1:
        k, v = k_max if plan.ranking != "asc" else k_min
        texto = _con(f"El {nombre} con {'menos' if plan.ranking == 'asc' else 'más'} {medida}", alcance) + (
            f" fue {etiqueta_periodo(k, grain)}, con {fmt_num(v, dec)}. " + texto
        )
    if len(valores) >= 4:
        mitad = len(valores) // 2
        a, b = mean(valores[:mitad]) or 0, mean(valores[mitad:]) or 0
        texto += (
            f" La tendencia es {simple_trend(valores)}: la primera mitad promedió {fmt_num(a, 1)} y la segunda {fmt_num(b, 1)}."
        )
    if incompletos:
        etiquetas = lista_natural([etiqueta_periodo(pts[i][0], grain) for i in sorted(incompletos)])
        if acumulada:
            texto += f" No se cuentan en el promedio, el máximo, el mínimo ni la tendencia los periodos incompletos ({etiquetas})."
        else:
            texto += f" Periodos incompletos: {etiquetas}."
        if corte.ref and len(pts) - 1 in incompletos:
            texto += f" Los datos llegan hasta el {fecha_hora(corte.ref)}."
    return texto


def _pronostico(plan: Plan, filas: list[dict[str, Any]], ref: datetime | None) -> str:
    medida, dec = _MEDIDA_SERIE.get(plan.tema, ("registros", 0))
    medida_dia = {"admissions": "ingresos diarios", "wait": "espera promedio diaria (minutos)"}.get(plan.tema, f"{medida} por día")
    alcance = _alcance(plan)
    pts = _puntos(plan, filas)
    # El día de corte está incompleto (los datos acaban a media jornada) y lo posterior al corte también
    # (p. ej. dispensaciones registradas después del último ingreso): sesgarían la proyección a la baja.
    if ref:
        pts = [p for p in pts if (parse_fecha(p[0]) or ref).date() < ref.date()]
    if len(pts) < 7:
        return _con(
            f"No hay historial suficiente de {medida_dia} para proyectar con seguridad ({len(pts)} días con datos)", alcance
        ) + ". Se necesitan al menos 7 días completos."

    valores = [v for _, v in pts]
    ultimo = parse_fecha(pts[-1][0]) or datetime.now()
    # Los días entre el último completo y el corte se proyectan pero no se muestran:
    # "la próxima semana" empieza el día DESPUÉS del corte.
    hueco = max(0, (ref.date() - ultimo.date()).days) if ref else 0
    proy = proyectar(valores, plan.horizonte + hueco)
    if not proy:
        return _con(f"No pude calcular una proyección fiable de {medida_dia}", alcance) + "."
    proy.valores = proy.valores[hueco:]
    fechas = [ultimo + timedelta(days=hueco + i + 1) for i in range(plan.horizonte)]
    base = mean(valores[-7:]) or 0
    prom = mean(proy.valores) or 0
    decs = dec or 1

    texto = _con(f"Proyección de {medida_dia}", alcance) + (
        f" para los próximos {plan.horizonte} días ({rango_fechas(fechas[0], fechas[-1] + timedelta(days=1))}): "
        # Con pocos casos por día (UCI) el entero engaña ("4; 4; 4" con promedio 4,4): un decimal.
        + "; ".join(
            f"{etiqueta_periodo(f.strftime('%Y-%m-%dT00:00:00'), 'day')}: {fmt_num(v, 0 if dec == 0 and base >= 20 else 1)}"
            for f, v in zip(fechas, proy.valores, strict=True)
        )
        + f". En promedio, {fmt_num(prom, decs)} por día, frente a {fmt_num(base, decs)} de promedio en los últimos 7 días completos"
    )
    if base:
        cambio = (prom - base) / base * 100
        texto += " (prácticamente estable)" if abs(cambio) < 3 else f" ({'+' if cambio > 0 else '−'}{fmt_num(abs(cambio), 1)} %)"
    texto += "."
    if proy.error_tipico is not None:
        texto += f" Margen de error típico: ±{fmt_num(proy.error_tipico, 1)} por día."
    else:
        texto += " Con poco historial, la proyección es el promedio reciente."
    por_dia: dict[int, list[float]] = {}
    for k, v in pts:
        d = parse_fecha(k)
        if d:
            por_dia.setdefault(d.weekday(), []).append(v)
    if len(por_dia) == 7:
        pico = max(por_dia, key=lambda d: mean(por_dia[d]) or 0)
        texto += f" Históricamente, el día de mayor carga es el {_DIAS_ES[pico]} ({fmt_num(mean(por_dia[pico]), decs)} de promedio)."
    texto += (
        f" Estimación basada en {len(pts)} días de historial hasta el {fecha_larga(ultimo)}; es orientativa y no "
        "sustituye el criterio del equipo."
    )
    return texto


# ── Consulta genérica (propuesta por el LLM) ─────────────────────────────────

_ETIQUETA_METRICA = {
    "count": "cantidad",
    "count_distinct": "cantidad de valores distintos de",
    "sum": "total de",
    "avg": "promedio de",
    "min": "mínimo de",
    "max": "máximo de",
}
_ETIQUETA_MEDIDA = {
    "wait_minutes": "espera (minutos)",
    "stay_hours": "estancia (horas)",
    "patient_age": "edad (años)",
    "quantity": "cantidad",
    "census": "camas ocupadas",
    "physical_beds": "camas físicas",
    "virtual_census": "camas virtuales ocupadas",
    "occupancy_pct": "ocupación (%)",
    "stock": "stock",
    "avg_daily_consumption": "consumo medio diario",
    "days_of_inventory": "días de inventario",
    "value": "valor",
    "threshold": "umbral",
}
_NOMBRE_DATASET = {
    "admissions": "ingresos hospitalarios",
    "services": "servicios prestados",
    "medications": "dispensaciones de medicamentos",
    "surgeries": "programaciones de cirugía",
    "alerts": "alertas operativas",
    "bed_occupancy": "ocupación de camas",
    "medication_inventory": "inventario de medicamentos",
}


_OP_FILTRO = {"eq": "", "neq": "distinto de", "gt": "mayor a", "gte": "de al menos", "lt": "menor a", "lte": "de hasta"}


def describir_filtros(consulta: dict[str, Any]) -> list[str]:
    """Filtros del DSL en lenguaje natural: la respuesta dice exactamente qué se filtró."""
    out: list[str] = []
    for f in consulta.get("filters") or []:
        campo, op, valor = f["field"], f["op"], f["value"]
        etiqueta = _ETIQUETA_MEDIDA.get(campo) or ETIQUETA_DIM.get(campo, campo)
        valores = valor if isinstance(valor, list) else [valor]
        if campo.endswith("_at"):
            fechas = [parse_fecha(v) for v in valores]
            if any(d is None for d in fechas):
                continue
            if op == "between":
                out.append(f"entre el {fecha_larga(fechas[0])} y el {fecha_larga(fechas[1])}")
            elif op in {"gt", "gte"}:
                out.append(f"desde el {fecha_larga(fechas[0])}")
            elif op in {"lt", "lte"}:
                out.append(f"{'antes del' if op == 'lt' else 'hasta el'} {fecha_larga(fechas[0])}")
            else:
                out.append(f"el {fecha_larga(fechas[0])}")
        elif op == "contains":
            out.append(f"({etiqueta} que contiene «{valor}»)")
        elif op in {"eq", "in"}:
            out.append(f"({etiqueta}: {lista_natural([valor_dim(campo, v) for v in valores], 'o')})")
        elif op == "between":
            out.append(f"(con {etiqueta} entre {fmt_num(valores[0], 2)} y {fmt_num(valores[1], 2)})")
        else:
            texto = fmt_num(valor, 2) if isinstance(valor, (int, float)) else valor_dim(campo, valor)
            out.append(f"(con {etiqueta} {_OP_FILTRO[op]} {texto})")
    return out


def describir_metrica(m: dict[str, Any]) -> str:
    if m["agg"] == "count":
        return "cantidad de registros"
    campo = m.get("field") or ""
    return f"{_ETIQUETA_METRICA[m['agg']]} {_ETIQUETA_MEDIDA.get(campo, ETIQUETA_DIM.get(campo, campo))}"


def _generico(plan: Plan, filas: list[dict[str, Any]]) -> str:
    q = plan.consulta
    metricas = q["metrics"]
    dims = [g["field"] for g in q.get("groupBy") or []]
    fuente = _NOMBRE_DATASET.get(q["dataset"], q["dataset"])
    alcance = _alcance(plan)
    que = lista_natural([describir_metrica(m) for m in metricas])
    if not filas:
        return _con(f"No hay registros de {fuente}", alcance) + " para esa consulta."
    dec = lambda m: 0 if m["agg"] in {"count", "count_distinct"} else 2  # noqa: E731
    if not dims:
        f = filas[0]
        partes = [f"{describir_metrica(m)}: {fmt_num(f.get(alias_metrica(m)), dec(m))}" for m in metricas]
        return _con(f"En {fuente}", alcance) + ", " + "; ".join(partes) + "."
    lineas = []
    for f in filas[:12]:
        clave = _clave(f, dims)
        valores = ", ".join(fmt_num(f.get(alias_metrica(m)), dec(m)) for m in metricas)
        lineas.append(f"{clave}: {valores}")
    por = lista_natural([ETIQUETA_DIM.get(d, d) for d in dims])
    texto = _con(f"En {fuente}", alcance) + f", {que} por {por}: " + "; ".join(lineas) + "."
    if len(filas) > 12:
        texto += f" (y {len(filas) - 12} filas más)."
    return texto
