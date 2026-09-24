
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
            name = row.get("NombreServicio") or row.get("medicamento")
            if name:
                tips_list.append(
                    f"Revisar el abastecimiento de {name} según el consumo observado."
                )
        return tips_list

    def _for_occupancy(self, rows: list[dict[str, Any]]) -> list[str]:
        """Faltaba este método: recommend() lo llama en UCI y sin él el servicio fallaba."""
        first = rows[0]
        occupied = first.get("camas_ocupadas")
        if occupied is None:
            return ["Revisar la disponibilidad de camas y UCI con el dato de ocupación obtenido."]
        return [
            f"Revisar disponibilidad de camas UCI: se observan {occupied} cama(s) ocupadas en la fecha consultada."
        ]

    def _for_wait_time(self, rows: list[dict[str, Any]]) -> list[str]:
        first = rows[0]
        hours = first.get("horas_espera_promedio")
        if hours is None:
            return []
        return [
            f"Revisar tiempos de triage y turnos en urgencias: el promedio observado es {hours} horas."
        ]

    def _for_demand(self, rows: list[dict[str, Any]]) -> list[str]:
        top = rows[0]
        service = top.get("ViaIngreso") or top.get("AreaServicio") or top.get("NombreServicio")
        total = top.get("total")
        if not service:
            return []
        if total is not None:
            return [
                f"Considerar reforzar la capacidad en {service}: concentra {total} ingresos en el periodo."
            ]
        return [f"Considerar reforzar la capacidad en {service}, el de mayor demanda observada."]
