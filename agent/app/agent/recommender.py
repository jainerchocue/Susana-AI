"""Recomendaciones operativas en prosa natural (sin prefijos robóticos)."""

from __future__ import annotations

from typing import Any


class Recommender:
    """Genera 1–3 recomendaciones accionables a partir del intent + filas."""

    def recommend(
        self,
        intent: str,
        rows: list[dict[str, Any]],
        columns: list[str] | None = None,
    ) -> list[str]:
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
        elif intent == "SURGERY":
            out.extend(self._for_surgery(rows))

        return [r for r in out if r][:3]

    def _for_medications(self, rows: list[dict[str, Any]]) -> list[str]:
        tips: list[str] = []
        for row in rows[:3]:
            # Alertas LOW_STOCK: value ≈ días de inventario
            dias = row.get("min_value") if row.get("min_value") is not None else row.get("value")
            codigo = row.get("scope_id") or row.get("code")
            if codigo is not None and dias is not None and "sum_quantity" not in row:
                tips.append(
                    f"Conviene reabastecer el código {codigo}: "
                    f"se estiman cerca de {dias} días de inventario."
                )
                continue
            name = (
                row.get("NombreServicio")
                or row.get("medicamento")
                or row.get("code")
                or row.get("name")
            )
            qty = row.get("sum_quantity") or row.get("quantity") or row.get("total")
            if name and qty is not None:
                tips.append(
                    f"Conviene revisar el abastecimiento de {name} "
                    f"(consumo observado {qty})."
                )
            elif name:
                tips.append(
                    f"Conviene revisar el abastecimiento de {name} según el consumo reciente."
                )
        return tips

    def _for_occupancy(self, rows: list[dict[str, Any]]) -> list[str]:
        ranked = self._top_by_metric(rows)
        first = ranked[0] if ranked else rows[0]
        occupied = first.get("camas_ocupadas")
        unit = first.get("unit")
        if occupied is not None:
            donde = f" en {unit}" if unit else ""
            return [
                f"Conviene revisar disponibilidad de camas{donde}: "
                f"se observan {occupied} ocupadas; prepare turnos y posibles traslados si la carga sigue alta."
            ]
        if unit:
            return [
                f"Priorice revisar capacidad en {unit}, la unidad con mayor conteo en este corte."
            ]
        return [
            "Priorice revisar camas en las unidades con mayor conteo; "
            "si la anticipación marca alza, active contingencia de capacidad."
        ]

    @staticmethod
    def _top_by_metric(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not rows or not isinstance(rows[0], dict):
            return list(rows)

        def score(fila: dict[str, Any]) -> float:
            for k in ("count_all", "count", "total", "camas_ocupadas", "sum_quantity"):
                if k in fila and fila[k] is not None:
                    try:
                        return float(fila[k])
                    except (TypeError, ValueError):
                        continue
            return -1.0

        return sorted(rows, key=score, reverse=True)

    def _for_wait_time(self, rows: list[dict[str, Any]]) -> list[str]:
        first = rows[0]
        hours = first.get("horas_espera_promedio")
        wait = first.get("avg_wait_minutes")
        level = first.get("triage_level")
        nivel = f" (triage {level})" if level is not None else ""
        if hours is not None:
            return [
                f"Conviene reforzar triage y turnos en urgencias{nivel}: "
                f"el promedio observado es ~{hours} h."
            ]
        if wait is not None:
            return [
                f"Conviene ajustar el flujo de urgencias{nivel}: "
                f"la espera media es ~{wait} min."
            ]
        return [
            "Conviene revisar tiempos de triage por nivel y cubrir el de mayor demora."
        ]

    def _for_demand(self, rows: list[dict[str, Any]]) -> list[str]:
        top = rows[0]
        service = (
            top.get("ViaIngreso")
            or top.get("AreaServicio")
            or top.get("NombreServicio")
            or top.get("unit")
        )
        total = top.get("total") or top.get("count_all")
        if service and total is not None:
            return [
                f"Conviene reforzar capacidad en {service}, "
                f"que concentra {total} en el periodo analizado."
            ]
        if service:
            return [f"Conviene reforzar capacidad en {service}, el de mayor demanda observada."]
        return [
            "Identifique el servicio con más ingresos y refuerce capacidad allí primero."
        ]

    def _for_surgery(self, rows: list[dict[str, Any]]) -> list[str]:
        return [
            "Revise quirófanos con más programaciones pendientes versus ejecutadas "
            "para rebalancear agenda."
        ]
