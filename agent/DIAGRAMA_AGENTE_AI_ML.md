# Flujo interno del agente (solo Python)

Secuencia **solo del agente**: sin Frontend, sin Node, sin Postgres.

```mermaid
sequenceDiagram
    title Flujo interno del agente Python
    participant AskService
    participant NLU
    participant Planner
    participant Node
    participant Narrador
    participant LLM

    AskService->>NLU: pregunta + fecha de corte
    NLU-->>AskService: tema, unidad, periodo, comparadores, ranking
    AskService->>Planner: interpretación + catálogo (con vocabulario real)
    Planner-->>AskService: DSL validado (dsl.py) + alcance en lenguaje natural
    Note over AskService,LLM: si el NLU no reconoce la pregunta, el LLM propone UNA consulta y se valida igual
    AskService->>Node: DSL + ticket
    Node-->>AskService: filas ejecutadas
    AskService->>Narrador: plan + filas (+ proyección si se pide)
    Narrador-->>AskService: respuesta con cifras de las filas, alcance y límites del dato
    AskService->>LLM: pulir redacción (opcional)
    LLM-->>AskService: texto; se descarta si añade, quita o cambia una cifra
```

## Módulos

| Participante | Archivo | Rol |
|--------------|---------|-----|
| AskService | `bridge/ask_service.py` | Orquesta, charla/rechazos, presupuesto de tiempo |
| NLU | `bridge/nlu.py` | Comprensión determinista (tema, periodo, unidades, comparadores...) |
| Planner | `bridge/planner.py` | Interpretación → DSL con valores reales del catálogo |
| Validador | `bridge/dsl.py` | Mismas reglas que Node, antes de gastar cupo del ticket |
| Narrador | `bridge/narrator.py` | Filas → texto (sin inventar), series y proyección |
| Predictor | `agent/predictor.py` | Random Forest por consulta / promedio reciente |
| LLM | `bridge/llm.py` | Planificador de respaldo y pulido verificado (opcionales) |
