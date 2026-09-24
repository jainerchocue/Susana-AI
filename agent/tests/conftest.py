"""Fixtures compartidas: el catálogo REAL que Node manda (exportado de hospital_local)."""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))
# Los tests nunca llaman al LLM real ni dependen del .env local.
os.environ["LLM_ENABLED"] = "false"
os.environ["AGENT_API_KEY"] = "clave-de-test"
os.environ["NODE_INTERNAL_API_KEY"] = "clave-interna-de-test"

from app.bridge.dsl import Catalogo  # noqa: E402
from app.bridge.nlu import TZ  # noqa: E402

_FIXTURE = json.loads((RAIZ / "tests" / "fixtures" / "catalogo.json").read_text(encoding="utf-8"))


@pytest.fixture
def catalogo_json() -> list[dict]:
    return json.loads(json.dumps(_FIXTURE["catalog"]))


@pytest.fixture
def cat(catalogo_json) -> Catalogo:
    return Catalogo(catalogo_json)


@pytest.fixture
def ref() -> datetime:
    """Fecha de corte real de los datos: 2026-09-21 14:33:44 hora Colombia."""
    return datetime.fromisoformat(_FIXTURE["referenceDate"].replace("Z", "+00:00")).astimezone(TZ)


@pytest.fixture
def ref_iso() -> str:
    return _FIXTURE["referenceDate"]
