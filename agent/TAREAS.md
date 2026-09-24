# Tareas AI

## Hecho
- Integración en `Susana-AI/agent`
- Contrato `/health` + `/v1/ask`
- Recomendaciones en la respuesta
- Limpieza: sin tests/demo HTML (`static`, `tests`, `demo-execute`)

## Hecho (extra)
- Predicción en `/v1/ask`: **Random Forest** (scikit-learn) sobre serie HIS + respaldo por tendencia si hay pocos datos
- Recomendaciones orientadas a decisión

## Siguiente
1. Mejorar planificador DSL / LLM
2. Ajustar horizonte/lags con feedback del hospital
3. Persistir modelo entrenado (opcional) en vez de reentrenar por consulta
