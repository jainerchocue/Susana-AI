"""POST /internal/agent/analyze — propose SQL, never execute."""

from fastapi import APIRouter, Depends, Request

from app.agent.orchestrator import AgentOrchestrator
from app.api.dependencies import rate_limit, verify_api_key
from app.models.request import AnalyzeRequest
from app.models.response import AnalyzeResponse

router = APIRouter()
_orchestrator: AgentOrchestrator | None = None


def get_orchestrator() -> AgentOrchestrator:
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = AgentOrchestrator()
    return _orchestrator


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(
    body: AnalyzeRequest,
    request: Request,
    api_key: str = Depends(verify_api_key),
    orchestrator: AgentOrchestrator = Depends(get_orchestrator),
) -> AnalyzeResponse:
    rate_limit(request, api_key)
    return await orchestrator.analyze(body)
