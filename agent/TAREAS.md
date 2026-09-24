# Tareas AI — dentro de Susana-AI/agent

## Hecho
- Carpeta `Susana-AI/agent/` integrada al monorepo Node
- Contrato `GET /health` + `POST /v1/ask`
- Callback a Node `:3001/internal/agent/query`
- Recommender enchufado en la respuesta `answer`
- `.venv` / `.env` / `hospital.db` en `.gitignore`

## Siguiente (equipo AI)
1. Copiar `agent/.env.example` → `agent/.env` y alinear claves con Node
2. Levantar Node + agente y probar una pregunta vía assistant
3. Mejorar planificador DSL / LLM sobre el catálogo
4. Predicción (`predictor.py`)
5. Frontend React cuando exista → no depende de `/flujo`
