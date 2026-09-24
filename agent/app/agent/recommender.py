
from __future__ import annotations

from typing import Any


class Recommender:
    """Genera recomendaciones a partir del intent + filas de resultado."""

    def recommend(
        self,
        intent: str,
        rows: list[dict[str, Any]],
        columns: list[str] | None = None,
    ) -> list[str]:
        """
        Devuelve 1–3 strings de recomendación operativa.

        Esta función YA enruta según intent.
        TÚ implementas los métodos _for_* de abajo.
        """
        if not rows:
            return []

        out: list[str] = []

        if intent in {"MEDICATION_STOCK", "MEDICATION_CONSUMPTION"}:
            out.extend(self._for_medications(rows))
        elif intent == "OCCUPANCY":
            out.extend(self._for_occupancy(rows))
        elif intent == "WAIT_TIME":
            out.extend(self._for_wait_time(rows))
        elif intent == "DEMAND":
            out.extend(self._for_demand(rows))

        return [r for r in out if r][:3]

    # -------------------------------------------------------------------------
    # PASO A — EMPIEZA AQUÍ (borra el raise y escribe tu código)
    # -------------------------------------------------------------------------
    def _for_medications(self, rows: list[dict[str, Any]]) -> list[str]:
        """Tu lógica: una frase por medicamento, máximo 3 (el corte lo hace recommend)."""
        tips_list = []
        for row in rows:
            name = (
                row.get("NombreServicio")
                or row.get("medicamento")
                or row.get("code")
                or row.get("name")
            )
            qty = row.get("sum_quantity") or row.get("quantity") or row.get("total")
            if name and qty is not None:
                tips_list.append(
                    f"Decisión sugerida: revisar abastecimiento de {name} "
                    f"(consumo/cantidad observada {qty})."
                )
            elif name:
                tips_list.append(
                    f"Decisión sugerida: revisar el abastecimiento de {name} según el consumo observado."
                )
        return tips_list

    def _for_occupancy(self, rows: list[dict[str, Any]]) -> list[str]:
        """Recomendación orientada a decisión (capacidad / UCI)."""
        first = rows[0]
        occupied = first.get("camas_ocupadas")
        if occupied is None:
            return [
                "Priorice revisar camas y UCI en las unidades con mayor conteo; "
                "si la anticipación marca tendencia creciente, active contingencia de camas."
            ]
        return [
            f"Decisión sugerida: revisar disponibilidad UCI — se observan {occupied} cama(s) ocupadas; "
            "cubra turnos y posibles traslados antes del pico."
        ]

    def _for_wait_time(self, rows: list[dict[str, Any]]) -> list[str]:
        first = rows[0]
        hours = first.get("horas_espera_promedio")
        wait = first.get("avg_wait_minutes")
        if hours is not None:
            return [
                f"Decisión sugerida: reforzar triage/turnos en urgencias "
                f"(promedio observado ~{hours} h); anticipe demora si la serie sigue al alza."
            ]
        if wait is not None:
            return [
                f"Decisión sugerida: ajustar flujo de urgencias "
                f"(espera media ~{wait} min); prepare refuerzo si la tendencia es creciente."
            ]
        return [
            "Decisión sugerida: revisar tiempos de triage por nivel y cubrir el nivel con mayor demora."
        ]

    def _for_demand(self, rows: list[dict[str, Any]]) -> list[str]:
        top = rows[0]
        service = top.get("ViaIngreso") or top.get("AreaServicio") or top.get("NombreServicio") or top.get("unit")
        total = top.get("total") or top.get("count_all")
        if not service:
            return [
                "Decisión sugerida: identifique el servicio con más ingresos y refuerce capacidad allí primero."
            ]
        if total is not None:
            return [
                f"Decisión sugerida: reforzar capacidad en {service} "
                f"(concentra {total} en el periodo) y prepare el día pico que indique la anticipación."
            ]
        return [
            f"Decisión sugerida: reforzar capacidad en {service}, el de mayor demanda observada."
        ]