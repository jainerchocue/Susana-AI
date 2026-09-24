"""POST /internal/agent/interpret — explain query results."""

from fastapi import APIRouter, Depends, Request

from app.agent.orchestrator import AgentOrchestrator
from app.api.dependencies import rate_limit, verify_api_key
from app.api.routes.analyze import get_orchestrator
from app.models.request import InterpretRequest
from app.models.response import InterpretResponse

router = APIRouter()


@router.post("/interpret", response_model=InterpretResponse)
async def interpret(
    body: InterpretRequest,
    request: Request,
    api_key: str = Depends(verify_api_key),
    orchestrator: AgentOrchestrator = Depends(get_orchestrator),
) -> InterpretResponse:
    rate_limit(request, api_key)
    return await orchestrator.interpret(body)
