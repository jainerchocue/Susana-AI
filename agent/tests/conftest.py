import os
import sys
from pathlib import Path
import pytest 
from fastapi.testclient import TestClient

# Env BEFORE any app imports
os.environ["INTERNAL_API_KEY"] = "test-key"
os.environ["LLM_ENABLED"] = "false"
os.environ["OPENROUTER_API_KEY"] = ""

AGENT_ROOT = Path(__file__).resolve().parents[1]
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))


@pytest.fixture
def api_headers() -> dict[str, str]:
    return {"X-API-Key": "test-key"}


@pytest.fixture
def client():
    from app.main import app

    with TestClient(app) as c:
        yield c
