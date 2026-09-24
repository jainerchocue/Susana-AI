"""
Predicción / alertas tempranas (innovación del PDF).

NO es machine learning complejo: usa tendencias y promedios explicables
(ver app/analytics/statistics.py: moving_average, simple_trend).

ESTE ARCHIVO = TAREA 2 (mañana). No lo implementes esta noche.
"""

from __future__ import annotations

from typing import Any


class Predictor:
    """Anticipa demanda u ocupación a partir de series simples."""

    def forecast_message(
        self,
        series: list[float],
        *,
        label: str = "ingresos",
        context: dict[str, Any] | None = None,
    ) -> str:
        """
        TODO(tú - mañana):
        - Si la tendencia es creciente, di que podría aumentar.
        - Si tienes conteos por día de la semana (context), menciona el día pico
          (ej. sábado).
        - Nunca inventes el % si no lo calculas; si calculas un %, muéstralo con el método.
        """
        raise NotImplementedError("Tarea 2: implementar predicción simple")
