"""FastAPI app — Hospital Intelligence Agent (servicio Python para Node)."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import __version__
from app.api import api_router
from app.api.routes import gateway
from app.config.settings import settings

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

# CORS abierto: el agente lo llama Node (u orígenes de demo/hackathon).
# Con allow_origins=["*"] no se puede usar allow_credentials=True (el navegador lo rechaza).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Contrato oficial con Node (Susana-AI)
app.include_router(gateway.router)

# Rutas internas opcionales (analyze/interpret) — el producto usa /v1/ask
app.include_router(api_router)


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
    }
