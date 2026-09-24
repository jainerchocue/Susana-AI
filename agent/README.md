# Hospital Intelligence — Python Agent (`agent/` en Susana-AI)

Servicio Python que Node llama vía `AGENT_URL`.  
Contrato: **`GET /health`** · **`POST /v1/ask`**  
No ejecuta SQL: propone DSL y Node valida/ejecuta en el puerto interno.

## Arranque

```bash
cd agent
python -m venv .venv
# Windows:
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
# Alinear AGENT_API_KEY y NODE_INTERNAL_API_KEY con el .env de Node
uvicorn app.main:app --reload --port 8000
```

En Node (raíz Susana-AI):

```
AGENT_URL=http://127.0.0.1:8000
AGENT_API_KEY=<igual que agent/.env>
INTERNAL_API_KEY=<igual que agent NODE_INTERNAL_API_KEY>
```

## Flujo

React → Node `:3000` → este agente `:8000` `/v1/ask` → Node `:3001` `/internal/agent/query` → respuesta `{ status, answer }`.
