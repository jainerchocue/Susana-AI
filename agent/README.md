# Hospital Intelligence — Agente Python (`agent/`)

Servicio que Node llama vía `AGENT_URL`. Contrato: **`GET /health`** · **`POST /v1/ask`**.
El agente **no ejecuta SQL ni ve tablas**: propone consultas del DSL y Node las valida, las
ejecuta con el ticket del usuario y devuelve las filas. Toda cifra de la respuesta sale de esas filas.

## Arranque

```bash
cd agent
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env                                     # alinear las dos claves con el .env de Node
uvicorn app.main:app --reload --port 8000
```

| agent/.env              | debe ser igual a (.env de Node) |
| ----------------------- | ------------------------------- |
| `AGENT_API_KEY`         | `AGENT_API_KEY`                 |
| `NODE_INTERNAL_API_KEY` | `INTERNAL_API_KEY`              |
| `NODE_INTERNAL_URL`     | `http://127.0.0.1:${INTERNAL_PORT}` |

Si no coinciden, Node responde 502 al chat (Python rechaza con 401) o Python no obtiene datos.

## Flujo de `/v1/ask`

```
React → Node :3000 /assistant/query
          └─ Node → Python :8000 /v1/ask  { question, ticket, catalog (con vocabulario real), limits, context }
                      ├─ charla / ayuda / rechazo clínico o de datos personales → respuesta determinista
                      ├─ nlu.py      entiende: tema, unidad, periodo, comparadores, agrupación, ranking
                      ├─ planner.py  arma el DSL con valores REALES del catálogo (nunca inventados)
                      │              (si no reconoce la pregunta: llm.py propone UNA consulta, validada)
                      ├─ dsl.py      valida el DSL con las mismas reglas que Node
                      ├─ Node :3001 /internal/agent/query  (ticket) → filas
                      ├─ narrator.py redacta SOLO con esas filas + qué se midió, dónde y con qué fecha de corte
                      └─ llm.py      pule la redacción; se descarta si añade, quita o cambia una cifra
```

Qué puede responder (según los permisos del rol, que definen el catálogo):

| Tema | Dataset (Node) | Ejemplo |
| --- | --- | --- |
| Ocupación de camas | `bed_occupancy` (misma cifra que el panel) | ¿Cuántas camas de UCI están ocupadas hoy? |
| Días de inventario | `medication_inventory` (misma cifra que el panel) | ¿Qué medicamentos tienen menos de 5 días de inventario? |
| Espera, estancia, edad | `admissions` | ¿Cuál es la espera promedio en urgencias la última semana? |
| Ingresos, diagnósticos, triage | `admissions` | ¿Qué servicio tiene más pacientes ingresados este mes? |
| Consumo de medicamentos | `medications` | Top 10 medicamentos más dispensados en agosto |
| Servicios / procedimientos | `services` | ¿Qué procedimientos se prestaron más este mes? |
| Cirugías | `surgeries` | ¿Cuántas cirugías no se realizaron? |
| Alertas | `alerts` | ¿Qué alertas críticas están abiertas? |
| Tendencia y proyección | series diarias | ¿Cómo se ve la demanda la próxima semana? |

"Hoy", "esta semana", "este mes" se calculan desde la **fecha de corte de los datos**
(`context.referenceDate`, el último ingreso importado), igual que el panel, y la respuesta lo dice.

## Garantías contra alucinación

- Los filtros de texto usan solo valores del vocabulario que manda Node (`values` de cada dimensión).
- Cada respuesta declara su alcance (unidad, periodo, filtros) y los límites del dato (censo estimado,
  stock registrado por Farmacia, periodos incompletos, día de corte).
- Sin filas, lo dice. Si Node falla, `cannot_answer` sin cifras.
- El LLM (OpenRouter) es opcional: con `LLM_ENABLED=false` todo funciona igual (redacción determinista).
- Presupuesto total `ASK_BUDGET_SECONDS` (17 s) por debajo del timeout de Node (20 s).

## Tests

```bash
cd agent && .venv/bin/python -m pytest -q
```

`tests/fixtures/catalogo.json` es el catálogo real que Node envía (exportado de `hospital_local`).
