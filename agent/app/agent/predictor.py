"""
Proyección de series diarias del HIS (ingresos, espera, consumo).

Random Forest (scikit-learn) entrenado por consulta sobre la propia serie
(lags 1, 2, 3 y 7 + media móvil), con su error típico medido en los últimos
periodos sin barajar el tiempo. Con poca historia cae al promedio reciente:
nunca se devuelve un número que no se haya calculado.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


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


@dataclass
class Proyeccion:
    valores: list[float]  # un valor por periodo futuro
    metodo: str  # 'ml' | 'promedio_reciente'
    error_tipico: float | None  # MAE en validación temporal (solo 'ml')


def proyectar(series: list[float], horizonte: int = _HORIZON) -> Proyeccion | None:
    """
    Proyección numérica de los próximos `horizonte` periodos. Con historia
    suficiente usa el bosque aleatorio (y su error típico medido en los
    últimos periodos, sin barajar el tiempo); si no, el promedio de los
    últimos 7 periodos. Con menos de 7 puntos no proyecta: no hay base.
    """
    if len(series) >= _MIN_ML:
        entrenado = _train_random_forest(series)
        if entrenado:
            modelo, _, mae = entrenado
            futuros = _rf_horizon(series, modelo, horizonte)
            if len(futuros) == horizonte:
                return Proyeccion(futuros, "ml", mae)
    if len(series) >= 7:
        base = sum(series[-7:]) / 7
        return Proyeccion([base] * horizonte, "promedio_reciente", None)
    return None
