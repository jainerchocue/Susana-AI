# Integración con el agente (Python)

Contrato para quien implemente el servicio Python. **Node tiene toda la
autoridad**: Python nunca ve SQL, nombres de tabla/columna reales, ni
credenciales de base de datos. Solo *propone* consultas en un DSL JSON que
Node valida contra el catálogo del usuario, ejecuta con SQL parametrizado en
una transacción de solo lectura, y devuelve. Ver el flujo completo en
`docs/architecture.md`.

Python expone dos endpoints que Node consume (`core/agent/client.ts`), y
consume uno que Node expone en su puerto interno (`assistant.internal.ts`).

---

## 1. `GET {AGENT_URL}/health`

Liveness del agente para `GET /api/v1/health/ready` (`checks.agent`). Node
solo mira el código HTTP, con timeout de 2000 ms:

- `2xx` → `up`
- cualquier otra cosa, timeout o error de red → `down`

No hace falta cuerpo. Un `down` **no** tumba el resto de la API (el agente es
una dependencia opcional): `/health/ready` sigue en `200`, con
`status: 'degraded'`.

---

## 2. `POST {AGENT_URL}/v1/ask` — Node llama a Python

Cabeceras: `X-Internal-Key: <AGENT_API_KEY>`, `X-Request-Id: <uuid>`,
`Content-Type: application/json`. Timeout `AGENT_TIMEOUT_MS` (20 s por
defecto): si no hay respuesta a tiempo, Node responde `503
AGENT_UNAVAILABLE` a React sin reintentar.

**Request** (lo construye `preguntar()` en `assistant.service.ts`):

```json
{
  "question": "¿Cuántas alertas de medicamento están abiertas?",
  "ticket": "b64url-de-32-bytes-aleatorios",
  "catalog": [
    {
      "dataset": "alerts",
      "description": "Alertas operativas generadas por el motor de reglas del hospital.",
      "dimensions": [
        { "name": "type", "type": "string", "description": "Tipo de alerta (LOW_STOCK, HIGH_OCCUPANCY, ...)." },
        { "name": "severity", "type": "string", "description": "Severidad: WARNING o CRITICAL." },
        { "name": "scope", "type": "string", "description": "Ambito: medication, service, triage o surgery." }
      ],
      "measures": [
        { "name": "value", "description": "Valor de la metrica que disparo la alerta." },
        { "name": "threshold", "description": "Umbral que se supero." }
      ]
    }
  ],
  "limits": { "maxQueries": 2, "maxRows": 200 },
  "requestId": "uuid-de-la-peticion-original"
}
```

`catalog` es el catálogo **lógico**: solo lo que ve React, nunca `table` ni
`column` reales. `limits.maxQueries` depende de si el usuario tiene
`assistant:advanced` (`AGENT_MAX_QUERIES_ADVANCED`, 5 por defecto) o no
(`AGENT_MAX_QUERIES_BASIC`, 2). El `ticket` es la única credencial que Python
recibe: se lo pasa tal cual al puerto interno en cada consulta que proponga.

**Response esperada** (Zod, `core/agent/client.ts`):

```json
{ "status": "ok", "answer": "Hay 2 alertas de medicamento abiertas." }
```

- `status`: `"ok"` o `"cannot_answer"`.
- `answer`: texto, máximo 4000 caracteres. Es **no confiable**: Node lo valida
  y lo devuelve a React tal cual, pero nunca lo usa para decidir nada ni lo
  sustituye por datos — los datos que React ve son los que Node ejecutó, no
  los que Python "dice" que obtuvo (`queries` en la respuesta de
  `POST /assistant/query`).
- HTTP no-2xx, cuerpo que no sea JSON, o que no pase el schema →
  `502 AGENT_ERROR`. El cuerpo de la respuesta **nunca se loguea** (es texto
  de un tercero no confiable).

Entre 0 y `limits.maxQueries` veces, antes de responder, Python llama al paso 3.

---

## 3. `POST http://{INTERNAL_HOST}:{INTERNAL_PORT}/internal/agent/query` — Python llama a Node

Segundo puerto, `127.0.0.1` por defecto, **nunca expuesto** fuera de la red
donde corre Python. Tres capas de defensa, todas obligatorias:

1. **IP allowlist** (`INTERNAL_ALLOWED_IPS`, IP o CIDR).
2. **Clave compartida**: cabecera `X-Internal-Key: <INTERNAL_API_KEY>`
   (**distinta** de `AGENT_API_KEY`: son dos sentidos, filtrar una no habilita
   el otro). Comparación con `crypto.timingSafeEqual` sobre el hash SHA-256.
3. **Rate limit** por IP (`INTERNAL_RATE_LIMIT_MAX`).

Cabeceras: `X-Internal-Key: <INTERNAL_API_KEY>`, `Content-Type: application/json`.

**Request:**

```json
{
  "ticket": "el-mismo-ticket-que-llego-en-/v1/ask",
  "query": {
    "dataset": "alerts",
    "metrics": [{ "agg": "count" }],
    "groupBy": [{ "field": "severity" }],
    "filters": [{ "field": "scope", "op": "eq", "value": "medication" }],
    "orderBy": [{ "ref": "metric:0", "dir": "desc" }],
    "limit": 100
  }
}
```

**Response (200):**

```json
{
  "columns": ["severity", "count_all"],
  "rows": [{ "severity": "WARNING", "count_all": 2 }],
  "rowCount": 1,
  "truncated": false
}
```

**Errores:**

| HTTP | Código | Causa |
|---|---|---|
| 401 | `TOKEN_INVALID` | falta o es incorrecta `X-Internal-Key`; o el `ticket` no existe, caducó o ya se revocó |
| 403 | `FORBIDDEN` | origen fuera de `INTERNAL_ALLOWED_IPS`; o el ticket agotó su cupo de consultas |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | falta `Content-Type: application/json` con cuerpo |
| 422 | `QUERY_REJECTED` | el DSL no pasa `validarConsulta` (ver detalle abajo); `details` trae el campo exacto |
| 429 | `RATE_LIMITED` | techo de `internalRateLimit` |

Cada consulta que Python haga con el mismo `ticket` cuenta contra
`limits.maxQueries` de la respuesta de `/v1/ask`; superarlo da 403. El ticket
se **revoca** en cuanto Node termina de responder a React (éxito o error): una
llamada tardía con el mismo ticket da 401.

---

## El DSL (`querySpecSchema`)

Todo campo (`dataset`, nombres en `metrics`/`groupBy`/`filters`) es
`^[a-z][a-z0-9_]{0,62}$`: minúsculas, dígitos y `_`. Un carácter fuera de eso
ya es 422 antes de mirar el catálogo.

```ts
{
  dataset: string,                 // debe existir en el catalogo Y el usuario debe tener su permiso
  metrics: [                       // 1..5
    { agg: 'count'|'count_distinct'|'sum'|'avg'|'min'|'max', field?: string },
  ],
  groupBy: [{ field: string, grain?: 'day'|'week'|'month'|'year' }],  // 0..3
  filters: [                       // 0..10
    { field: string, op: 'eq'|'neq'|'gt'|'gte'|'lt'|'lte'|'in'|'between'|'contains',
      value: string | number | boolean | (string|number)[] },
  ],
  orderBy: [{ ref: 'metric:0'..'metric:4' | '<campo-de-groupBy>', dir?: 'asc'|'desc' }],  // 0..3
  limit: number,                   // 1..1000, tope real = limits.maxRows del ticket
}
```

Reglas semánticas (`assistant.query.ts`, `validarConsulta`):

- `count` no lleva `field`; `count_distinct` exige una **dimensión**;
  `sum`/`avg`/`min`/`max` exigen una **medida**.
- `groupBy.field` solo sobre dimensiones; `grain` solo si la dimensión es de
  tipo `date`.
- El operador debe encajar con el tipo del campo: `contains` solo en
  `string`; `gt`/`gte`/`lt`/`lte`/`between` no en `string`; `between` exige un
  array de 2 valores; `in` exige un array.
- Valores de fecha: ISO 8601 parseable.
- `orderBy.ref` = `metric:i` (con `i` dentro del rango de `metrics`) o un
  campo que esté en `groupBy`.
- `limit` no puede superar `limits.maxRows` del ticket.
- Un dataset inexistente y uno que existe pero el usuario no puede ver dan
  **el mismo mensaje** ("Dataset desconocido o no permitido"): no hay forma de
  distinguir uno de otro desde fuera.

Node traduce la consulta ya validada a SQL parametrizado
(`Prisma.sql`/`Prisma.raw`, nunca `$queryRawUnsafe`): todo identificador
(tabla, columna) sale del catálogo interno, nunca del DSL; todo valor viaja
como parámetro. La ejecución va en una transacción `READ ONLY` con
`statement_timeout = AGENT_QUERY_TIMEOUT_MS`.

---

## Catálogo lógico disponible hoy

Cinco datasets (`src/modules/assistant/assistant.catalog.ts`), cada uno
detrás de su propio permiso — un usuario solo ve, en `catalog`, los datasets
para los que tiene el permiso (`datasetsPara`). Ver `describirParaAgente`
para el JSON exacto que recibe Python: **nunca** incluye `table`/`column`
reales, solo las claves lógicas de abajo.

| Dataset | Permiso | Tabla real | Dimensiones | Medidas |
|---|---|---|---|---|
| `alerts` | `alerts:read` | `alerts` | `type`, `severity`, `status`, `scope`, `scope_id`, `first_seen_at` (date), `last_seen_at` (date) | `value`, `threshold` |
| `admissions` | `services:read` | `his_admissions` | `unit`, `subunit`, `admission_class`, `entry_route`, `risk_type`, `diagnosis_code`, `diagnosis_name`, `triage_level` (number), `patient_sex`, `patient_regime`, `patient_zone`, `admitted_at` (date, zona `America/Bogota`) | `wait_minutes`, `stay_hours`, `patient_age` |
| `services` | `services:read` | `his_service_records` | `area`, `area_code`, `specialty`, `code`, `provided_at` (date, zona `America/Bogota`) | `quantity` |
| `medications` | `medications:read` | `his_medication_dispenses` | `code`, `area`, `specialty`, `dispensed_at` (date, zona `America/Bogota`) | `quantity` |
| `surgeries` | `surgeries:read` | `his_surgery_schedules` | `procedure_code`, `executed` ("si"/"no"/"desconocido"), `schedule_number` | *(ninguna: solo sirve para `count`/`count_distinct`)* |

Solo `alerts` lleva `rowFilter` (filtra por `scope` según
`alcancesPorPermiso(permisos, ALERT_SCOPE_PERMISSION)`, igual que
`GET /alerts`): un `FARMACIA` que pregunte por alertas solo cuenta las de
`scope = medication`, aunque pida agrupar por otra cosa. Los datasets HIS no
llevan `rowFilter`: el acceso depende solo del permiso que los destapa
enteros, no hay todavía un concepto de "mi unidad" o "mi medicamento" en RBAC.

**Límite documentado, no un descuido:** el dataset `medications` no hace
`JOIN` con el catálogo `his_medications` — el DSL no soporta joins — así que
no trae el nombre ni el `kind` del medicamento, solo su `code`. Si Python
necesita el nombre, tiene que pedirlo aparte o trabajar con el código.

Ejemplo real de `catalog` que recibe Python al preguntar como `DIRECTOR`
(tiene los 5 permisos, recortado a 2 datasets):
```json
[
  { "dataset": "admissions", "description": "Ingresos hospitalarios: cada fila es el episodio de un paciente...",
    "dimensions": [
      { "name": "unit", "type": "string", "description": "Unidad del ingreso (URGENCIAS, HOSPITALIZACION, PEDIATRIA...)." },
      { "name": "triage_level", "type": "number", "description": "Nivel de triage (1 a 5; 1 es el mas urgente). Nulo sin triage." }
    ],
    "measures": [
      { "name": "wait_minutes", "description": "Minutos entre el triage y la primera atencion." }
    ] },
  { "dataset": "surgeries", "description": "Programaciones de cirugia. Sin fecha ni medidas numericas en el extracto...",
    "dimensions": [
      { "name": "executed", "type": "string", "description": "\"si\", \"no\" o \"desconocido\" (desconocido = sin ingreso verificable en el extracto)." }
    ],
    "measures": [] }
]
```

Consulta real de punta a punta (pregunta "¿Cuál es la espera por nivel de
triage?", contra `hospital_local`, vía `npm run agent:mock`):
```json
// DSL propuesto por el agente (mock o real, misma forma)
{"dataset":"admissions","metrics":[{"agg":"avg","field":"wait_minutes"}],"groupBy":[{"field":"triage_level"}],"limit":10}
// ResultadoConsulta que Node ejecutó y devolvió
{"columns":["triage_level","avg_wait_minutes"],
 "rows":[{"triage_level":1,"avg_wait_minutes":26.726937547027838},{"triage_level":2,"avg_wait_minutes":47.842350427350446}],
 "rowCount":5,"truncated":false}
```

---

## Implementación de referencia: el agente simulado

`scripts/agent-mock.mjs` (`npm run agent:mock`, puerto `AGENT_MOCK_PORT`,
8000 por defecto) **no es el agente Python real**: es una implementación de
referencia mínima para desarrollar y probar el flujo de punta a punta sin
tener el servicio de Python levantado. Útil para el equipo de Python como
ejemplo ejecutable del contrato de esta página, y para el equipo de React
como forma de probar el asistente en la demo (`docs/frontend.md` §1).

Qué hace, en `node:http` puro (sin dependencias, `Node >=22`):
- `GET /health` → `{ status: 'up' }`.
- `POST /v1/ask`: valida `X-Internal-Key` contra `AGENT_API_KEY`; elige **una**
  consulta del DSL por palabras clave de la pregunta, y **solo** entre los
  datasets que vienen en el `catalog` recibido (nunca todos los que existen):
  "medicamento" → top de `medications` por cantidad agrupado por `code`;
  "espera"/"triage" → `admissions` con `avg(wait_minutes)` por
  `triage_level`; "cirugía" → `surgeries` contado por `executed`; si no
  reconoce ninguna palabra clave, cuenta `admissions` por `unit`. Sin
  ningún dataset disponible en el catálogo, responde `cannot_answer`.
- Llama a `POST http://{INTERNAL_HOST}:{INTERNAL_PORT}/internal/agent/query`
  con esa consulta y el `ticket` recibido, exactamente como lo haría el
  agente real (paso 3 del flujo).
- Redacta la respuesta como texto plantilla enumerando las primeras filas que
  Node ejecutó — **no** es un LLM, no interpreta nada: es la prueba de que el
  contrato funciona, no una demostración de calidad de respuesta.

No se usa en los tests automatizados (`tests/modules/assistant.test.ts` y
`tests/security/agente.test.ts` levantan su propio stub de `node:http` por
archivo): es exclusivamente para `npm run dev` + `npm run agent:mock` en
paralelo, la demo del hackathon y como referencia de implementación para
quien escriba el agente Python real.

---

## Pseudocódigo del bucle del agente (lado Python)

```python
def responder(pregunta, ticket, catalogo, limites, request_id):
    consultas_hechas = 0
    resultados = []

    while consultas_hechas < limites["maxQueries"]:
        siguiente = decidir_siguiente_consulta(pregunta, catalogo, resultados)
        if siguiente is None:
            break  # ya tengo lo que necesito, o no puedo formular mas

        r = requests.post(
            f"http://{INTERNAL_HOST}:{INTERNAL_PORT}/internal/agent/query",
            json={"ticket": ticket, "query": siguiente},
            headers={"X-Internal-Key": INTERNAL_API_KEY},
        )
        consultas_hechas += 1

        if r.status_code == 422:
            continue          # la consulta propuesta no vale: prueba otra formulacion
        if r.status_code in (401, 403, 429):
            break             # ticket agotado/invalido, o rate limit: no insistir
        resultados.append(r.json())

    if not resultados:
        return {"status": "cannot_answer", "answer": "No pude obtener datos para responder."}
    return {"status": "ok", "answer": redactar_respuesta(pregunta, resultados)}
```

`redactar_respuesta` compone el texto de `answer`; las filas que React
termina viendo no son las que Python acumula aquí, sino las que Node ejecutó
en cada llamada al puerto interno.
