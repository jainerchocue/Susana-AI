# Flujo interno del agente (solo Python)

Secuencia **solo del agente**: sin Frontend, sin Node, sin Postgres.

FigJam: https://www.figma.com/board/zKWWfUzEp21UySfBaEoHSk

```mermaid
sequenceDiagram
    title Flujo interno del agente Python
    participant AskService
    participant Planner
    participant Predictor
    participant Recommender

    AskService->>Planner: elegir_consulta e intent
    Planner-->>AskService: DSL e intent
    AskService->>AskService: pedir filas HIS con DSL
    AskService->>Predictor: serie temporal
    Predictor-->>AskService: prediccion Random Forest
    AskService->>Recommender: filas e intent
    Recommender-->>AskService: recomendaciones
    AskService->>AskService: armar respuesta final
```

## Modulos

| Participante | Archivo | Rol |
|--------------|---------|-----|
| AskService | `bridge/ask_service.py` | Orquesta todo y arma la respuesta |
| Planner | `bridge/dsl_planner.py` | DSL + intent |
| Predictor | `agent/predictor.py` | Random Forest / tendencia |
| Recommender | `agent/recommender.py` | Decisiones operativas |
