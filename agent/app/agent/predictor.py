"""
Predicción / alertas tempranas para decisión hospitalaria.

Capa principal: Random Forest (scikit-learn) sobre la serie temporal HIS
(lags + media móvil). Si hay pocos puntos o falla el ML, cae a tendencia
explicable (medias) — nunca inventa un número sin calcularlo.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any

from app.analytics.statistics import mean, moving_average, safe_number, simple_trend

_DIAS_ES = (
    "lunes",
    "martes",
    "miércoles",
    "jueves",
    "viernes",
    "sábado",
    "domingo",
)

# Mínimo de periodos para entrenar RF con lags (1,2,3,7).
_MIN_ML = 12
_HORIZON = 3
_FEATURE_NAMES = ("lag_1", "lag_2", "lag_3", "lag_7", "media_movil_3", "indice_t")


def _parse_fecha(valor: Any) -> datetime | None:
    if valor is None:
        return None
    if isinstance(valor, datetime):
        return valor
    texto = str(valor).strip()
    if not texto:
        return None
    try:
        return datetime.fromisoformat(texto.replace("Z", "+00:00")[:19])
    except ValueError:
        return None


def extract_series_from_result(resultado: dict[str, Any]) -> tuple[list[float], dict[str, Any]]:
    """Extrae serie numérica (orden temporal si hay fecha) + contexto para el mensaje."""
    rows = resultado.get("rows") or []
    if not isinstance(rows, list) or not rows:
        return [], {}

    sample = rows[0] if isinstance(rows[0], dict) else {}
    columns = list(resultado.get("columns") or sample.keys())

    metric_cols = [
        c
        for c in columns
        if c.startswith("count")
        or c.startswith("avg_")
        or c.startswith("sum_")
        or c in {"quantity", "value", "wait_minutes", "stay_hours"}
    ]
    date_cols = [
        c
        for c in columns
        if "admitted" in c
        or c.endswith("_at")
        or "date" in c
        or "fecha" in c
        or c in {"day", "week", "month"}
    ]

    metric = metric_cols[0] if metric_cols else None
    if metric is None:
        for c in columns:
            if safe_number(sample.get(c)) is not None and c not in date_cols:
                metric = c
                break
    if metric is None:
        return [], {}

    date_col = date_cols[0] if date_cols else None

    puntos: list[tuple[datetime | None, float]] = []
    for fila in rows:
        if not isinstance(fila, dict):
            continue
        num = safe_number(fila.get(metric))
        if num is None:
            continue
        fecha = _parse_fecha(fila.get(date_col)) if date_col else None
        puntos.append((fecha, num))

    if not puntos:
        return [], {}

    if date_col and any(p[0] is not None for p in puntos):
        puntos.sort(key=lambda p: p[0] or datetime.min)

    series = [p[1] for p in puntos]

    by_weekday: dict[str, list[float]] = defaultdict(list)
    for fecha, num in puntos:
        if fecha is not None:
            by_weekday[_DIAS_ES[fecha.weekday()]].append(num)

    weekday_avg = {dia: (sum(vals) / len(vals)) for dia, vals in by_weekday.items() if vals}
    peak_day = max(weekday_avg, key=weekday_avg.get) if weekday_avg else None

    return series, {
        "metric": metric,
        "date_field": date_col,
        "by_weekday": weekday_avg,
        "peak_day": peak_day,
        "n": len(series),
        "last": series[-1] if series else None,
    }


def _features_at(series: list[float], t: int) -> list[float] | None:
    """Vector de features en el índice t (el target sería series[t]). Requiere t >= 7."""
    if t < 7:
        return None
    ventana = series[t - 3 : t]
    return [
        series[t - 1],
        series[t - 2],
        series[t - 3],
        series[t - 7],
        sum(ventana) / len(ventana),
        float(t),
    ]


def _train_random_forest(series: list[float]) -> tuple[Any, list[str], float] | None:
    """
    Entrena un RandomForestRegressor en la serie (online, por consulta).
    Devuelve (modelo, top_features_explicadas, mae_holdout) o None.
    """
    try:
        import numpy as np
        from sklearn.ensemble import RandomForestRegressor
    except ImportError:
        return None

    X: list[list[float]] = []
    y: list[float] = []
    for t in range(7, len(series)):
        feat = _features_at(series, t)
        if feat is None:
            continue
        X.append(feat)
        y.append(series[t])

    if len(X) < 5:
        return None

    X_arr = np.asarray(X, dtype=float)
    y_arr = np.asarray(y, dtype=float)

    # Holdout temporal: últimos ~20% solo para MAE (no barajar el tiempo).
    split = max(1, int(len(X_arr) * 0.8))
    if split >= len(X_arr):
        split = len(X_arr) - 1

    model = RandomForestRegressor(
        n_estimators=80,
        max_depth=6,
        min_samples_leaf=2,
        random_state=42,
        n_jobs=1,
    )
    model.fit(X_arr[:split], y_arr[:split])

    pred_hold = model.predict(X_arr[split:])
    mae = float(np.mean(np.abs(pred_hold - y_arr[split:])))

    importances = list(zip(_FEATURE_NAMES, model.feature_importances_, strict=True))
    importances.sort(key=lambda x: x[1], reverse=True)
    top = [name for name, score in importances[:3] if score > 0]

    # Reentrena con toda la serie para el forecast final.
    model.fit(X_arr, y_arr)
    return model, top, mae


def _rf_horizon(series: list[float], model: Any, horizon: int = _HORIZON) -> list[float]:
    """Pronóstico recursivo a N pasos usando el RF ya entrenado."""
    hist = list(series)
    out: list[float] = []
    for _ in range(horizon):
        t = len(hist)
        feat = _features_at(hist, t)
        if feat is None:
            break
        yhat = float(model.predict([feat])[0])
        yhat = max(0.0, yhat)
        out.append(yhat)
        hist.append(yhat)
    return out


class Predictor:
    """
    Aliado de decisión: predice con Random Forest cuando hay historia suficiente;
    si no, explica con tendencia simple.
    """

    def forecast_facts(
        self,
        series: list[float],
        *,
        label: str = "ingresos",
        context: dict[str, Any] | None = None,
    ) -> tuple[str, str]:
        """
        Devuelve (mensaje, método) donde método es 'random_forest' | 'tendencia' | 'insuficiente'.
        """
        context = context or {}
        if len(series) < 3:
            msg = (
                f"Aún no hay suficientes puntos en el tiempo para proyectar {label} "
                f"(mínimo 3 periodos; ideal al menos {_MIN_ML} para Random Forest)."
            )
            return msg, "insuficiente"

        ml = self._message_ml(series, label=label, context=context)
        if ml:
            return ml, "random_forest"
        return self._message_tendencia(series, label=label, context=context), "tendencia"

    def forecast_message(
        self,
        series: list[float],
        *,
        label: str = "ingresos",
        context: dict[str, Any] | None = None,
    ) -> str:
        msg, _method = self.forecast_facts(series, label=label, context=context)
        return msg

    def _message_ml(
        self,
        series: list[float],
        *,
        label: str,
        context: dict[str, Any],
    ) -> str | None:
        if len(series) < _MIN_ML:
            return None

        trained = _train_random_forest(series)
        if not trained:
            return None

        model, top_feats, mae = trained
        futuros = _rf_horizon(series, model, _HORIZON)
        if not futuros:
            return None

        ultimo = series[-1]
        proy = futuros[0]
        tendencia = simple_trend(series)
        cambio_pct: float | None = None
        if ultimo > 0:
            cambio_pct = ((proy - ultimo) / ultimo) * 100.0

        horizon_txt = ", ".join(f"{v:.0f}" for v in futuros)
        # Mensaje para el chat: sin jerga (MAE, lag_*, etc.)
        partes = [
            f"Para los próximos {_HORIZON} periodos de {label}, la proyección "
            f"(Random Forest, {len(series)} periodos históricos) estima {horizon_txt}. "
            f"El último valor observado fue {ultimo:.0f}."
        ]
        if cambio_pct is not None:
            if abs(cambio_pct) < 2:
                partes.append("Respecto al último punto, se mantiene prácticamente estable.")
            else:
                sentido = "alza" if cambio_pct >= 0 else "baja"
                partes.append(
                    f"Respecto al último punto, apunta a una {sentido} "
                    f"de ~{abs(cambio_pct):.0f}% (tendencia de fondo: {tendencia})."
                )
        else:
            partes.append(f"Tendencia de fondo: {tendencia}.")

        peak = context.get("peak_day")
        by_wd = context.get("by_weekday") or {}
        if peak and peak in by_wd:
            partes.append(
                f"En el histórico, el día con más carga suele ser el {peak} "
                f"(promedio ~{by_wd[peak]:.0f})."
            )

        _ = (top_feats, mae)  # métricas internas; no van al chat
        return " ".join(partes)

    def _message_tendencia(
        self,
        series: list[float],
        *,
        label: str,
        context: dict[str, Any],
    ) -> str:
        """Respaldo explicable cuando aún no hay datos para RF."""
        tendencia = simple_trend(series)
        mitad = max(1, len(series) // 2)
        primera = mean(series[:mitad]) or 0.0
        segunda = mean(series[mitad:]) or 0.0
        ultimo = series[-1]
        ventana = min(3, len(series))
        ma = moving_average(series, window=ventana)
        ma_ultimo = ma[-1]
        delta = segunda - primera
        proyectado = max(0.0, ultimo + (delta / mitad))

        pct: float | None = None
        if primera > 0:
            pct = ((segunda - primera) / primera) * 100.0

        partes: list[str] = [
            f"Anticipación preliminar de {label} con tendencia explicable "
            f"({len(series)} puntos; Random Forest pide al menos {_MIN_ML})."
        ]

        if tendencia == "creciente":
            if pct is not None:
                partes.append(
                    f"La segunda mitad del periodo está ~{pct:.0f}% por encima de la primera."
                )
            else:
                partes.append("La serie muestra tendencia creciente.")
            ma_txt = f", media móvil {ventana}: {ma_ultimo:.0f}" if ma_ultimo is not None else ""
            partes.append(
                f"Próximo periodo estimado ~{proyectado:.0f} (último {ultimo:.0f}{ma_txt})."
            )
        elif tendencia == "decreciente":
            if pct is not None:
                partes.append(
                    f"La segunda mitad está ~{abs(pct):.0f}% por debajo de la primera."
                )
            else:
                partes.append("La serie muestra tendencia decreciente.")
            partes.append(
                f"Próximo periodo estimado ~{proyectado:.0f} (último {ultimo:.0f})."
            )
        else:
            ma_txt = f", media móvil {ventana}: {ma_ultimo:.0f}" if ma_ultimo is not None else ""
            partes.append(
                f"Patrón estable (último {ultimo:.0f}{ma_txt}); "
                f"proyección cercana a ~{proyectado:.0f}."
            )

        peak = context.get("peak_day")
        by_wd = context.get("by_weekday") or {}
        if peak and peak in by_wd:
            partes.append(
                f"Día histórico de mayor carga: {peak} (promedio ~{by_wd[peak]:.0f})."
            )

        return " ".join(partes)
