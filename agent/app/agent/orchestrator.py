"""Main analyze / interpret orchestration. Agent proposes — never executes SQL."""

from __future__ import annotations

import logging
import time
from typing import Any

from app.agent.formatter import format_analyze_response, format_interpret_response
from app.agent.intent import IntentDetector
from app.agent.interpreter import ResultInterpreter
from app.agent.nl2sql import NL2SQLGenerator
from app.agent.planner import QueryPlanner
from app.config.settings import settings
from app.llm.client import LLMClient, get_llm_client
from app.models.request import AnalyzeRequest, InterpretRequest
from app.models.response import AnalyzeResponse, InterpretResponse
from app.security.query_analyzer import QueryAnalyzer

logger = logging.getLogger(__name__)


class AgentOrchestrator:
    def __init__(self) -> None:
        self.llm = get_llm_client()
        self.intent = IntentDetector(llm=self.llm)
        self.planner = QueryPlanner(llm=self.llm)
        self.nl2sql = NL2SQLGenerator(llm=self.llm)
        self.interpreter = ResultInterpreter(llm=self.llm)
        self.analyzer = QueryAnalyzer()

    async def analyze(self, request: AnalyzeRequest) -> AnalyzeResponse:
        started = time.perf_counter()
        conversation = [t.model_dump() for t in request.conversation]

        intent_result = await self.intent.detect(request.question, conversation)
        logger.info(
            "analyze intent=%s confidence=%s",
            intent_result.intent,
            intent_result.confidence,
        )

        if intent_result.out_of_domain or intent_result.intent == "OUT_OF_DOMAIN":
            return format_analyze_response(
                intent="OUT_OF_DOMAIN",
                nl2sql=None,
                plan=None,
                validation=None,
                rejected=True,
                rejection_reason=(
                    intent_result.reason
                    or "El asistente está diseñado para análisis operativo y administrativo "
                    "hospitalario y no proporciona recomendaciones clínicas."
                ),
                processing_ms=(time.perf_counter() - started) * 1000,
                model_used=self.llm.model if self.llm.is_available else None,
                confidence="HIGH",
            )

        plan = await self.planner.plan(request.question, intent_result)

        try:
            nl2sql_result, fallback_used = await self.nl2sql.generate(request.question, plan)
        except Exception as exc:  # noqa: BLE001
            logger.exception("nl2sql failed")
            return format_analyze_response(
                intent=intent_result.intent,
                nl2sql=None,
                plan=plan,
                validation=None,
                rejected=True,
                rejection_reason=f"No se pudo generar SQL: {exc}",
                processing_ms=(time.perf_counter() - started) * 1000,
                model_used=self.llm.model if self.llm.is_available else None,
                confidence="LOW",
            )

        validation = self.analyzer.validate(nl2sql_result.sql)
        if not validation.valid:
            return format_analyze_response(
                intent=intent_result.intent,
                nl2sql=nl2sql_result,
                plan=plan,
                validation=validation,
                rejected=True,
                rejection_reason="; ".join(validation.errors),
                fallback_used=fallback_used,
                processing_ms=(time.perf_counter() - started) * 1000,
                model_used=self.llm.model if self.llm.is_available else None,
                confidence="LOW",
            )

        return format_analyze_response(
            intent=intent_result.intent,
            nl2sql=nl2sql_result,
            plan=plan,
            validation=validation,
            fallback_used=fallback_used,
            processing_ms=(time.perf_counter() - started) * 1000,
            model_used=self.llm.model if self.llm.is_available else None,
            confidence=intent_result.confidence,
        )

    async def interpret(self, request: InterpretRequest) -> InterpretResponse:
        started = time.perf_counter()
        intent = request.intent or "UNKNOWN"
        interpretation = await self.interpreter.interpret(
            question=request.question,
            intent=intent,
            rows=request.rows,
            columns=request.columns,
            metadata=request.metadata,
        )
        return format_interpret_response(
            intent=intent,
            interpretation=interpretation,
            rows=request.rows,
            processing_ms=(time.perf_counter() - started) * 1000,
            model_used=self.llm.model if self.llm.is_available else None,
        )
