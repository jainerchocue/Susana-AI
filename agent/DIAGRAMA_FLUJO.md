# Diagrama del Agente — Hospital Intelligence

**Fuente visual (diseño del equipo):**  
[FigJam — secuencia y arquitectura](https://www.figma.com/board/5XE6rZuQFlOQedlwHzcYEK/Agente-Hospital-Intelligence---secuencia)

Captura integrada en el README: [`docs/diagrams/arquitectura-figjam.png`](../docs/diagrams/arquitectura-figjam.png).

Código de verdad: `Susana-AI/agent` + contrato Node (`/v1/ask`, puerto interno `:3001`).

---

## 1. Arquitectura (quién habla con quién)

Misma estructura del tablero FigJam: **Cliente** · **Servicios** · **Datos**.

```mermaid
flowchart LR
  subgraph cliente ["Cliente"]
    FE["Frontend React"]
  end

  subgraph servicios ["Servicios"]
    Node["Node BFF<br/>:3000 y :3001"]
    Agent["Agente Python<br/>:8000"]
  end

  subgraph datos ["Datos"]
    PG[("PostgreSQL HIS")]
    RD[("Redis tickets")]
  end

  FE -->|"POST /api/v1/assistant/query"| Node
  Node -->|"POST /v1/ask"| Agent
  Agent -->|"ticket + DSL"| Node
  Node -->|"SQL validado"| PG
  Node -->|"tickets"| RD
```

---

## 2. Secuencia de una pregunta (flujo real)

```mermaid
sequenceDiagram
    autonumber
    participant User
    participant Frontend
    participant NodePublic
    participant Agent
    participant NodeInternal
    participant Postgres

    User->>Frontend: Pregunta o profundizar alerta
    Frontend->>NodePublic: POST /api/v1/assistant/query
    NodePublic->>Agent: POST /v1/ask (ticket + catálogo)
    Agent->>NodeInternal: POST /internal/agent/query (DSL)
    NodeInternal->>Postgres: Validar DSL y ejecutar
    Postgres-->>NodeInternal: rows
    NodeInternal-->>Agent: rows · rowCount
    Note over Agent: Narrador: solo cifras de las filas · Predictor si se pide proyección
    Agent-->>NodePublic: status · answer
    NodePublic-->>Frontend: answer · queries
    Frontend-->>User: Datos · Anticipación · Decisión
```

---

## 3. Interior del agente (`handle_ask`)

```mermaid
flowchart TD
    startAsk["POST /v1/ask"] --> charla{"¿charla o rechazo?"}
    charla -->|saludo / ayuda| okCharla["ok: respuesta determinista"]
    charla -->|clínico / datos personales| rechazo["cannot_answer"]
    charla -->|pregunta de datos| nlu["nlu.interpretar"]
    nlu -->|tema reconocido| plan["planner.planificar (vocabulario real)"]
    nlu -->|sin tema| llmPlan["llm.planificar_con_llm (validado)"]
    llmPlan -->|nada válido| noEntendida["cannot_answer + sugerencias"]
    plan -->|sin permiso| sinPermiso["cannot_answer: tu rol no accede"]
    plan --> valid["dsl.validar"]
    llmPlan --> valid
    valid --> exec["node_client.ejecutar_en_node"]
    exec -->|fallo Node| sinDatos["cannot_answer sin cifras"]
    exec -->|filas| narr["narrator.redactar (+ predictor si es proyección)"]
    narr --> pulir["llm.pulir (se descarta si altera cifras)"]
    pulir --> okAns["ok: answer"]
```

---

## Contratos clave

| Paso | Endpoint | Auth |
|------|----------|------|
| Usuario | `POST /api/v1/assistant/query` | Sesión cookie + Origin |
| Node → Agente | `POST /v1/ask` | `X-Internal-Key` = `AGENT_API_KEY` |
| Agente → Node | `POST /internal/agent/query` | `x-internal-key` = `INTERNAL_API_KEY` |
| Health | `GET /health` agente · `GET /api/v1/health/ready` Node | — |

## Qué NO hace el agente

- No ejecuta SQL directo
- No depende de OpenRouter: el LLM solo es respaldo del planificador y pulido de redacción verificado
- No es autoridad de datos: Node valida el DSL y ejecuta contra Postgres
- Random Forest se entrena **por consulta** sobre la serie HIS (no modelo persistido en disco)
