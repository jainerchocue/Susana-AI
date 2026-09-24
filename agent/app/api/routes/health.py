"""GET /internal/agent/health"""

from fastapi import APIRouter

from app import __version__
from app.config.settings import settings
from app.llm.client import get_llm_client
from app.models.response import HealthResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    llm = get_llm_client()
    return HealthResponse(
        status="ok",
        service=settings.app_name,
        version=__version__,
        llm_configured=llm.is_available,
        schema_version=settings.schema_version,
    )
