"""Query planning before NL2SQL."""

from __future__ import annotations

from app.config.settings import settings
from app.llm.client import LLMClient, get_llm_client
from app.llm.prompts import PromptLoader, get_prompt_loader
from app.llm.schemas import IntentResult, QueryPlan
from app.schema.loader import SchemaLoader, get_schema_loader


class QueryPlanner:
    def __init__(
        self,
        llm: LLMClient | None = None,
        prompts: PromptLoader | None = None,
        schema: SchemaLoader | None = None,
    ) -> None:
        self.llm = llm or get_llm_client()
        self.prompts = prompts or get_prompt_loader()
        self.schema = schema or get_schema_loader()

    def plan_deterministic(self, question: str, intent: IntentResult) -> QueryPlan:
        tables = self.schema.select_relevant_tables(intent.intent, intent.entities)
        filters: list[str] = []
        metrics: list[str] = []
        sort = None
        q = question.lower()

        if intent.intent == "OCCUPANCY":
            filters.append("NombreGrupoCama o NombreCama contiene UCI")
            filters.append("FechaIngreso = hoy (DATE('now')) o hospitalización activa")
            metrics.append("COUNT(DISTINCT CodigoCama) o COUNT(*)")
        elif intent.intent == "MEDICATION_STOCK":
            filters.append("consumo reciente; días inventario estimados < umbral (ej. 5)")
            metrics.append("SUM(Cantidad), consumo diario estimado, días inventario")
            sort = "días inventario ASC"
        elif intent.intent == "WAIT_TIME":
            filters.append("ViaIngreso = Urgencias; ventana temporal (última semana)")
            metrics.append("AVG(julianday(FechaAtencion) - julianday(FechaTriage/FechaIngreso)) * 24")
        elif intent.intent == "DEMAND":
            filters.append("ventana temporal (este mes)")
            metrics.append("COUNT(OidIngreso) GROUP BY AreaServicio o ViaIngreso")
            sort = "conteo DESC"
        elif intent.intent == "SURGERY":
            metrics.append("COUNT(DISTINCT ConsecutivoProgramacion)")
        elif intent.intent == "TRIAGE":
            metrics.append("COUNT(*) GROUP BY ClasificacionTriage")

        if "hoy" in q:
            filters.append("fecha = hoy")
        if "semana" in q:
            filters.append("últimos 7 días")
        if "mes" in q:
            filters.append("mes actual")

        return QueryPlan(
            intent=intent.intent,
            entities=intent.entities,
            filters=filters,
            metrics=metrics,
            sort=sort,
            limit=settings.default_sql_limit,
            tables=tables,
        )

    async def plan(self, question: str, intent: IntentResult) -> QueryPlan:
        base = self.plan_deterministic(question, intent)
        if not self.llm.is_available:
            return base

        # Optional LLM enrichment — keep deterministic plan as fallback
        try:
            system = self.prompts.load("system")
            user = (
                f"Crea un plan de consulta JSON para la pregunta.\n"
                f"Pregunta: {question}\n"
                f"Intent: {intent.intent}\n"
                f"Entidades: {intent.entities}\n"
                f"Tablas candidatas: {base.tables}\n"
                f"Devuelve JSON con: intent, entities, filters, metrics, sort, limit, tables, notes"
            )
            data, _ = await self.llm.chat_json(
                [{"role": "system", "content": system}, {"role": "user", "content": user}]
            )
            enriched = QueryPlan.model_validate({**base.model_dump(), **data})
            if not enriched.tables:
                enriched.tables = base.tables
            return enriched
        except Exception:  # noqa: BLE001
            return base
