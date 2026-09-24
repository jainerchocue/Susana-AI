"""LLM (OpenRouter) con correa corta: nunca es fuente de datos.

Dos usos, ambos opcionales y con respaldo determinista:
1. `planificar_con_llm`: solo si el parser no reconoce la pregunta. Propone UNA
   consulta DSL que se valida localmente (`dsl.validar`) antes de ir a Node.
2. `pulir`: reescribe la respuesta ya verificada en tono natural. Se descarta
   si añade cifras, pierde alguna, o introduce causas/recomendaciones que el
   texto verificado no tenía.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from datetime import datetime
from typing import Any

from app.bridge.dsl import Catalogo, validar
from app.bridge.nlu import norm
from app.config.settings import settings
from app.llm.client import get_llm_client

logger = logging.getLogger(__name__)


class Deadline:
    """Presupuesto total de la petición (Node corta a los AGENT_TIMEOUT_MS)."""

    def __init__(self, segundos: float):
        self._fin = time.monotonic() + segundos

    def restante(self) -> float:
        return max(0.0, self._fin - time.monotonic())


async def _chat(
    messages: list[dict[str, str]], *, deadline: Deadline, max_tokens: int, json_mode: bool = False, tope: float | None = None
) -> str | None:
    client = get_llm_client()
    # Reserva 1,5 s para Node y la respuesta: sin margen, mejor no llamar.
    presupuesto = min(tope or settings.llm_timeout_seconds, settings.llm_timeout_seconds, deadline.restante() - 1.5)
    if not client.is_available or presupuesto < 2.0:
        return None
    try:
        contenido, _ = await asyncio.wait_for(
            client.chat(messages, temperature=0.0, max_tokens=max_tokens, response_json=json_mode),
            timeout=presupuesto,
        )
    except asyncio.TimeoutError:
        logger.warning("LLM sin respuesta en %.1fs", presupuesto)
        return None
    except Exception as exc:  # noqa: BLE001 - el LLM nunca debe tumbar la respuesta
        logger.warning("LLM falló: %s", exc)
        return None
    return (contenido or "").strip() or None


# ── 1. Planificador de respaldo ─────────────────────────────────────────────

_DSL = """DSL (JSON estricto, sin campos extra):
{"dataset": str, "metrics": [{"agg": "count"} | {"agg": "count_distinct", "field": <dimension>} | {"agg": "sum"|"avg"|"min"|"max", "field": <medida>}] (1-5),
 "groupBy": [{"field": <dimension>, "grain"?: "day"|"week"|"month"|"year" (solo fechas)}] (0-3),
 "filters": [{"field": <dimension o medida>, "op": "eq"|"neq"|"gt"|"gte"|"lt"|"lte"|"in"|"between"|"contains", "value": ...}] (0-10),
 "orderBy": [{"ref": "metric:0".."metric:4" o una dimension del groupBy, "dir": "asc"|"desc"}] (0-3),
 "limit": 1-100}
Reglas: gt/gte/lt/lte/between no aplican a texto; contains solo a texto; fechas en ISO 8601 con -05:00;
"in" y "between" llevan array; para filtrar texto usa SOLO valores de la lista "valores" de esa dimensión."""


def _catalogo_para_prompt(cat: Catalogo) -> str:
    lineas = []
    for ds, info in cat.datasets.items():
        lineas.append(f"- {ds}: {info['description']}")
        for nombre, d in info["dims"].items():
            valores = d.get("values") or []
            extra = f" valores={json.dumps(valores[:30], ensure_ascii=False)}" if valores else ""
            lineas.append(f"    dimension {nombre} ({d.get('type', 'string')}): {d.get('description', '')}{extra}")
        for nombre, m in info["measures"].items():
            lineas.append(f"    medida {nombre}: {m.get('description', '')}")
    return "\n".join(lineas)


async def planificar_con_llm(
    pregunta: str, cat: Catalogo, *, ref: datetime, max_rows: int, deadline: Deadline
) -> dict[str, Any] | None:
    """Una consulta DSL válida para el catálogo, o None (no aplica / no válida / sin LLM)."""
    sistema = (
        "Traduces preguntas operativas de un hospital a UNA consulta del DSL indicado. "
        "Si la pregunta no se puede responder con el catálogo, o pide consejo clínico o datos personales, "
        'responde {"consulta": null}. Nunca inventes datasets, campos ni valores.\n\n'
        f"Fecha de corte de los datos (el 'hoy'): {ref.isoformat(timespec='minutes')} (America/Bogota).\n\n"
        f"{_DSL}\n\nCatálogo del usuario:\n{_catalogo_para_prompt(cat)}\n\n"
        'Responde SOLO JSON: {"consulta": <objeto DSL o null>}'
    )
    texto = await _chat(
        [{"role": "system", "content": sistema}, {"role": "user", "content": pregunta}],
        deadline=deadline,
        max_tokens=900,
        json_mode=True,
    )
    if not texto:
        return None
    inicio, fin = texto.find("{"), texto.rfind("}")
    try:
        datos = json.loads(texto[inicio : fin + 1]) if inicio >= 0 else None
    except json.JSONDecodeError:
        return None
    consulta = datos.get("consulta") if isinstance(datos, dict) else None
    if not isinstance(consulta, dict):
        return None
    consulta.setdefault("limit", min(50, max_rows))
    if isinstance(consulta.get("limit"), int):
        consulta["limit"] = max(1, min(consulta["limit"], max_rows, 100))
    errores = validar(consulta, cat, max_rows)
    if errores:
        logger.info("Consulta del LLM descartada: %s", errores[:3])
        return None
    # Valores de texto: solo los del vocabulario real (si la dimensión lo tiene).
    for f in consulta.get("filters") or []:
        valores = cat.values(consulta["dataset"], f["field"])
        propuestos = f["value"] if isinstance(f["value"], list) else [f["value"]]
        if valores and f["op"] in {"eq", "neq", "in"} and any(v not in valores for v in propuestos):
            logger.info("Consulta del LLM descartada: valor fuera del vocabulario en %s", f["field"])
            return None
    return consulta


# ── 2. Pulido con verificación ──────────────────────────────────────────────

_RE_NUM = re.compile(r"\d[\d.,]*\d|\d")
_NUEVAS_AFIRMACIONES = (
    "debido a", "porque", "se debe a", "causad", "a causa de", "recomiendo", "recomendamos", "sugiero",
    "sugerimos", "deberia", "deberian", "conviene", "es recomendable", "es necesario", "preocupante",
    "alarmante", "grave", "urgente", "dosis", "tratamiento", "prescrib",
)
_JERGA = ("sql", "dataset", "json", "dsl", "random forest", "algoritmo", "machine learning", "api ", "ticket", "query")


def _interpretaciones(token: str) -> set[float]:
    """'7.489' -> {7489, 7.489}; '61,5' -> {61.5}; '1,234' -> {1234, 1.234}."""
    out: set[float] = set()
    limpio = token.strip(".,")
    candidatos = {
        limpio.replace(".", "").replace(",", "."),  # es-CO: . miles, , decimal
        limpio.replace(",", ""),  # en: , miles, . decimal
        limpio.replace(",", "."),
    }
    for c in candidatos:
        try:
            out.add(round(float(c), 2))
        except ValueError:
            continue
    return out


def cifras(texto: str) -> list[set[float]]:
    # "7 489" (espacio de miles) se une antes de extraer.
    unido = re.sub(r"(?<=\d) (?=\d{3}\b)", "", texto)
    return [_interpretaciones(t) for t in _RE_NUM.findall(unido)]


def _todas(texto: str) -> set[float]:
    out: set[float] = set()
    for c in cifras(texto):
        out |= c
    return out


def respeta_hechos(original: str, pulido: str, pregunta: str) -> bool:
    """El pulido no añade cifras, no pierde ninguna, no inventa causas/consejos ni usa jerga."""
    permitidas = _todas(original) | _todas(pregunta)
    if any(not c & permitidas for c in cifras(pulido)):
        return False  # cifra nueva
    en_pulido = _todas(pulido)
    if any(not c & en_pulido for c in cifras(original)):
        return False  # se perdió una cifra
    n_orig, n_pul = norm(original), norm(pulido)
    if any(p in n_pul and p not in n_orig for p in _NUEVAS_AFIRMACIONES):
        return False
    if any(p in n_pul for p in _JERGA):
        return False
    return len(pulido) <= min(4000, int(len(original) * 1.6) + 200)


async def pulir(respuesta: str, pregunta: str, *, deadline: Deadline) -> str | None:
    if not settings.llm_polish:
        return None
    sistema = (
        "Eres Susana-AI, asistente de inteligencia operativa del Hospital Susana López de Valencia. "
        "Reescribe la respuesta verificada para que suene natural, clara y profesional, en español, "
        "en uno o dos párrafos cortos, sin viñetas ni markdown.\n"
        "REGLAS ESTRICTAS:\n"
        "1. Conserva EXACTAMENTE todas las cifras, fechas, porcentajes y nombres, con el mismo formato.\n"
        "2. No agregues cifras, cálculos, causas, interpretaciones, recomendaciones ni consejos clínicos.\n"
        "3. No omitas notas ni limitaciones del dato.\n"
        "4. No menciones consultas, bases de datos, SQL, modelos ni sistemas internos.\n"
        "Devuelve solo el texto final."
    )
    texto = await _chat(
        [
            {"role": "system", "content": sistema},
            {"role": "user", "content": f"Pregunta del usuario: {pregunta}\n\nRespuesta verificada:\n{respuesta}"},
        ],
        deadline=deadline,
        max_tokens=700,
        tope=settings.llm_polish_timeout_seconds,
    )
    if not texto:
        return None
    texto = re.sub(r"^```\w*\s*|\s*```$", "", texto).strip().strip('"')
    if respeta_hechos(respuesta, texto, pregunta):
        return texto
    logger.info("Pulido descartado: no respeta los hechos verificados")
    return None
