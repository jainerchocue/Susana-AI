"""El LLM nunca es fuente de datos: su consulta se valida y su redacción se verifica cifra a cifra."""

from __future__ import annotations

import asyncio
import json

import pytest

from app.bridge import llm
from app.bridge.llm import Deadline, planificar_con_llm, pulir, respeta_hechos


class LLMFalso:
    def __init__(self, respuesta: str | Exception, demora: float = 0.0):
        self.respuesta = respuesta
        self.demora = demora
        self.llamadas: list[list[dict]] = []

    @property
    def is_available(self) -> bool:
        return True

    async def chat(self, messages, **_kwargs):
        self.llamadas.append(messages)
        await asyncio.sleep(self.demora)
        if isinstance(self.respuesta, Exception):
            raise self.respuesta
        return self.respuesta, {}


@pytest.fixture
def con_llm(monkeypatch):
    def instalar(respuesta: str | Exception, demora: float = 0.0) -> LLMFalso:
        falso = LLMFalso(respuesta, demora)
        monkeypatch.setattr(llm, "get_llm_client", lambda: falso)
        monkeypatch.setattr(llm.settings, "llm_polish", True)
        return falso

    return instalar


ORIGINAL = (
    "Con corte al 21 de septiembre de 2026 a las 14:33, Unidad de Cuidado Intensivo tiene 29 camas ocupadas de "
    "37 camas físicas (78,38 % de ocupación). Se registraron 7.489 ingresos."
)


@pytest.mark.parametrize(
    ("pulido", "valido"),
    [
        # Mismas cifras, otro formato de miles: válido.
        ("Al 21 de septiembre de 2026 (14:33), la UCI tiene 29 de sus 37 camas físicas ocupadas: 78,38 %. Hubo 7,489 ingresos.", True),
        ("Al 21 de septiembre de 2026 (14:33), la UCI tiene 29 de 37 camas (78,38 %). Hubo 7 489 ingresos.", True),
        # Cifra nueva (8 camas libres): inválido.
        ("Al 21 de septiembre de 2026 (14:33), la UCI tiene 29 de 37 camas (78,38 %), 8 libres. Hubo 7.489 ingresos.", False),
        # Cifra perdida (7.489): inválido.
        ("Al 21 de septiembre de 2026 (14:33), la UCI tiene 29 de 37 camas (78,38 %).", False),
        # Causa inventada: inválido.
        ("Al 21 de septiembre de 2026 (14:33), la UCI tiene 29 de 37 camas (78,38 %) debido a la temporada. Hubo 7.489 ingresos.", False),
        # Recomendación inventada: inválido.
        ("Al 21 de septiembre de 2026 (14:33), la UCI tiene 29 de 37 camas (78,38 %); conviene abrir camas. Hubo 7.489 ingresos.", False),
        # Jerga técnica: inválido.
        ("Según el dataset, al 21 de septiembre de 2026 (14:33) la UCI tiene 29 de 37 camas (78,38 %). Hubo 7.489 ingresos.", False),
    ],
)
def test_respeta_hechos(pulido: str, valido: bool) -> None:
    assert respeta_hechos(ORIGINAL, pulido, "¿Cuántas camas de UCI están ocupadas hoy?") is valido


def test_pulir_usa_el_texto_si_es_fiel(con_llm) -> None:
    fiel = "Al 21 de septiembre de 2026 (14:33), la UCI tiene 29 de sus 37 camas ocupadas (78,38 %). Hubo 7.489 ingresos."
    con_llm(fiel)
    assert asyncio.run(pulir(ORIGINAL, "uci", deadline=Deadline(10))) == fiel


def test_pulir_descarta_si_inventa(con_llm) -> None:
    con_llm("La UCI tiene 30 de 37 camas ocupadas (81 %).")
    assert asyncio.run(pulir(ORIGINAL, "uci", deadline=Deadline(10))) is None


def test_pulir_respeta_el_presupuesto(con_llm, monkeypatch) -> None:
    falso = con_llm("no importa", demora=0.0)
    assert asyncio.run(pulir(ORIGINAL, "uci", deadline=Deadline(2.5))) is None  # < 1,5 s de margen + 2 s mínimo
    assert falso.llamadas == []


def test_pulir_tolera_fallo_del_llm(con_llm) -> None:
    con_llm(RuntimeError("503 del proveedor"))
    assert asyncio.run(pulir(ORIGINAL, "uci", deadline=Deadline(10))) is None


def test_planificador_llm_acepta_consulta_valida(con_llm, cat, ref) -> None:
    consulta = {
        "dataset": "admissions",
        "metrics": [{"agg": "count"}],
        "groupBy": [{"field": "patient_zone"}],
        "filters": [{"field": "unit", "op": "eq", "value": "URGENCIAS"}],
        "limit": 10,
    }
    falso = con_llm(json.dumps({"consulta": consulta}))
    assert asyncio.run(planificar_con_llm("x", cat, ref=ref, max_rows=200, deadline=Deadline(10))) == consulta
    # El prompt lleva el vocabulario real y la fecha de corte.
    prompt = falso.llamadas[0][0]["content"]
    assert "UNIDAD DE CUIDADO INTENSIVO" in prompt and "2026-09-21T14:33" in prompt


@pytest.mark.parametrize(
    "respuesta",
    [
        json.dumps({"consulta": {"dataset": "pacientes_secretos", "metrics": [{"agg": "count"}]}}),  # dataset inexistente
        json.dumps({"consulta": {"dataset": "admissions", "metrics": [{"agg": "sum", "field": "unit"}]}}),  # sum sobre dimensión
        json.dumps({"consulta": {"dataset": "admissions", "metrics": [{"agg": "count"}], "filters": [{"field": "unit", "op": "eq", "value": "UCI"}]}}),  # valor inventado
        json.dumps({"consulta": {"dataset": "admissions", "metrics": [{"agg": "count"}], "sql": "DROP TABLE"}}),  # campo extra
        json.dumps({"consulta": None}),
        "esto no es json",
    ],
)
def test_planificador_llm_descarta_lo_invalido(con_llm, cat, ref, respuesta: str) -> None:
    con_llm(respuesta)
    assert asyncio.run(planificar_con_llm("x", cat, ref=ref, max_rows=200, deadline=Deadline(10))) is None


def test_planificador_llm_ajusta_limite(con_llm, cat, ref) -> None:
    con_llm(json.dumps({"consulta": {"dataset": "admissions", "metrics": [{"agg": "count"}], "limit": 5000}}))
    consulta = asyncio.run(planificar_con_llm("x", cat, ref=ref, max_rows=200, deadline=Deadline(10)))
    assert consulta is not None and consulta["limit"] == 100
