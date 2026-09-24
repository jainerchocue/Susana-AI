"""Result interpretation — never invent numbers."""

from __future__ import annotations
from app.agent.recommender import Recommender
import json
from typing import Any

from app.analytics.statistics import summarize_numeric_column
from app.llm.client import LLMClient, get_llm_client
from app.llm.prompts import PromptLoader, get_prompt_loader
from app.llm.schemas import InterpretationResult


class ResultInterpreter:
    def __init__(
        self,
        llm: LLMClient | None = None,
        prompts: PromptLoader | None = None,
    ) -> None:
        self.llm = llm or get_llm_client()
        self.prompts = prompts or get_prompt_loader()

    def interpret_deterministic(
        self,
        question: str,
        intent: str,
        rows: list[dict[str, Any]],
        columns: list[str],
    ) -> InterpretationResult:
        if not rows:
            return InterpretationResult(
                answer=(
                    "Los datos disponibles no permiten calcular este indicador "
                    "con la consulta ejecutada (resultado vacío)."
                ),
                insights=["Sin filas en el resultado"],
                recommendations=[],
                confidence="LOW",
            )
       

        preview = rows[:10]
        insights: list[str] = [f"Se obtuvieron {len(rows)} fila(s) de resultado."]
        recommendations = Recommender().recommend(intent, rows, columns)

        # Numeric summaries when possible
        for col in columns:
            sample = rows[0].get(col) if rows else None
            if isinstance(sample, (int, float)):
                summary = summarize_numeric_column(rows, col)
                if summary.get("count"):
                    insights.append(
                        f"{col}: min={summary['min']}, max={summary['max']}, "
                        f"promedio={summary['mean']:.2f}, tendencia={summary['trend']}"
                    )

        # Intent-specific phrasing using exact values from first rows
        if intent == "OCCUPANCY" and rows:
            first = rows[0]
            # Prefer explicit count columns
            count_val = None
            for key, val in first.items():
                if "count" in key.lower() or key.lower() in {"total", "ocupadas", "camas"}:
                    count_val = val
                    break
            if count_val is None and len(first) == 1:
                count_val = next(iter(first.values()))
            if count_val is not None:
                answer = f"Según los datos, el indicador de ocupación solicitado es {count_val}."
            else:
                answer = (
                    f"Se identificaron {len(rows)} registro(s) relacionados con ocupación. "
                    f"Primer registro: {preview[0]}."
                )
        elif intent in {"MEDICATION_STOCK", "MEDICATION_CONSUMPTION"} and rows:
            names = []
            for r in preview:
                name = r.get("NombreServicio") or r.get("medicamento") or r.get("nombre")
                if name:
                    names.append(str(name))
            listed = ", ".join(names[:5]) if names else "ver data"
            answer = (
                f"Se identificaron {len(rows)} medicamento(s)/insumo(s) que cumplen el criterio. "
                f"Ejemplos: {listed}."
            )
        elif intent == "WAIT_TIME" and rows:
            first = rows[0]
            val = next(iter(first.values()), None)
            answer = f"El tiempo promedio de espera calculado a partir de los datos es {val}."
        elif intent == "DEMAND" and rows:
            top = rows[0]
            servicio = (
                top.get("AreaServicio")
                or top.get("ViaIngreso")
                or top.get("NombreServicio")
                or next(iter(top.values()), "?")
            )
            total = top.get("total") or top.get("cantidad") or top.get("conteo")
            if total is not None:
                answer = f"El servicio/área con mayor demanda en el periodo es {servicio} con {total} registros."
            else:
                answer = f"El servicio/área con mayor demanda en el periodo es {servicio}."
        else:
            answer = (
                f"Se obtuvieron {len(rows)} fila(s). "
                f"Vista parcial de datos: {json.dumps(preview[:3], ensure_ascii=False, default=str)}."
            )

        viz: dict[str, Any] = {}
        if len(columns) >= 2 and len(rows) > 1:
            viz = {
                "type": "bar",
                "x": columns[0],
                "y": columns[1] if len(columns) > 1 else columns[0],
                "title": question[:80],
            }

        confidence = "HIGH" if len(rows) > 0 and intent != "UNKNOWN" else "MEDIUM"
        return InterpretationResult(
            answer=answer,
            insights=insights,
            recommendations=recommendations,
            visualization=viz,
            confidence=confidence,
        )

    async def interpret(
        self,
        question: str,
        intent: str,
        rows: list[dict[str, Any]],
        columns: list[str],
        metadata: dict[str, Any] | None = None,
    ) -> InterpretationResult:
        base = self.interpret_deterministic(question, intent, rows, columns)
        if not self.llm.is_available or not rows:
            return base

        try:
            system = self.prompts.load("system")
            user = self.prompts.render(
                "interpretation",
                question=question,
                intent=intent,
                columns=json.dumps(columns, ensure_ascii=False),
                rows=json.dumps(rows[:50], ensure_ascii=False, default=str),
                metadata=json.dumps(metadata or {}, ensure_ascii=False, default=str),
            )
            data, _ = await self.llm.chat_json(
                [{"role": "system", "content": system}, {"role": "user", "content": user}]
            )
            result = InterpretationResult.model_validate(data)
            # Guardrail: if LLM answer empty, keep deterministic
            if not result.answer:
                return base
            # Si el modelo no trae recomendaciones, conservar las de Recommender
            if not result.recommendations:
                result.recommendations = base.recommendations
            return result
        except Exception:  # noqa: BLE001
            return base
