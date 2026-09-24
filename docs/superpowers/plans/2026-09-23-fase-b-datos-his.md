# Hospital Intelligence — Fase B: datos HIS

> **Para agentes:** lee `CLAUDE.md`, la sección **§0 Restricciones globales** del plan principal
> (`docs/superpowers/plans/2026-09-23-hospital-intelligence-backend.md`), la sección **B0** de este archivo y **tu tarea**.

---

## B0 — Hallazgos del análisis de los datos reales (verificados con los archivos)

Formato común: UTF-8, separador `|`, primera línea de cabecera, sin comillas y sin filas con número de columnas incorrecto.
Fechas `YYYY-MM-DD HH:MM:SS` en **hora local de Colombia (UTC−5, sin horario de verano)**, entre 2026-05-01 y 2026-09-22.

| Archivo | Filas | Hallazgos |
|---|---|---|
| Paciente | 14.502 | PK `IdPaciente` única. `NombrePaciente` son iniciales: **no se importa** (minimización). 11 tipos de documento, sexo {Femenino, Masculino}, 5 regímenes, 27 departamentos, zona {Urbana, Rural}. |
| Ingresos | 17.781 | PK única. 0 pacientes huérfanos. `OidTriageA` vacío en 1.675 filas, sin triages huérfanos. `FechaHospitalizacion` vacía en 7. Diagnóstico vacío en 406. 712 camas, **347 de ellas virtuales** (`NombreCama` contiene `VIRTUAL`), que ocupan 9.255 ingresos. Grupos de cama (= **unidad**): URGENCIAS, HOSPITALIZACION, PEDIATRIA, RECUPERACION, GINECO OBSTRETICIA, UNIDAD DE CUIDADO BASICO/INTERMEDIO/INTENSIVO, SALA PARTOS. `TipoRiesgo` tiene variantes que solo difieren en mayúsculas ("Accidente en el Hogar" / "Accidente en el hogar"). **No hay fecha de egreso.** |
| Triage | 17.781 | **1.675 filas totalmente vacías** (una por cada ingreso sin triage): se saltan. Quedan **16.106** triages reales. `IdPaciente2` huérfano en 4. `CodigoTriage` (25 códigos) **no es el nivel**: el nivel 1–5 está en el texto (`… TRIAGE 3 (VERDE)`); en los datos solo aparecen los niveles 1 a 4. Signos vitales con basura (`0/0`, `1/1`, FC `1154`, T `3636`): los valores fuera de rango se guardan como null. |
| Atencion | 17.375 | PK = FK a Ingresos (1:1), sin huérfanos. Los 16.106 ingresos con triage tienen atención. Espera triage→atención: ninguna negativa, mediana de unos 50 min. |
| Servicios | 582.357 | PK única, sin huérfanos, cantidad siempre > 0. 2.061 códigos CUPS, 72 áreas, 47 especialidades. |
| MedicamentoInsumo | 579.465 | PK única, sin huérfanos, cantidad siempre > 0, 1.327 códigos. Tipo: los códigos `DMT…` son dispositivos médicos (**insumo**); el resto (ATC, `NP…`) son **medicamentos**. **No hay stock.** |
| ProgramacionCirugia | 13.046 | Sin fecha. 276 filas duplicadas exactas. `IdPaciente` fuera del extracto en **8.554** y `OidIngreso` vacío en 2.404 y fuera del extracto en 7.365: **las FK del diccionario no se cumplen, así que no se imponen**. De las 3.277 filas con ingreso en el extracto, 2.228 tienen su código en Servicios del mismo ingreso (= ejecutada verificable). |

**Consecuencias de diseño (no negociables):**
- **Fecha de referencia** = `max(admittedAt)` de los datos (2026-09-21), no `now()`: los datos acaban ahí. Todo KPI acepta `desde/hasta`.
- **Ocupación = estimación.** Sin egreso, la estancia termina en la *última actividad registrada* (máx. de `FechaPrestacion` en servicios y medicamentos). Censo a las 23:59:59 locales. Capacidad = camas **físicas** distintas de la unidad. Los ingresos en camas virtuales cuentan en el censo, así que la ocupación **puede superar el 100 %** (el propio HIS habla de urgencias «colapsado a más del 200 %»). La respuesta declara `metodo: "censo_estimado_ultima_actividad"`.
- **Stock, días de inventario, rotación y riesgo de agotamiento:** no calculables con los datos → `"insufficient_data"`, salvo que FARMACIA registre el stock actual por API (`medications:manage`); entonces `daysOfInventory = stock / consumoMedioDiario(30 días)`. La rotación sigue siendo `insufficient_data` (exige histórico de stock).
- **Cirugía:** `executed` ∈ {`si`, `no`, `desconocido`} (`desconocido` = sin ingreso en el extracto). El % «sin ejecución registrada» se calcula solo sobre las verificables.
- Nunca sale un registro de paciente: solo agregados. `MotivoConsulta` (texto libre) no se importa.

## Esquema (lo crea T6; el resto lo consume)

Tablas `his_*` de solo lectura para la API. Columnas en camelCase, como el resto del esquema. Fechas y horas del HIS en
`@db.Timestamptz(3)`, guardadas como instante real (se parsea con `-05:00`).
```prisma
model Patient            { id Int @id; documentType String; birthDate DateTime @db.Date; sex String; insurer String; regime String;
                           department String; municipality String; zone String; admissions Admission[]; triages Triage[]   @@map("his_patients") }
model Triage             { id Int @id; triagedAt DateTime @db.Timestamptz(3); systolic Int?; diastolic Int?; heartRate Int?;
                           respiratoryRate Int?; temperature Float?; patientId Int?; code String; classification String; level Int?;
                           patient Patient? @relation(...); admission Admission?   @@index([triagedAt]) @@index([level]) @@map("his_triages") }
model Admission          { id Int @id; consecutive Int; patientId Int; admissionClass String; entryRoute String; riskType String;
                           admittedAt DateTime @db.Timestamptz(3); hospitalizedAt DateTime? @db.Timestamptz(3); triageId Int? @unique;
                           bedCode String; bedName String; unit String; subunit String; virtualBed Boolean;
                           diagnosisCode String?; diagnosisName String?;
                           // derivados post-importación:
                           firstCareAt DateTime? @db.Timestamptz(3); lastActivityAt DateTime? @db.Timestamptz(3);
                           triageLevel Int?; waitMinutes Float?; stayHours Float?;
                           patientSex String?; patientRegime String?; patientZone String?; patientAge Int?
                           @@index([admittedAt]) @@index([unit, admittedAt]) @@index([lastActivityAt]) @@index([triageLevel]) @@map("his_admissions") }
model Procedure          { code String @id; name String   @@map("his_procedures") }        // catálogo derivado de Servicios
model Medication         { code String @id; name String; kind String /* medicamento|insumo */   @@index([kind]) @@map("his_medications") }
model ServiceRecord      { id Int @id; admissionId Int; code String; quantity Int; providedAt DateTime @db.Timestamptz(3);
                           areaCode String; area String; specialty String
                           @@index([admissionId]) @@index([providedAt]) @@index([area, providedAt]) @@index([code]) @@map("his_service_records") }
model MedicationDispense { id Int @id; admissionId Int; code String; quantity Int; dispensedAt DateTime @db.Timestamptz(3);
                           area String; specialty String
                           @@index([code, dispensedAt]) @@index([dispensedAt]) @@index([admissionId]) @@map("his_medication_dispenses") }
model SurgerySchedule    { id Int @id @default(autoincrement()); scheduleNumber String; patientId Int; admissionId Int?;
                           procedureCode String; executed String /* si|no|desconocido */
                           @@index([scheduleNumber]) @@index([admissionId]) @@index([executed]) @@map("his_surgery_schedules") }
model MedicationStock    { code String @id; quantity Int; updatedBy String? @db.Uuid; createdAt DateTime @default(now()); updatedAt DateTime @updatedAt
                           @@map("medication_stock") }
```
FK reales (comprobadas sin huérfanos): Admission→Patient, Admission→Triage, Triage→Patient (4 huérfanos → null + aviso),
ServiceRecord→Admission, ServiceRecord→Procedure, MedicationDispense→Admission, MedicationDispense→Medication.
**SurgerySchedule sin FK** (comentario con las cifras). `MedicationStock.code` sin FK a Medication (FARMACIA puede registrar
stock de un código aún sin dispensaciones).

## Contratos compartidos

**`src/modules/his/his.periodo.ts`** (T6):
```ts
export const HIS_ZONA_HORARIA = 'America/Bogota'; // Colombia: UTC-5 fijo, sin horario de verano
export const periodoQuerySchema: z.ZodObject<{ desde: …optional; hasta: …optional }>  // z.coerce.date(); desde<=hasta; rango ≤ 366 días; NO .strict() (se compone con .extend().strict())
export async function fechaReferencia(): Promise<Date>   // max(admittedAt); caché en memoria 5 min; sin datos → AppError 503 EXTERNAL_SERVICE_ERROR "No hay datos HIS importados"
export async function resolverPeriodo(q: { desde?: Date; hasta?: Date }, diasPorDefecto = 30): Promise<{ desde: Date; hasta: Date }>
```
Agrupar por día en SQL: `date_trunc('day', col AT TIME ZONE ${HIS_ZONA_HORARIA})` (siempre parámetro, nunca concatenado).

**`src/core/http/csv.ts`** (T7):
```ts
/** Envía CSV como adjunto. Neutraliza la inyección de fórmulas (celdas que empiezan por = + - @ tab o CR) y escapa comillas. */
export function enviarCsv(res: Response, nombreArchivo: string, columnas: string[], filas: Record<string, unknown>[]): Response
```
Es una excepción documentada al contrato JSON (un adjunto, no una respuesta de API). Cabeceras: `Content-Type: text/csv; charset=utf-8`,
`Content-Disposition: attachment; filename="<nombre>.csv"` (nombre solo `[a-z0-9-]`), y `noStore`. Toda exportación se audita con `AUDIT.exportacion`.

**Métricas del motor de alertas** (T11 las conecta): `MetricPoint` de `alerts.engine.ts`, con scope `service` y scopeId = unidad,
`triage` y scopeId = `nivel-N`, `medication` y scopeId = code, `surgery` y scopeId = null.

---

## Olas de la fase B

| Ola | Tarea | Modelo | BD de tests | Depende de |
|---|---|---|---|---|
| B1 | T6 Datos: esquema, importación e importación real | Sonnet 5 | `hospital_test_c` (+ `hospital_local` con datos reales) | — |
| B1 | T7 Usuarios de prueba, correo y CSV | Sonnet 5 | `hospital_test_d` | — |
| B2 | T8 Dashboard y analytics (ocupación, espera, demanda) | Sonnet 5 | `hospital_test_c` | T6, T7 |
| B2 | T9 Medicamentos y cirugías | Sonnet 5 | `hospital_test_d` | T6, T7 |
| B2 | T10 Datasets HIS del asistente y agente simulado | Sonnet 5 | `hospital_test_e` | T6 |
| B3 | T11 Alertas conectadas, matriz RBAC, docs para el frontend y verificación | Sonnet 5 | `hospital_test` | B2 |

`hospital_local` es la BD de desarrollo con los datos reales (`.env`). Los tests normales usan **fixtures pequeños** en
`tests/fixtures/his/`; los tests contra los datos reales viven en `tests/real-data/` y solo corren con `npm run test:real`.

---

## T6 — Datos: esquema, importación y carga real (ola B1)

**Archivos:** `prisma/schema.prisma` (+ migración `his_data`), `src/modules/his/his.periodo.ts`, `src/scripts/import-data.ts`,
`tests/fixtures/his/*.txt` (7 archivos), `tests/modules/his-import.test.ts`, `tests/real-data/conteos.test.ts`,
`tests/setup.ts` (solo lo de `REAL_DATA`), `package.json` (scripts), `vitest.config.mts` si hace falta. Añadir en `tests/helpers.ts`:
`export async function cargarFixturesHis(): Promise<void>` (vacía las tablas his_* y carga `tests/fixtures/his`).

**Importador** (`src/scripts/import-data.ts`), exportando `importarDirectorio(dir: string): Promise<ResumenImportacion>` y con un
`main` para la CLI (`npm run data:import -- [--dir data/raw]`, `tsx`):
- Lectura en streaming con `node:readline`, **sin dependencias**. Comprueba que la cabecera sea exactamente la esperada; si no, aborta con un mensaje claro.
- Un esquema Zod por archivo: normaliza con `trim`, vacío → null, enteros, fechas con `-05:00`, `TipoRiesgo` unificando
  variantes de mayúsculas (conserva la forma más frecuente), `level` extraído con `/TRIAGE\s*([1-5])/`, `kind` por prefijo `DMT`,
  `virtualBed` por `VIRTUAL`, y signos vitales en rango (PAS 50–260, PAD 20–160, FC 20–250, FR 5–80, T 30–45) o null.
- Orden: pacientes → triages (saltando las filas vacías) → ingresos → atenciones (UPDATE de `firstCareAt` por lotes con
  `unnest(${ids}::int[], ${fechas}::timestamptz[])`) → catálogos `Procedure`/`Medication` (nombre más frecuente por código) →
  servicios → medicamentos → cirugías (deduplicadas en memoria) → derivados por SQL estático (`lastActivityAt`, `triageLevel`,
  `waitMinutes`, `stayHours`, `patientSex/Regime/Zone/Age`, `executed`).
- `createMany({ skipDuplicates: true })` en lotes de 5.000: **idempotente**; se puede relanzar sin duplicar.
- Resumen por consola por archivo (procesadas, insertadas, duplicadas, vacías saltadas, inválidas, avisos) y un informe JSON en
  `data/import-report.json` con los primeros 20 errores de cada archivo (número de línea + motivo, **sin volcar datos de paciente**).
- Scripts: `"data:import": "tsx src/scripts/import-data.ts"`, `"test:real": "REAL_DATA=1 vitest run tests/real-data"`.
  En `tests/setup.ts`, con `REAL_DATA=1` NO se fija `DATABASE_URL` (así se usa la de `.env`, que apunta a `hospital_local`).

**Tests**
- `tests/modules/his-import.test.ts` (`hospital_test_c`): fixtures de 5–20 filas por archivo diseñadas a mano, que incluyan una
  fila vacía de triage, un triage con vitales basura, un huérfano de `IdPaciente2`, una variante de mayúsculas de TipoRiesgo, un
  duplicado exacto de cirugía, una cirugía con ingreso fuera del extracto, un código `DMT` y una cabecera errónea en un
  directorio aparte. Aserciones exactas: conteos del resumen, derivados calculados a mano (`waitMinutes`, `stayHours`,
  `executed`, `level`, `patientAge`), idempotencia (2.ª importación: 0 insertadas) y cabecera errónea → error claro.
- `tests/real-data/conteos.test.ts` (`describe.runIf(process.env.REAL_DATA === '1')`): pacientes 14.502, ingresos 17.781,
  triages 16.106, ingresos con `firstCareAt` 17.375, servicios 582.357, medicamentos 579.465, cirugías 12.770 (13.046 − 276),
  camas virtuales 347, `executed='si'` entre las verificables = **2.228 menos las que se hayan deduplicado**. Calcula ese valor
  en el propio test leyendo los archivos crudos, nunca desde la BD. Y la mediana de `waitMinutes` por nivel = la calculada en el
  test leyendo los crudos (tolerancia 0,01).

**Carga real:** la BD `hospital_local` ya existe, migrada y sembrada. Tras crear la migración: `npx prisma migrate deploy` (con `.env`),
`npm run data:import`, `npm run test:real`. Reporta los tiempos y el resumen real.

---

## T7 — Usuarios de prueba, correo con Resend y CSV (ola B1)

**Archivos:** `prisma/seed.ts`, `src/config/env.ts`, `.env.example`, `src/core/http/csv.ts`, `tests/unit/csv.test.ts`,
`src/core/mail/*` solo si hace falta, `src/config/constants.ts`. **No toques** `tests/setup.ts`, `package.json` ni `schema.prisma` (son de T6).

- Env: `SEED_TEST_USERS` (bool, por defecto true; **en producción el `superRefine` exige false**), `SEED_TEST_PASSWORD`
  (≥12, por defecto `Prueba123!Hospital`, prohibido en producción), `SEED_DIRECTOR_EMAIL` (por defecto `director@hospital.test`)
  y `SEED_FARMACIA_EMAIL` (por defecto `farmacia@hospital.test`).
- Seed: si `SEED_TEST_USERS`, crea (idempotente, vía `auth.api.signUpEmail` como el superadmin) dos cuentas verificadas: **Director
  de prueba → DIRECTOR** y **Farmacia de prueba → FARMACIA**. Si ya existen, solo reasegura el rol. Sin sesiones abiertas.
  Imprime la tabla de accesos (correo, rol, "contraseña: la de SEED_TEST_PASSWORD"), nunca la contraseña.
- Correo: Resend ya es el transporte. Documenta en `.env.example` cómo activarlo: `MAIL_ENABLED=true`, `RESEND_API_KEY`, y que
  sin dominio verificado Resend solo permite `from = onboarding@resend.dev` y enviar **a la dirección de la cuenta de Resend**
  (así que para probar flujos de correo, `SEED_*_EMAIL` debe ser esa dirección, o hay que verificar un dominio).
  `MAIL_FROM_NAME` por defecto `Hospital Intelligence`.
- `csv.ts` según el contrato de arriba + test (inyección de fórmulas, comillas, saltos de línea y nombre de archivo saneado).
- Verifica el seed dos veces seguidas sobre `hospital_test_d` (idempotencia), luego lint/typecheck.

---

## T8 — Dashboard y analytics: ocupación, espera y demanda (ola B2)

**Archivos:** `src/modules/analytics/{analytics.routes.ts, analytics.controller.ts, analytics.schemas.ts, occupancy.service.ts,
wait-time.service.ts, demand.service.ts}`, `src/modules/dashboard/{dashboard.routes.ts, dashboard.controller.ts, dashboard.schemas.ts}`,
`tests/modules/dashboard.test.ts`, `tests/modules/analytics.test.ts`, bloques en `registry.ts`.
**Importante:** `analytics.routes.ts` NO puede tener rutas con parámetro en la raíz (`/:x`): T9 monta `/analytics/surgeries` en otro router.

| Ruta | Permisos (`requirePermissions`, mode all) | Contenido |
|---|---|---|
| `GET /dashboard/summary` | dashboard.read | periodo, `datosHasta`, ingresos (24 h / 7 d / periodo), censo y ocupación global, espera p50 (7 d), alertas abiertas por severidad **solo de los ámbitos visibles** (`alcancesPorPermiso`; ninguno → se omite el bloque) |
| `GET /dashboard/occupancy` | dashboard.read + services.read | por unidad: camas físicas, censo, ocupación %, ingresos en cama virtual; serie diaria; `metodo` |
| `GET /dashboard/wait-times` | dashboard.read + services.read | por nivel de triage: n, p50, p90 y media en minutos; serie diaria de p50 |
| `GET /dashboard/demand` | dashboard.read + services.read | ingresos por día y unidad, por vía de ingreso, perfil por hora (0–23), `demandChangePct` por unidad (7 d vs 7 d previos) |
| `GET /analytics/services` | analytics.read + services.read | volumen por área y especialidad (líneas, cantidad), top 10 procedimientos (código + nombre del catálogo), serie diaria |
| `GET /analytics/triage` | analytics.read + services.read | distribución por nivel y clasificación, perfil horario, espera por nivel (reusa wait-time.service) |
| `GET /analytics/services/export`, `GET /analytics/triage/export` | analytics.export + analytics.read + services.read | CSV con `enviarCsv` + `auditar(AUDIT.exportacion, { report, desde, hasta, filas })` |

Servicios exportados (T11 los usa para las alertas):
```ts
// occupancy.service.ts
export async function ocupacionPorUnidad(instante: Date): Promise<Array<{ unit: string; physicalBeds: number; census: number; occupancyPct: number | 'insufficient_data'; virtualCensus: number }>>
// wait-time.service.ts
export async function esperaPorNivel(desde: Date, hasta: Date): Promise<Array<{ level: number; n: number; p50: number; p90: number; avg: number }>>
// demand.service.ts
export async function cambioDemandaPorUnidad(hasta: Date): Promise<Array<{ unit: string; last7: number; prev7: number; changePct: number | 'insufficient_data' }>>
```
Reglas: `$queryRaw` con template tag; percentiles con `percentile_cont(…) WITHIN GROUP`; días en `HIS_ZONA_HORARIA`;
0 camas físicas → `'insufficient_data'`; prev7 = 0 → `'insufficient_data'`. Todo `COUNT` va `::int` y todo agregado decimal `::float8`.
Query de cada endpoint: `periodoQuerySchema.extend({...}).strict()`.
Tests con `cargarFixturesHis()` y cifras calculadas a mano desde los fixtures; 401 sin sesión; 403 para CONSULTA en
occupancy/analytics y 200 en summary; export → `text/csv`, fila `data.export` y 403 sin `analytics.export` (ANALISTA).

---

## T9 — Medicamentos y cirugías (ola B2)

**Archivos:** `src/modules/medications/{medications.routes.ts, medications.controller.ts, medications.service.ts, medications.schemas.ts}`,
`src/modules/surgeries/{surgeries.routes.ts (export const basePath = '/analytics/surgeries'), surgeries.controller.ts,
surgeries.service.ts, surgeries.schemas.ts}`, `src/core/audit/audit.ts` (añadir `stockActualizado: 'medication.stock.updated'`),
`tests/modules/medications.test.ts`, `tests/modules/surgeries.test.ts`, bloques en `registry.ts`.

| Ruta | Permisos | Contenido |
|---|---|---|
| `GET /medications` | medications.read | catálogo paginado (page/limit) con `search` (ILIKE escapado sobre el nombre) y `kind`: code, name, kind, cantidad y líneas del periodo, última dispensación, `stock`, `avgDailyConsumption` (30 d), `daysOfInventory` y `risk` (`CRITICAL`/`LOW`/`OK`), todos `'insufficient_data'` sin stock, y `rotation: 'insufficient_data'` |
| `GET /medications/critical` | medications.read | los de riesgo CRITICAL/LOW, ordenados por días de inventario; sin ningún stock registrado → `{ status: 'insufficient_data', reason, items: [] }` |
| `GET /medications/consumption` | medications.read | serie (día/semana) de cantidad, opcionalmente por `code`; top 10 del periodo; por área |
| `PUT /medications/:code/stock` | medications.manage | `{ quantity: int ≥ 0 }`; upsert en `MedicationStock` + `auditarEnTx(stockActualizado, { code, from, to })`; el code se valida con regex `^[A-Z0-9]{3,20}$` |
| `GET /analytics/surgeries` | analytics.read + surgeries.read | programaciones distintas, procedimientos, % con ingreso en el extracto, verificables: ejecutadas / sin ejecución registrada (%), desconocidas; top 10 códigos (nombre desde `Procedure` o null); por unidad del ingreso vinculado |
| `GET /analytics/surgeries/export` | analytics.export + analytics.read + surgeries.read | CSV + auditoría |

Servicios exportados para T11:
```ts
export async function diasInventario(referencia: Date): Promise<Array<{ code: string; name: string; daysOfInventory: number | 'insufficient_data' }>>
export async function pctSinEjecucion(): Promise<number | 'insufficient_data'>
```
`LOW`/`CRITICAL` con `env.ALERT_LOW_STOCK_DAYS` / `ALERT_CRITICAL_STOCK_DAYS`. Consumo medio = cantidad de los últimos 30 días hasta la referencia / 30;
si es 0 → `daysOfInventory: 'insufficient_data'`. Tests con fixtures y cifras a mano: sin stock → `insufficient_data`; PUT de FARMACIA →
200, auditoría y días correctos; DIRECTOR PUT → 403; code inválido → 422; FARMACIA en `/analytics/surgeries` → 403.

---

## T10 — Datasets HIS del asistente y agente simulado (ola B2)

**Archivos:** `src/modules/assistant/assistant.catalog.ts`, `src/modules/assistant/assistant.query.ts` (solo el grain con zona
horaria), `scripts/agent-mock.mjs`, `package.json` (script `agent:mock`), `tests/modules/assistant-his.test.ts`,
`tests/real-data/asistente.test.ts`.
Datasets nuevos (solo nombres lógicos hacia Python; descripciones en español que ayuden al LLM):
- `admissions` (services.read): dimensiones `unit, subunit, admission_class, entry_route, risk_type, diagnosis_code, diagnosis_name,
  triage_level (number), patient_sex, patient_regime, patient_zone, admitted_at (date), virtual_bed (string 'si'/'no' vía columna
  derivada o expresión: si no es trivial, omítela)`; medidas `wait_minutes, stay_hours, patient_age`.
- `services` (services.read): `area, area_code, specialty, code, provided_at (date)`; medida `quantity`.
- `medications` (medications.read): `code, area, specialty, dispensed_at (date)`; medida `quantity`. Si hace falta el nombre o el tipo,
  **no hay JOIN en el DSL**: documéntalo como límite y no lo inventes.
- `surgeries` (surgeries.read): `procedure_code, executed, schedule_number`; sin medidas (count / count_distinct).
- Grain de fecha en zona horaria: `date_trunc(${grain}, col AT TIME ZONE ${HIS_ZONA_HORARIA})` para columnas timestamptz.
- **`scripts/agent-mock.mjs`**: solo desarrollo, sin dependencias, `node:http` en `AGENT_MOCK_PORT` (8000). Implementa `GET /health` y
  `POST /v1/ask` (comprueba `X-Internal-Key` = `AGENT_API_KEY`). Elige una consulta DSL por palabras clave de la pregunta
  (medicamento → top de `medications` por cantidad; espera/triage → `admissions` con avg `wait_minutes` por `triage_level`;
  cirugía → `surgeries` count por `executed`; por defecto, `admissions` count por `unit`), **solo entre los datasets del catálogo
  recibido**; llama a `http://127.0.0.1:${INTERNAL_PORT}/internal/agent/query` con `INTERNAL_API_KEY` y el ticket, y responde un
  texto plantilla con las cifras. Carga `.env` con `process.loadEnvFile`. Script: `"agent:mock": "node scripts/agent-mock.mjs"`.
- Tests: `assistant-his.test.ts` (fixtures) valida los 4 datasets de punta a punta vía la API interna, incluido el grain por día en
  hora local; `real-data/asistente.test.ts` hace un count por `unit` sobre los datos reales que cuadra con el conteo por unidad de los crudos.

---

## T11 — Alertas conectadas, matriz RBAC, docs para el frontend y verificación (ola B3)

- `src/modules/alerts/alerts.metrics.ts`: construye los `MetricPoint[]` con los servicios de T8/T9 en la fecha de referencia →
  `evaluarReglas` → `sincronizar`. `src/modules/alerts/alerts.job.ts`: evalúa al arrancar y cada `ALERT_EVAL_INTERVAL_MINUTES`
  (env, 15; `ALERT_EVAL_ENABLED` false en tests), arrancado desde `server.ts` y parado en el apagado. `POST /alerts/evaluate`
  (alerts.manage) para disparar a mano + auditoría. Test con fixtures: se crean las alertas esperadas.
- Ampliar `tests/security/rbac-matriz.test.ts` con todos los endpoints nuevos (derivado de `SYSTEM_ROLES`, como el existente).
- OpenAPI completo (todas las rutas nuevas) y test de que `/internal` sigue fuera.
- Docs: `docs/database.md` (modelo HIS real, decisiones B0, cómo importar), `docs/api.md` (endpoints nuevos con ejemplos de
  respuesta reales tomados de `hospital_local`), **`docs/frontend.md`** (guía para React: arranque de los 3 procesos
  —API, agente simulado, front—, cliente de Better Auth con `credentials: 'include'`, Origin/CSRF, contrato de respuesta y
  códigos de error, usuarios de prueba y qué ve cada rol, pantalla a pantalla qué endpoint usar, cómo provocar alertas (PUT de
  stock + `POST /alerts/evaluate`), qué significa `insufficient_data` y cómo pintarlo) y README actualizado.
- Verificación final: lint, typecheck, `npm test`, `npm run test:real`, build y audit:prod, con cifras reales. Arranca `npm run dev`
  + `npm run agent:mock` y comprueba con curl el login de los dos usuarios de prueba y una pregunta al asistente de punta a punta.
