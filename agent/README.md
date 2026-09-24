# Hospital Intelligence — Python Agent (carpeta `agent/` en Susana-AI)

Servicio Python que Node llama en `AGENT_URL`.  
**Contrato oficial:** `GET /health` · `POST /v1/ask`  
Python **no ejecuta** SQL: propone DSL y Node valida/ejecuta en el puerto interno.

## Estructura del monorepo

```
Susana-AI/
├── src/           # Node :3000 + interno :3001
├── agent/         # ESTE servicio :8000
├── frontend/      # React (cuando exista)
└── package.json
```

## Arranque

```bash
cd agent
python -m venv .venv
# Windows:
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
# Rellena AGENT_API_KEY y NODE_INTERNAL_API_KEY iguales que en el .env de Node
uvicorn app.main:app --reload --port 8000
```

En el `.env` de **Node** (raíz Susana-AI):

```
AGENT_URL=http://127.0.0.1:8000
AGENT_API_KEY=<misma que agent/.env AGENT_API_KEY>
INTERNAL_API_KEY=<misma que agent/.env NODE_INTERNAL_API_KEY>
```

## Flujo

1. React → `POST /api/v1/assistant/...` (Node)  
2. Node → `POST /v1/ask` (este agente) con `ticket` + `catalog`  
3. Agente → `POST http://127.0.0.1:3001/internal/agent/query`  
4. Agente responde `{ status, answer }` (incluye recomendaciones)

Demo local HTML (opcional): http://127.0.0.1:8000/flujo  

Ver también: `TAREAS.md`, `GUIA_CODIGO.md`
