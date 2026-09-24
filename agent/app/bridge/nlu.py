"""Comprensión determinista de preguntas operativas en español.

Extrae del texto lo que el planificador necesita (tema, unidad, periodo,
comparadores, agrupación, ranking) sin LLM: rápido, reproducible y probado
con una batería de preguntas reales (tests/test_nlu.py). Los valores de
filtro NUNCA se inventan: se resuelven contra el vocabulario real que Node
manda en el catálogo (`values` de cada dimensión).
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

# America/Bogota: UTC-5 fijo, sin horario de verano (mismo criterio que Node).
TZ = timezone(timedelta(hours=-5))

MESES = (
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
)
_NUMEROS = {
    "un": 1, "una": 1, "uno": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5, "seis": 6,
    "siete": 7, "ocho": 8, "nueve": 9, "diez": 10, "quince": 15, "veinte": 20, "treinta": 30,
}
_ROMANOS = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5}


def norm(text: str) -> str:
    """Minúsculas, sin tildes ni signos; conserva dígitos, % y separadores decimales."""
    t = unicodedata.normalize("NFD", text.lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    t = re.sub(r"[^a-z0-9%/.,:\- ]", " ", t)
    t = re.sub(r"(?<!\d)[.,:](?!\d)", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def has(t: str, *raices: str) -> bool:
    """Alguna raíz aparece al INICIO de una palabra (prefijo), no en medio."""
    return any(re.search(r"(?<![a-z0-9])" + re.escape(r), t) for r in raices)


def _num(texto: str) -> float | None:
    texto = texto.strip()
    if texto in _NUMEROS:
        return float(_NUMEROS[texto])
    try:
        return float(texto.replace(",", "."))
    except ValueError:
        return None


# ── Conversación y seguridad ─────────────────────────────────────────────────

_SALUDOS = ("hola", "buenos dias", "buenas tardes", "buenas noches", "buenas", "saludos", "hey", "que tal", "buen dia")
_GRACIAS = ("gracias", "muchas gracias", "te agradezco", "perfecto gracias", "excelente", "genial", "ok", "vale", "listo")
_DESPEDIDAS = ("adios", "hasta luego", "chao", "nos vemos", "hasta pronto")
_AYUDA = (
    "ayuda", "que puedes", "que sabes", "que haces", "quien eres", "que eres", "como funcionas",
    "en que me ayudas", "en que me puedes", "que te puedo preguntar", "que puedo preguntar",
    "para que sirves", "que preguntas", "como te uso", "presentate", "capacidades",
)
_CLINICO = (
    "que dosis", "cuanta dosis", "dosis recomendada", "dosis debo", "dosis le", "dosis para", "que le doy",
    "que medicamento le", "que medicamento debo", "que medicamento tomo", "que debo tomar", "puedo tomar",
    "tratamiento para", "tratamiento de", "como trato", "como tratar", "que receto", "recetar", "debo prescrib",
    "que prescrib", "diagnosticar", "diagnosticame", "me duele", "tengo dolor", "tengo fiebre", "sintoma",
    "automedic", "que tomo", "es grave si",
)
_PII = (
    "nombre del paciente", "nombres de los pacientes", "nombre de los pacientes", "cedula", "documento de identidad",
    "numero de documento", "telefono", "direccion de", "historia clinica de", "datos personales", "quien es el paciente",
)


def clasificar_conversacion(t: str) -> str | None:
    """'clinical' | 'pii' | 'greeting' | 'thanks' | 'bye' | 'help' | None (no es charla)."""
    if has(t, *_CLINICO):
        return "clinical"
    if has(t, *_PII):
        return "pii"
    if has(t, *_AYUDA):
        return "help"
    palabras = t.split()
    corto = len(palabras) <= 4
    if corto and any(t == s or t.startswith(s + " ") for s in _SALUDOS):
        return "greeting"
    if corto and any(t == s or t.startswith(s) for s in _GRACIAS):
        return "thanks"
    if corto and any(t.startswith(s) for s in _DESPEDIDAS):
        return "bye"
    return None


# ── Tema ────────────────────────────────────────────────────────────────────

_FORECAST = (
    "predic", "pronost", "proyecc", "proyect", "anticip", "prever", "preve ", "futur", "proxim",
    "va a ", "van a ", "vamos a ", "se viene", "que esperar", "que podemos esperar", "manana",
)
_SERIE = ("tendencia", "evolucion", "comportamiento", "historico dia", "dia a dia")


def es_pronostico(t: str) -> bool:
    return has(t, *_FORECAST)


def es_serie(t: str) -> bool:
    return has(t, *_SERIE)


def detectar_tema(t: str) -> str | None:
    """Tema operativo de la pregunta (independiente de los permisos del usuario)."""
    if has(t, "alerta"):
        return "alerts"
    if has(t, "inventario", "stock", "existencia", "agotar", "agotad", "desabastec", "abastecimiento", "quiebre") or (
        has(t, "dias de", "riesgo", "critico", "criticos") and has(t, "medic", "insumo", "farmac")
    ):
        return "inventory"
    if has(t, "cirug", "quirurg", "quirofano", "operacion", "operaciones", "intervenciones quirurgicas"):
        return "surgeries"
    if has(t, "cama", "ocupac", "ocupad", "censo", "capacidad", "llen", "saturad", "colapsad", "congestion", "hacinamiento") or re.search(
        r"\b(cuantos|cuantas)\s+(pacientes|personas)\s+(hay|estan|tenemos|quedan)\b", t
    ):
        return "occupancy"
    # "se esperan 300 ingresos" es pronóstico, no tiempo de espera.
    sin_expectativa = re.sub(r"\b(se esperan?|que esperar|esperamos|esperaria[ns]?|es de esperar)\b", " ", t)
    if has(sin_expectativa, "espera", "esperar", "demora", "tardan", "tarda ") or (
        has(t, "tiempo") and has(t, "atencion", "atender", "atendido")
    ):
        return "wait"
    if has(t, "estancia", "permanencia", "permanecen", "duran hospitalizad", "dias de hospitalizacion"):
        return "stay"
    if has(t, "edad"):
        return "age"
    if has(t, "medicamento", "farmac", "dispens", "insumo", "consumo de"):
        return "medications"
    if has(t, "diagnost", "enfermedad", "patologia", "morbilidad", "motivo de ingreso", "causa de ingreso", "causas de ingreso", "casos de"):
        return "diagnosis"
    if has(t, "procedimiento", "laboratorio", "examen", "imagen", "rayos", "ecograf", "servicios prestados", "prestacion", "prestados"):
        return "services"
    if has(t, "triage", "triaje"):
        return "triage"
    if has(t, "ingres", "paciente", "admision", "admitid", "atendid", "atencion", "demanda", "llegad", "llegaron", "llego",
           "llegan", "afluencia", "volumen", "consultaron"):
        return "admissions"
    if has(t, "servicio", "unidad"):
        return "admissions"
    # "¿Cómo está urgencias?", "dame un resumen": la foto de ocupación es la respuesta operativa por defecto.
    if has(t, "resumen", "situacion", "panorama", "como vamos", "estado del hospital", "como esta el hospital") or any(
        re.search(r"(?<![a-z])" + re.escape(a) + r"(?![a-z])", t) for alias, _ in _ALIAS_UNIDAD for a in alias
    ):
        return "occupancy"
    return None


# ── Periodo ─────────────────────────────────────────────────────────────────


@dataclass
class Periodo:
    desde: datetime  # inclusivo, hora local
    hasta: datetime  # exclusivo, hora local
    etiqueta: str  # "la última semana"
    relativo_hoy: bool = False  # usa "hoy"/"esta semana"...: el narrador aclara la fecha de corte


def _dia(dt: datetime) -> datetime:
    return dt.replace(hour=0, minute=0, second=0, microsecond=0)


def _mes_siguiente(dt: datetime) -> datetime:
    return dt.replace(year=dt.year + 1, month=1) if dt.month == 12 else dt.replace(month=dt.month + 1)


def _periodo_mes(mes: int, anio: int, etiqueta: str) -> Periodo:
    desde = datetime(anio, mes, 1, tzinfo=TZ)
    return Periodo(desde, _mes_siguiente(desde), etiqueta)


def detectar_periodo(t: str, ref: datetime) -> Periodo | None:
    """Periodo relativo a `ref` (el "hoy" de los datos HIS, en hora local)."""
    hoy = _dia(ref)
    manana = hoy + timedelta(days=1)

    m = re.search(r"\bultim[oa]s?\s+(\d+|[a-z]+)\s+(dias?|semanas?|mes(?:es)?|horas?)\b", t)
    if m and _num(m.group(1)):
        n = int(_num(m.group(1)) or 0)
        unidad = m.group(2)
        if unidad.startswith("hora"):
            return Periodo(ref - timedelta(hours=n), ref + timedelta(seconds=1), f"las últimas {n} horas", True)
        dias = n * (7 if unidad.startswith("semana") else 30 if unidad.startswith("mes") else 1)
        return Periodo(manana - timedelta(days=dias), manana, f"los últimos {n} {unidad}", True)
    if has(t, "hoy", "en el dia de hoy", "actualmente", "ahora", "en este momento"):
        return Periodo(hoy, manana, "hoy", True)
    if has(t, "ayer"):
        return Periodo(hoy - timedelta(days=1), hoy, "ayer", True)
    if has(t, "semana pasada", "semana anterior"):
        lunes = hoy - timedelta(days=hoy.weekday())
        return Periodo(lunes - timedelta(days=7), lunes, "la semana pasada", True)
    if has(t, "esta semana", "semana actual", "en la semana"):
        lunes = hoy - timedelta(days=hoy.weekday())
        return Periodo(lunes, manana, "esta semana", True)
    if has(t, "ultima semana", "ultimos siete dias", "ultimos 7 dias"):
        return Periodo(manana - timedelta(days=7), manana, "la última semana", True)
    if has(t, "mes pasado", "mes anterior"):
        inicio = hoy.replace(day=1)
        previo = (inicio - timedelta(days=1)).replace(day=1)
        return Periodo(previo, inicio, "el mes pasado", True)
    if has(t, "este mes", "mes actual", "en el mes", "del mes", "en lo que va del mes"):
        return Periodo(hoy.replace(day=1), manana, "este mes", True)
    if has(t, "ultimo mes", "ultimos treinta dias"):
        return Periodo(manana - timedelta(days=30), manana, "el último mes", True)
    if has(t, "este ano", "ano actual", "en lo que va del ano"):
        return Periodo(hoy.replace(month=1, day=1), manana, "este año", True)

    m = re.search(r"\bdel?\s+(\d{1,2})\s+al\s+(\d{1,2})\s+de\s+(" + "|".join(MESES) + r")(?:\s+(?:de\s+)?(\d{4}))?", t)
    if m:
        mes = MESES.index(m.group(3)) + 1
        anio = int(m.group(4)) if m.group(4) else (ref.year if mes <= ref.month else ref.year - 1)
        try:
            desde = datetime(anio, mes, int(m.group(1)), tzinfo=TZ)
            hasta = datetime(anio, mes, int(m.group(2)), tzinfo=TZ) + timedelta(days=1)
        except ValueError:
            return None
        if hasta > desde:
            return Periodo(desde, hasta, f"del {m.group(1)} al {m.group(2)} de {m.group(3)} de {anio}")

    m = re.search(r"\b(" + "|".join(MESES) + r")(?:\s+(?:de\s+|del\s+)?(\d{4}))?\b", t)
    if m:
        mes = MESES.index(m.group(1)) + 1
        anio = int(m.group(2)) if m.group(2) else (ref.year if mes <= ref.month else ref.year - 1)
        return _periodo_mes(mes, anio, f"{m.group(1)} de {anio}")

    m = re.search(r"\b(?:en|durante|del|de)\s+(20\d{2})\b", t)
    if m:
        anio = int(m.group(1))
        return Periodo(datetime(anio, 1, 1, tzinfo=TZ), datetime(anio + 1, 1, 1, tzinfo=TZ), f"{anio}")
    return None


# ── Comparadores sobre medidas ("más de 2 horas", "menos de 5 días") ─────────


@dataclass
class Comparador:
    op: str  # gt | gte | lt | lte
    valor: float
    unidad: str | None  # minutos | horas | dias | anos | pct | None
    texto: str


_RE_COMP = re.compile(
    r"\b(mas|mayor(?:es)?|superior(?:es)?|por encima|arriba|menos|menor(?:es)?|inferior(?:es)?|por debajo)"
    r"\s+(?:de|a|al|que|del)\s+(?:la\s+|el\s+)?(\d+(?:[.,]\d+)?|[a-z]+)\s*"
    r"(horas?|hrs?|h|minutos?|mins?|dias?|semanas?|anos?|%|por ciento)?(?![a-z])"
)


def detectar_comparadores(t: str) -> list[Comparador]:
    out: list[Comparador] = []
    for m in _RE_COMP.finditer(t):
        valor = _num(m.group(2))
        if valor is None:
            continue
        palabra = m.group(1)
        mayor = palabra.startswith(("mas", "mayor", "superior", "por encima", "arriba"))
        # "mayores de 60 años" suele incluir los 60; "más de 2 horas" no incluye las 2.
        op = ("gte" if palabra.startswith("mayor") else "gt") if mayor else ("lte" if palabra.startswith("menor") else "lt")
        u = m.group(3) or ""
        unidad = (
            "minutos" if u.startswith("min")
            else "horas" if u.startswith(("hora", "hr")) or u == "h"
            else "dias" if u.startswith("dia")
            else "semanas" if u.startswith("semana")
            else "anos" if u.startswith("ano")
            else "pct" if u in {"%", "por ciento"}
            else None
        )
        out.append(Comparador(op, valor, unidad, m.group(0).strip()))
    return out


def sin_comparadores(t: str) -> str:
    """Texto sin los comparadores: "menos de 5 días" no debe leerse como ranking "los que menos"."""
    return _RE_COMP.sub(" ", t)


# ── Ranking ─────────────────────────────────────────────────────────────────


def detectar_ranking(t: str) -> tuple[str | None, int | None]:
    """('desc'|'asc'|None, N|None). Se aplica sobre el texto SIN comparadores."""
    top = None
    m = re.search(r"\b(?:top|primeros|primeras|principales)\s+(\d+|[a-z]+)\b", t) or re.search(
        r"\b(?:los|las)\s+(\d+|[a-z]+)\s+(?:primer|principal|mas|menos|mayor|menor|[a-z]+\s+(?:mas|menos|con))",
        t,
    )
    if m and _num(m.group(1)) and 1 <= (_num(m.group(1)) or 0) <= 50:
        top = int(_num(m.group(1)) or 0)
    if re.search(r"\b(menos|menor|menores|minimo|minima|peor)\b", t) and not has(t, "al menos", "por lo menos"):
        return "asc", top
    if re.search(r"\b(mas|mayor|mayores|maximo|maxima|top|principales|ranking|primeros|lider)\b", t):
        return "desc", top
    return (("desc", top) if top else (None, None))


# ── Agrupación ("por unidad", "por sexo", "diario"...) ───────────────────────

_AGRUPACIONES: tuple[tuple[tuple[str, ...], str], ...] = (
    (("por dia", "por dias", "diario", "diaria", "diarios", "diarias", "cada dia", "dia a dia", "por fecha"), "@day"),
    (("por semana", "semanal", "semanales", "cada semana"), "@week"),
    (("por mes", "por meses", "mensual", "mensuales", "cada mes", "mes a mes"), "@month"),
    (("por unidad", "por unidades", "por servicio", "por servicios", "cada unidad", "cada servicio", "entre unidades", "entre servicios", "por piso"), "unit"),
    (("por subunidad", "por subunidades"), "subunit"),
    (("por sexo", "por genero", "cada sexo", "hombres y mujeres", "mujeres y hombres"), "patient_sex"),
    (("por zona", "cada zona", "zona de residencia", "rural y urbana", "urbana y rural"), "patient_zone"),
    (("por regimen", "cada regimen", "por tipo de afiliacion", "por afiliacion", "por eps"), "patient_regime"),
    (("por via", "via de ingreso", "vias de ingreso"), "entry_route"),
    (("por clase", "clase de ingreso"), "admission_class"),
    (("por tipo de riesgo", "por riesgo"), "risk_type"),
    (("por triage", "por nivel", "por niveles", "cada nivel", "nivel de triage", "niveles de triage", "por clasificacion"), "triage_level"),
    (("por diagnostico", "por diagnosticos"), "diagnosis_name"),
    (("por especialidad", "por especialidades", "cada especialidad"), "specialty"),
    (("por area", "por areas", "cada area"), "area"),
    (("por medicamento", "por medicamentos", "por producto", "por insumo", "cada medicamento"), "name"),
    (("por procedimiento", "por procedimientos"), "procedure_name"),
    (("por tipo", "por tipos"), "@type"),
    (("por severidad", "por gravedad"), "severity"),
    (("por estado", "por estados"), "status"),
    (("ejecutadas", "realizadas vs", "programadas vs", "vs ejecutadas", "frente a ejecutadas"), "executed"),
)


def detectar_agrupaciones(t: str) -> list[str]:
    """Claves en orden de aparición: nombres de dimensión o '@day'/'@week'/'@month'/'@type'."""
    hallados: list[tuple[int, str]] = []
    for frases, clave in _AGRUPACIONES:
        for f in frases:
            m = re.search(r"(?<![a-z])" + re.escape(f) + r"(?![a-z])", t)
            if m:
                hallados.append((m.start(), clave))
                break
    return [c for _, c in sorted(hallados)]


# ── Nivel de triage ("triage 2", "nivel III") ────────────────────────────────


def detectar_triage(t: str) -> list[int]:
    niveles: list[int] = []
    for m in re.finditer(r"\b(?:triage|triaje|nivel|niveles|categoria)\s+((?:\d|i{1,3}|iv|v)(?:\s*(?:,|y|o)\s*(?:\d|i{1,3}|iv|v))*)\b", t):
        for token in re.findall(r"\d|iv|v|i{1,3}", m.group(1)):
            n = int(token) if token.isdigit() else _ROMANOS.get(token)
            if n and 1 <= n <= 5 and n not in niveles:
                niveles.append(n)
    return niveles


# ── Vocabulario: unidades y valores de dimensiones ──────────────────────────

# Alias de lenguaje natural -> fragmento que debe contener el valor REAL de la BD.
_ALIAS_UNIDAD: tuple[tuple[tuple[str, ...], str], ...] = (
    (("uci", "ucis", "cuidados intensivos", "cuidado intensivo", "terapia intensiva", "intensivo", "intensivos"), "intensivo"),
    (("cuidado intermedio", "cuidados intermedios", "intermedio", "intermedios", "ucin", "ucim"), "intermedio"),
    (("cuidado basico", "cuidados basicos", "basico", "basicos"), "basico"),
    (("urgencias", "urgencia", "emergencias", "emergencia", "sala de urgencias"), "urgencia"),
    (("pediatria", "pediatrica", "pediatrico", "ninos"), "pediatr"),
    (("hospitalizacion",), "hospitalizacion"),
    (("gineco", "ginecologia", "obstetricia", "ginecobstetricia", "maternidad"), "gineco"),
    (("partos", "sala de partos", "parto"), "parto"),
    (("recuperacion",), "recuperacion"),
)


def resolver_unidades(t: str, valores: list[str]) -> list[str]:
    """Valores REALES de `unit` mencionados en la pregunta (por alias o por nombre)."""
    if not valores:
        return []
    encontrados: list[str] = []
    nvals = [(v, norm(v)) for v in valores]
    for v, nv in nvals:
        if re.search(r"(?<![a-z])" + re.escape(nv) + r"(?![a-z])", t) and v not in encontrados:
            encontrados.append(v)
    for alias, fragmento in _ALIAS_UNIDAD:
        if any(re.search(r"(?<![a-z])" + re.escape(a) + r"(?![a-z])", t) for a in alias):
            for v, nv in nvals:
                if fragmento in nv and v not in encontrados:
                    encontrados.append(v)
    # "cuidado intensivo" no debe arrastrar "cuidado intermedio"/"básico": ya se resolvió por fragmento.
    return encontrados


# Alias -> valor canónico, por dimensión (solo se usan si el valor existe en el catálogo).
_ALIAS_VALOR: dict[str, dict[str, tuple[str, ...]]] = {
    "patient_sex": {
        "Femenino": ("mujer", "mujeres", "femenino", "femenina", "femeninas"),
        "Masculino": ("hombre", "hombres", "masculino", "masculinos", "varones"),
    },
    "patient_zone": {"Rural": ("rural", "rurales"), "Urbana": ("urbana", "urbanas", "urbano", "urbanos")},
    "patient_regime": {
        "Subsidiado": ("subsidiado", "subsidiados", "regimen subsidiado"),
        "Contributivo": ("contributivo", "contributivos", "regimen contributivo"),
        "Particular": ("particular", "particulares"),
    },
    "admission_class": {"Ambulatorio": ("ambulatorio", "ambulatorios"), "Hospitalario": ("hospitalario", "hospitalarios")},
    "entry_route": {"Remitido": ("remitido", "remitidos", "remision", "remisiones")},
    "severity": {
        "CRITICAL": ("critica", "criticas", "critico", "criticos", "grave", "graves"),
        "WARNING": ("advertencia", "advertencias", "moderada", "moderadas", "aviso", "avisos"),
    },
    "status": {
        "OPEN": ("abierta", "abiertas", "pendiente", "pendientes", "sin atender", "activa", "activas", "vigente", "vigentes"),
        "ACKNOWLEDGED": ("reconocida", "reconocidas", "en gestion", "activa", "activas", "vigente", "vigentes"),
        "RESOLVED": ("resuelta", "resueltas", "cerrada", "cerradas"),
    },
    "type": {
        "LOW_STOCK": ("stock", "inventario", "desabastecimiento", "medicamento", "medicamentos"),
        "HIGH_OCCUPANCY": ("ocupacion", "camas", "cama"),
        "LONG_WAIT": ("espera", "esperas"),
        "DEMAND_SPIKE": ("demanda", "pico", "picos"),
        "SURGERY_CANCELLATIONS": ("cancelacion", "cancelaciones", "cirugia", "cirugias"),
    },
    "executed": {
        "no": ("cancelada", "canceladas", "cancelaron", "cancelo", "cancelacion", "cancelaciones", "no realizada", "no realizadas", "no ejecutada",
               "no ejecutadas", "suspendida", "suspendidas", "no se realizaron", "no se hicieron"),
        "si": ("realizada", "realizadas", "ejecutada", "ejecutadas", "efectuada", "efectuadas", "se realizaron", "se hicieron"),
    },
    "risk": {
        "CRITICAL": ("critico", "criticos", "critica", "criticas", "bajo stock", "stock bajo", "por agotarse", "a punto de agotarse"),
        "LOW": ("riesgo bajo", "bajo stock", "stock bajo", "por agotarse", "a punto de agotarse"),
    },
    "kind": {"insumo": ("insumo", "insumos")},
}

# Dimensiones donde solo cabe un valor (el primero que casa; los negativos van primero).
_EXCLUYENTES = {"executed"}

# Palabras que son TEMA, no valor de filtro ("consumo de medicamentos en farmacia" no filtra por área).
_NO_VALOR = {
    "farmacia", "urgencias", "cirugia", "hospitalizacion", "medicamentos", "medicamento", "insumos", "laboratorio",
    "procedimientos", "procedimiento", "servicios", "servicio", "consulta", "quirofanos", "estancia", "pediatria general",
}


def resolver_valores(t: str, dim: str, valores: list[str]) -> list[str]:
    """Valores REALES de una dimensión mencionados en la pregunta (alias o nombre/segmento)."""
    if not valores:
        return []
    out: list[str] = []
    for canon, alias in _ALIAS_VALOR.get(dim, {}).items():
        if canon in valores and any(re.search(r"(?<![a-z])" + re.escape(a) + r"(?![a-z])", t) for a in alias):
            out.append(canon)
            if dim in _EXCLUYENTES:
                break  # "no se realizaron" no debe casar también "se realizaron"
    if dim in _ALIAS_VALOR and dim not in {"patient_regime", "entry_route"}:
        return out
    for v in valores:
        nv = norm(v)
        segmentos = [nv] + [s.strip() for s in re.split(r"\s+-\s+|-", nv) if s.strip()]
        for s in segmentos:
            if len(s) < 5 or s in _NO_VALOR or s.startswith(("apoyo ", "consulta externa")):
                continue
            if re.search(r"(?<![a-z])" + re.escape(s) + r"(?![a-z])", t):
                if v not in out:
                    out.append(v)
                break
    return out


# ── Nombre libre (medicamento, diagnóstico, procedimiento) ─────────────────

_STOP = set(
    """a al algo algun alguna algunas algunos ante antes aqui asi aun bajo bien cada como con contra cual cuales
    cualquier cuando cuanta cuantas cuanto cuantos de del desde donde dos durante e el ella ellas ellos en entre era
    es esa esas ese eso esos esta estaba estado estan estar estas este esto estos fue fueron ha han hasta hay hubo
    la las le les lo los mas me mi mis mucho muy nada ni no nos o otra otras otro otros para pero poco por porque
    que quien se sea segun ser si sido sin sobre solo son su sus tambien tan tanto te tiene tienen todo todos tu
    un una unas uno unos y ya menos dame dime muestrame mostrar muestra quiero quisiera necesito saber conocer indica
    indicame decir favor puedes podrias hola buenas gracias total totales cantidad numero cifra dato datos valor
    registro registros hospital clinica sistema actual actualmente general promedio media mediana frecuente
    frecuentes comun comunes principal principales primer primeros primeras top ranking lista listado vs versus
    frente comparar comparacion comparado respecto tipo tipos cual nivel niveles fin inicio mitad dosis unidades
    tabletas cajas ampollas veces caso casos esta estan estaba estaban estuvo estuvieron estara ser sera seran fue
    fueron habia habra tiene tienen tenemos tuvo tuvieron viene vienen va van vamos ve ven via puede pueden podria
    quiero quieres dice digo usa usan usaron sirve necesita necesitan requiere requieren llego llegaron llegan entra
    entraron entran sale salen salieron suma sumar cuenta cuentan gasta gastan gastaron gasto toda todas vez donde
    cuando quien dia dias diario diaria diarios diarias mes meses ano anos hora horas tasa tasas indice indices
    ratio razon nivel tan tanto cuan que tal distintos distintas diferentes residencia vive viven""".split()
)
# Raíces de vocabulario del dominio y de los detectores (prefijos): nunca son un nombre libre.
_CONOCIDAS = (
    "ingres", "paciente", "admision", "admitid", "atend", "atencion", "demanda", "llegad", "afluencia", "volumen",
    "servicio", "unidad", "cama", "ocupa", "censo", "capacidad", "disponib", "espera", "esperar", "demor", "tard",
    "tiempo", "minuto", "semana", "hoy", "ayer", "manana", "ultim", "pasad", "anterior",
    "proxim", "estancia", "permanen", "hospitaliz", "edad", "medic", "farmac", "dispens", "insumo", "consum",
    "product", "inventario", "stock", "existencia", "agot", "abastec", "desabastec", "quiebre", "riesgo", "critic",
    "diagnost", "enfermedad", "patolog", "morbilidad", "motivo", "causa", "procedimiento", "laboratorio", "examen",
    "imagen", "rayos", "ecograf", "prestad", "prestacion", "prest", "cirug", "quirurg", "quirofano", "operacion",
    "program", "ejecut", "realiz", "cancel", "suspend", "efectu", "alerta", "activa", "abierta", "cerrada",
    "resuelta", "pendiente", "reconocid", "severidad", "gravedad", "triage", "triaje", "clasific", "urgencia",
    "emergencia", "pediatr", "ninos", "uci", "intensiv", "intermedi", "basic", "gineco", "obstetric", "materni",
    "parto", "recuperacion", "sexo", "genero", "mujer", "hombre", "femenin", "masculin", "varon", "zona", "rural",
    "urban", "regimen", "subsidiad", "contributiv", "particular", "remitid", "remision", "clase",
    "ambulatori", "hospitalari", "especialidad", "area", "predic", "pronost", "proyecc", "proyect", "anticip",
    "prever", "futur", "tendencia", "evolucion", "comportamiento", "historic", "diari", "semanal", "mensual",
    "porcentaje", "proporcion", "distribucion", "mayor", "menor", "maxim", "minim", "superior", "inferior",
    "encima", "debajo", "arriba", "peor", "mejor", "alto", "alta", "bajo", "baja", "cuant", "numero", "mostr",
    "ocurr", "registr", "egres", "atiend", "esper", "necesit", "requir", "utiliz", "saber", "concentr", "acumul",
    "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre",
    "diciembre", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo", "fecha", "periodo",
    "actual", "ahora", "momento", "reciente", "vs", "virtual", "fisic", "libre", "nivel", "subunidad", "piso",
    "sala", "cuidad", "terapia", "hospitalari", "salud", "valencia", "susana", "lopez", "llen", "saturad",
    "colapsad", "congestion", "hacinamiento", "resumen", "situacion", "panorama", "vamos", "compar",
)


def termino_nombre(t: str) -> str | None:
    """Nombre libre que el usuario menciona ("acetaminofen", "infeccion de vias urinarias")."""
    tokens = t.split()
    corridas: list[list[str]] = []
    actual: list[str] = []
    for i, tok in enumerate(tokens):
        conocido = tok in _STOP or any(tok.startswith(c) for c in _CONOCIDAS) or any(ch.isdigit() for ch in tok)
        conector = tok in {"de", "del", "y"} and actual and i + 1 < len(tokens)
        if not conocido and len(tok) >= 4:
            actual.append(tok)
        elif conector and actual:
            actual.append(tok)
        else:
            if actual:
                corridas.append(actual)
            actual = []
    if actual:
        corridas.append(actual)
    limpias = []
    for c in corridas:
        while c and c[-1] in {"de", "del", "y"}:
            c = c[:-1]
        if c:
            limpias.append(" ".join(c))
    return max(limpias, key=len) if limpias else None


# ── Resultado ───────────────────────────────────────────────────────────────


@dataclass
class Interpretacion:
    texto: str  # pregunta normalizada
    tema: str | None
    pronostico: bool = False
    serie: bool = False
    periodo: Periodo | None = None
    comparadores: list[Comparador] = field(default_factory=list)
    ranking: str | None = None
    top: int | None = None
    agrupaciones: list[str] = field(default_factory=list)
    triage: list[int] = field(default_factory=list)


def interpretar(pregunta: str, ref: datetime) -> Interpretacion:
    t = norm(pregunta)
    limpio = sin_comparadores(t)
    ranking, top = detectar_ranking(limpio)
    return Interpretacion(
        texto=t,
        tema=detectar_tema(t),
        pronostico=es_pronostico(t),
        serie=es_serie(t),
        periodo=None if es_pronostico(t) else detectar_periodo(t, ref),
        comparadores=detectar_comparadores(t),
        ranking=ranking,
        top=top,
        agrupaciones=detectar_agrupaciones(t),
        triage=detectar_triage(t),
    )
