# Guía del código — Hospital Intelligence Agent

Manual para **entender y explicar** el servicio de IA (equipo AI / exposición hackatón).  
Para arrancar el servidor, usa [`README.md`](./README.md).

---

## 1. Idea central (frases para jueces)

1. **El agente propone, no ejecuta.** Nunca hace `LLM → SQL → base de datos` directo.
2. **Node.js** (u otro backend) valida, autoriza y ejecuta el SQL.
3. Luego el agente **interpreta** filas reales: no inventa números.
4. Sin API key de LLM, igual funciona la demo con **fallback** (`prompts/fallback.sql.json`).

Flujo:

```
Pregunta
  → POST /internal/agent/analyze
  → intent → plan → NL2SQL → validación SQL → respuesta con SQL propuesto
  → (Node ejecuta)
  → POST /internal/agent/interpret
  → texto + insights + recomendaciones
```

---

## 2. Árbol de carpetas (qué es cada una)

```
agent/
├── app/                 # Código del servicio FastAPI
│   ├── main.py          # Arranque de la app
│   ├── config/          # Variables de entorno (.env)
│   ├── api/             # Endpoints HTTP + seguridad básica
│   ├── agent/           # Cerebro: intent, plan, SQL, interpretación
│   ├── llm/             # Cliente OpenRouter + carga de prompts
│   ├── schema/          # Tablas HIS reales + glosario hospitalario
│   ├── security/        # Validación de SQL (sqlglot)
│   ├── models/          # Formas JSON de entrada/salida
│   └── analytics/       # Stats simples (promedio, tendencia)
├── prompts/             # Textos para el LLM + SQL de fallback
├── data/                # Loader .txt → hospital.db
├── tests/               # Pruebas pytest
├── scripts/             # Demos (ej. demo_uci.py)
├── .env.example         # Plantilla de configuración
├── requirements.txt
├── README.md            # Setup y endpoints
└── GUIA_CODIGO.md       # Este archivo
```

| Carpeta | Pregunta que responde |
|---------|------------------------|
| `app/api/` | ¿Cómo entra la petición HTTP? |
| `app/agent/` | ¿Cómo piensa el agente? |
| `app/schema/` | ¿Qué tablas/columnas conoce? |
| `app/security/` | ¿Cómo evita SQL peligroso? |
| `app/llm/` | ¿Cómo habla con el modelo? |
| `prompts/` | ¿Qué instrucciones le damos al LLM? |
| `data/` | ¿De dónde sale `hospital.db`? |
| `tests/` | ¿Cómo sabemos que funciona? |

---

## 3. Tour recomendado (orden de estudio)

Estudia en este orden (es el camino de una petición real):

1. `app/main.py`
2. `app/api/dependencies.py` + `app/api/routes/*`
3. `app/models/request.py` + `response.py`
4. `app/agent/orchestrator.py` ← **el más importante**
5. `intent.py` → `planner.py` → `nl2sql.py` → `security/query_analyzer.py`
6. `interpreter.py` → `formatter.py`
7. `schema/loader.py` + `glossary.py`
8. `llm/*` + `prompts/*`
9. `data/load_data.py` + `tests/*`

---

## 4. Archivo por archivo

### Raíz del servicio

#### `app/main.py`
- **Qué hace:** Crea la aplicación FastAPI, logging, CORS en desarrollo, monta el router `/internal/agent`, middleware de tamaño de body.
- **Qué no hace:** No genera SQL ni interpreta datos.
- **Exposición:** *“Es la puerta de entrada del servicio Python.”*

#### `app/__init__.py`
- Versión del paquete (`1.0.0`), sale en `/health`.

---

### `app/config/` — configuración

#### `settings.py`
- Lee `.env` con Pydantic Settings: `INTERNAL_API_KEY`, OpenRouter, timeouts, rutas a `prompts/`, `data/`, docs HIS.
- **Exposición:** *“Toda la config está centralizada; no hay secrets en el código.”*
- **Si cambias:** API key, modelo LLM, límites → `.env` (no hace falta tocar Python).

---

### `app/models/` — contrato JSON

#### `request.py`
- Define qué manda el cliente:
  - `AnalyzeRequest`: `question`, `user_context`, `conversation`, `schema_version`
  - `InterpretRequest`: `question`, `intent`, `rows`, `columns`, `metadata`…

#### `response.py`
- Define qué devolvemos:
  - `AnalyzeResponse`: `intent`, `proposed_query`, `validation`, `fallback_used`, `rejected`…
  - `InterpretResponse`: `answer`, `insights`, `recommendations`, `data`…
- **Exposición:** *“Este es el contrato con Node/React.”*

---

### `app/api/` — HTTP

#### `dependencies.py`
- Verifica header `X-API-Key`.
- Rate limit simple en memoria (por minuto).
- **Exposición:** *“El agente es servicio interno, no público.”*

#### `routes/health.py`
- `GET /internal/agent/health` → status, versión, si hay LLM configurado.

#### `routes/analyze.py`
- `POST /internal/agent/analyze` → llama al orchestrator → SQL propuesto.

#### `routes/interpret.py`
- `POST /internal/agent/interpret` → explica filas ya ejecutadas.

#### `api/__init__.py`
- Junta las rutas bajo el prefijo `/internal/agent`.

---

### `app/agent/` — cerebro (lo más preguntado)

#### `orchestrator.py` ⭐
- **Director de orquesta.** Une todo.
- `analyze()`:
  1. Detecta intent  
  2. Si es clínica / fuera de dominio → `rejected`  
  3. Planifica  
  4. Genera SQL (LLM o fallback)  
  5. Valida SQL  
  6. Formatea respuesta  
- `interpret()`: llama al intérprete y formatea.
- **Exposición:** *“Aquí está el flujo completo; los demás módulos son piezas.”*
- **Qué no hace:** No ejecuta SQL contra la base.

#### `intent.py`
- Clasifica la pregunta: `OCCUPANCY`, `WAIT_TIME`, `MEDICATION_STOCK`, `DEMAND`, etc.
- Primero **reglas** (rápido, sin LLM); si no alcanza, LLM few-shot.
- Rechaza preguntas clínicas (`OUT_OF_DOMAIN`).
- **Exposición:** *“No gastamos LLM si una regla basta.”*

#### `planner.py`
- Antes del SQL arma un **plan**: tablas, filtros, métricas, limit.
- Ejemplo mental: “medicamentos &lt; 5 días” → tablas `MedicamentoInsumo`, métrica días inventario, sort ASC.
- **Exposición:** *“Planificar evita SQL a ciegas.”*

#### `nl2sql.py`
- Genera el SQL.
- Si no hay LLM (o falla): busca match en `prompts/fallback.sql.json`.
- Devuelve `(resultado, fallback_used)`.
- **Exposición:** *“La demo no depende de que OpenRouter esté arriba.”*

#### `interpreter.py`
- Recibe `rows` reales y genera `answer` / insights / recomendaciones.
- Modo determinístico siempre; LLM opcional para mejorar redacción.
- Regla de oro: **no inventar cifras**.
- **Exposición:** *“Si el resultado dice 12, respondemos 12.”*

#### `formatter.py`
- **No decide lógica.** Empaqueta resultados internos en `AnalyzeResponse` / `InterpretResponse`.
- **Exposición:** *“Estandariza lo que consume Node.”*
- Ver también: conversación previa sobre este archivo.

---

### `app/security/` — seguridad SQL

#### `query_analyzer.py`
- Parsea SQL con **sqlglot**.
- Solo `SELECT`; bloquea INSERT/UPDATE/DELETE/DROP/etc.
- Comprueba tablas conocidas; avisa columnas dudosas; asegura `LIMIT`.
- **Exposición:** *“Aunque el LLM alucine un DROP, aquí se rechaza.”*

---

### `app/schema/` — conocimiento del hospital

#### `loader.py`
- Define las **7 tablas HIS** reales: Paciente, Ingresos, Triage, Atencion, Servicios, MedicamentoInsumo, ProgramacionCirugia.
- Elige tablas relevantes según intent (no manda todo el esquema al LLM).
- Genera el texto de esquema para el prompt NL2SQL.

#### `glossary.py`
- Terminología: HIS, EPS, UCI, triage, CUPS, CIE-10…
- Aliases (“urgencia” → ViaIngreso) y columnas PII a evitar.
- **Exposición:** *“Usamos el lenguaje del diccionario/glosario del hospital, no inventamos campos.”*

---

### `app/llm/` — proveedor de modelo

#### `client.py`
- Cliente OpenRouter (API compatible OpenAI).
- Si no hay `OPENROUTER_API_KEY` → `is_available = False` → fallback.

#### `prompts.py`
- Carga archivos de `prompts/*.txt` y los versiona de forma simple.

#### `schemas.py`
- Modelos Pydantic del I/O del LLM: `IntentResult`, `QueryPlan`, `NL2SQLResult`, `InterpretationResult`.

---

### `app/analytics/`

#### `statistics.py`
- Helpers: media, media móvil, tendencia simple, resumen de columna numérica.
- Usados al interpretar (explicable, no ML complejo).

---

### `prompts/` — instrucciones (fuera del código)

| Archivo | Uso |
|---------|-----|
| `system.txt` | Reglas base del agente (no inventar, no clínico, solo SELECT…) |
| `intent.txt` | Few-shot de clasificación de intención |
| `nl2sql.txt` | Cómo generar SQL con el esquema |
| `interpretation.txt` | Cómo explicar resultados |
| `fallback.sql.json` | 4 consultas demo predefinidas |

**Exposición:** *“Los prompts están versionados en archivos, no enterrados en Python.”*

---

### `data/`

#### `load_data.py`
- Lee los `.txt` con separador `|` y crea `hospital.db` (SQLite).
- Comando: `python -m data.load_data`

#### `hospital.db`
- Base local con las 7 tablas (para demo / ejecución por backend).  
- El agente **no la usa en analyze**; solo propone SQL. Quien ejecuta es Node (o un script demo).

---

### `tests/`

| Archivo | Qué prueba |
|---------|------------|
| `test_analyze.py` | 4 preguntas demo + rechazo clínico + API key |
| `test_interpret.py` | Interpretación con filas de ejemplo + vacío |
| `test_fallback.py` | Match de fallback y validación SQL |
| `conftest.py` | Cliente de prueba + env sin LLM |

Comando: `pytest -q` desde `agent/`.

---

### `scripts/demo_uci.py`
- Demo punta a punta para estudiar: analyze → ejecuta SQL en SQLite → interpret.  
- Útil en exposición en vivo.

---

## 5. Quiero cambiar X → edito Y

| Quiero… | Archivo(s) |
|---------|------------|
| Cambiar la API key / modelo LLM | `.env` (`settings.py` solo si agregas variables nuevas) |
| Añadir o mejorar una pregunta demo sin LLM | `prompts/fallback.sql.json` |
| Cambiar reglas de “qué es ocupación / medicamentos…” | `app/agent/intent.py` |
| Cambiar el plan (filtros/métricas tipicos) | `app/agent/planner.py` |
| Cambiar cómo se genera SQL con LLM | `prompts/nl2sql.txt` (+ `nl2sql.py` si cambia el flujo) |
| Ser más estricto con SQL peligroso | `app/security/query_analyzer.py` |
| Añadir tabla/columna del HIS | `app/schema/loader.py` |
| Añadir término hospitalario / sinónimo | `app/schema/glossary.py` |
| Cambiar tono de la interpretación | `prompts/interpretation.txt` + `interpreter.py` |
| Cambiar forma del JSON de respuesta | `app/models/response.py` + `formatter.py` |
| Nuevo endpoint HTTP | `app/api/routes/` + registrarlo en `api/__init__.py` |
| Recargar datos del hospital | `python -m data.load_data` |
| Nueva prueba automática | `tests/test_*.py` |

---

## 6. Checklist de exposición (equipo AI)

Si te preguntan, apunta al archivo:

- [ ] “¿Dónde está el flujo completo?” → `orchestrator.py`
- [ ] “¿Cómo evitan SQL malicioso?” → `query_analyzer.py`
- [ ] “¿Y si no hay internet / API key?” → `nl2sql.py` + `fallback.sql.json`
- [ ] “¿Usan el esquema real del hospital?” → `schema/loader.py` + `glossary.py`
- [ ] “¿Inventan datos?” → `interpreter.py` (solo filas recibidas)
- [ ] “¿El agente ejecuta en la DB?” → **No.** Solo propone; quien ejecuta es el backend.
- [ ] “¿Recomendaciones clínicas?” → `intent.py` rechaza `OUT_OF_DOMAIN`

---

## 7. Cómo usar esta guía

1. Lee la sección **2** (carpetas) en 5 minutos.  
2. Abre `orchestrator.py` y síguelo línea a línea con la sección **4**.  
3. Prueba en vivo:
   - **UI del flujo:** http://127.0.0.1:8000/flujo  
   - Swagger: http://127.0.0.1:8000/docs  
   - Script: `python scripts/demo_uci.py`  
4. Cuando modifiques algo, mira la tabla de la sección **5**.

Si un archivo no te queda claro, ábrelo y pregunta por **ese archivo** (uno por uno): es la forma más rápida de preparar la defensa del código.
