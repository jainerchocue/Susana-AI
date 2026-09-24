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
    Agent->>NodeInternal: consulta_serie_temporal
    NodeInternal->>Postgres: Serie diaria admissions
    Postgres-->>NodeInternal: serie
    NodeInternal-->>Agent: serie
    Note over Agent: Predictor Random Forest · Recommender
    Agent-->>NodePublic: status · answer
    NodePublic-->>Frontend: answer · queries
    Frontend-->>User: Datos · Anticipación · Decisión
```

---

## 3. Interior del agente (`handle_ask`)

```mermaid
flowchart TD
    startAsk["POST /v1/ask"] --> planDSL["dsl_planner.elegir_consulta"]
    planDSL -->|sin dataset| cannotAnswer["cannot_answer"]
    planDSL -->|query DSL| execMain["node_client.ejecutar_en_node"]
    execMain -->|fallo Node| cannotData["cannot_answer sin datos"]
    execMain -->|rows| intentMap["intent_desde_pregunta"]
    intentMap --> tips["Recommender.recommend"]
    tips --> seriesQ["consulta_serie_temporal"]
    seriesQ --> execSeries["ejecutar_en_node serie diaria"]
    execSeries --> extract["extract_series_from_result"]
    extract -->|con date_field y n gte 12| rf["Predictor Random Forest"]
    extract -->|pocos puntos| trend["Predictor tendencia explicable"]
    extract -->|sin fecha| skipPred["Sin predicción ML"]
    rf --> redact["_redactar datos + predicción + decisión"]
    trend --> redact
    skipPred --> redact
    tips --> redact
    redact --> okAns["status ok answer"]
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
- No llama a OpenRouter en el camino actual de `/v1/ask` (planner determinístico)
- No es autoridad de datos: Node valida el DSL y ejecuta contra Postgres
- Random Forest se entrena **por consulta** sobre la serie HIS (no modelo persistido en disco)
