from fastapi import APIRouter

from app.api.routes import analyze, health, interpret

# Rutas internas opcionales (debug). El contrato productivo es /health y /v1/ask.
api_router = APIRouter(prefix="/internal/agent")
api_router.include_router(health.router, tags=["health"])
api_router.include_router(analyze.router, tags=["analyze"])
api_router.include_router(interpret.router, tags=["interpret"])
