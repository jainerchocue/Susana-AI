"""FastAPI app — Hospital Intelligence Agent (servicio Python para Node)."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.api import api_router
from app.api.routes import gateway
from app.config.settings import settings

STATIC_DIR = Path(__file__).resolve().parents[1] / "static"
AGENT_ROOT = Path(__file__).resolve().parents[1]

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("agent")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "Starting %s v%s (env=%s, llm=%s, node=%s)",
        settings.app_name,
        __version__,
        settings.app_env,
        settings.llm_model,
        settings.node_internal_url,
    )
    yield
    logger.info("Shutting down agent service")


app = FastAPI(
    title=settings.app_name,
    version=__version__,
    lifespan=lifespan,
    docs_url="/docs" if settings.app_env != "production" else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.app_env == "development" else [],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Contrato oficial con Node (Susana-AI)
app.include_router(gateway.router)

# Rutas legacy / demo local
app.include_router(api_router)

if STATIC_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.middleware("http")
async def reject_oversized_body(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > 1_000_000:
        return JSONResponse(status_code=413, content={"detail": "Payload demasiado grande"})
    return await call_next(request)


@app.get("/")
async def root():
    return {
        "service": settings.app_name,
        "version": __version__,
        "contract": {
            "health": "GET /health",
            "ask": "POST /v1/ask",
        },
        "demo_flujo": "/flujo",
        "legacy": [
            "GET /internal/agent/health",
            "POST /internal/agent/analyze",
            "POST /internal/agent/interpret",
        ],
    }


@app.get("/flujo")
async def flujo_demo():
    """UI HTML local (demo). El producto real entra por React → Node → este agente."""
    path = STATIC_DIR / "flujo.html"
    if not path.exists():
        return JSONResponse(status_code=404, content={"detail": "flujo.html no encontrado"})
    return FileResponse(path)


@app.get("/guia")
async def guia_codigo():
    path = AGENT_ROOT / "GUIA_CODIGO.md"
    if not path.exists():
        return JSONResponse(status_code=404, content={"detail": "GUIA_CODIGO.md no encontrado"})
    return FileResponse(path, media_type="text/markdown; charset=utf-8")
