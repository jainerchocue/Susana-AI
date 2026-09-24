# Base de datos

PostgreSQL, gestionado solo por Prisma (`prisma/schema.prisma`, fuente de
verdad; migraciones en `prisma/migrations/`). Nada de SQL suelto fuera de
Prisma: ni siquiera para índices (ver la fila de trigramas en CLAUDE.md §15).

Extensión habilitada: `pg_trgm` (declarada en `schema.prisma`, no en un `.sql`
a mano: eso es exactamente lo que una migración posterior borraría como
"deriva").

La fase A cubre identidad, RBAC, auditoría y alertas. La fase B añade el
modelo `his_*`: datos clínicos reales del hospital (pacientes, ingresos,
triage, servicios, medicamentos/insumos, cirugías), importados desde
`data/raw/*.txt` (7 archivos, ignorados por git) con `npm run data:import`.
Son tablas de **solo lectura** para la API: nada las escribe desde un
controlador salvo `MedicationStock` (la registra FARMACIA por `PUT
/medications/:code/stock`, ver `docs/api.md`).

---

## Identidad (Better Auth)

Los modelos `User`/`Session`/`Account`/`Verification`/`TwoFactor` los exige
Better Auth: nombres y campos no son libres. Se regeneran con
`npx @better-auth/cli generate --config src/core/auth/auth.ts` tras tocar
plugins, nunca a mano.

| Tabla | Qué guarda |
|---|---|
| `users` | Perfil + `status` (`ACTIVE`/`SUSPENDED`/`DELETED`) y `deletedAt` propios (`additionalFields`, `input: false`: no llegan por mass assignment). Índices GIN trigrama en `email`/`name` para búsqueda `ILIKE` sin Seq Scan |
| `sessions` | Sesión activa: `token` (lo compara Better Auth), `expiresAt`, `ipAddress`, `userAgent` |
| `accounts` | Credencial por proveedor; con `providerId = "credential"` guarda el hash de contraseña en `password` (scrypt con semáforo, `core/security/password.ts`) — **nunca** en `users` |
| `verifications` | Tokens de un solo uso (verificación de correo, reset de contraseña), hasheados |
| `two_factors` | TOTP: `secret`/`backupCodes` cifrados con `BETTER_AUTH_SECRET`; `failedVerificationCount`/`lockedUntil` para el bloqueo por fuerza bruta del segundo factor |

CHECK a nivel de base (no lo gestiona Prisma, así que no puede desincronizarse
en un diff): `users_email_minusculas` (rechaza mayúsculas),
`users_borrado_coherente` (un `deletedAt` sin el `status` correspondiente es
un estado inconsistente).

---

## RBAC (nuestro)

Better Auth no conoce roles ni permisos: son estas cuatro tablas.

| Tabla | Qué guarda |
|---|---|
| `roles` | Nombre, descripción, `isSystem` (inmutable por API; los siembra `prisma/seed.ts` desde `SYSTEM_ROLES`) |
| `permissions` | Catálogo plano `recurso:accion` (`core/rbac/permissions.ts` → seed). CHECK `permissions_action_formato` |
| `user_roles` | Relación N:M usuario↔rol, con `assignedAt`/`assignedBy` |
| `role_permissions` | Relación N:M rol↔permiso |

Ver `docs/rbac.md` para el catálogo completo y el invariante de no-escalada.

---

## Auditoría

| Tabla | Qué guarda |
|---|---|
| `audit_logs` | Rastro append-only: `actorId` (sin FK, a propósito: sobrevive al borrado del actor), `actorEmail` (congelado en el momento del hecho), `action`, `targetType`/`targetId`, `metadata` (JSON, nunca contraseñas/tokens), `ip`, `userAgent`, `requestId` |

Trigger `audit_logs_inmutable`: rechaza `UPDATE` y `DELETE` en la tabla — un
atacante con acceso a la aplicación no puede borrar sus huellas. Índices por
`actorId`, `targetId`, `action` y `createdAt`, todos con la fecha en orden
descendente (son los patrones de consulta reales de `GET /audit`).

---

## Alertas (motor de reglas)

| Tabla | Qué guarda |
|---|---|
| `alerts` | Una alerta operativa: `type` (`LOW_STOCK`, `HIGH_OCCUPANCY`, `LONG_WAIT`, `DEMAND_SPIKE`, `SURGERY_CANCELLATIONS` — texto, no enum: el catálogo puede crecer en fase B sin migración), `severity` (`WARNING`/`CRITICAL`, sí enum), `status` (`OPEN`/`ACKNOWLEDGED`/`RESOLVED`, sí enum), `scope` (`medication`/`service`/`triage`/`surgery`, texto), `scopeId` (código HIS, texto plano, sin FK: los datos del HIS se importan aparte), `metric`/`value`/`threshold`/`message`, `firstSeenAt`/`lastSeenAt`, `acknowledgedBy`/`acknowledgedAt`, `resolvedAt` |

`type` y `scope` se validan en código (`modules/alerts/alerts.constants.ts`),
no con un CHECK ni un enum de Postgres, para no exigir una migración cada vez
que el catálogo de reglas crezca. `sincronizar()` identifica una alerta activa
por `(type, scopeId)`;
`// ponytail:` sin índice único parcial para esa clave — basta con que un solo
evaluador corra a la vez (el job periódico es fase B). Índices para los tres
patrones de consulta reales: por `(status, severity, lastSeenAt)` (listado por
defecto), por `(type, scopeId, status)` (la clave de `sincronizar`) y por
`(scope, status)` (filtrado por ámbito).

---

## Fase B — datos HIS (`his_*`)

Origen: extracto plano del sistema hospitalario (HIS) en `data/raw/*.txt`
(UTF-8, separador `|`, cabecera en la primera línea), fechas
`YYYY-MM-DD HH:MM:SS` en hora local de Colombia (**UTC-5 fijo, sin horario de
verano**: `HIS_ZONA_HORARIA = 'America/Bogota'`), entre 2026-05-01 y
2026-09-22. El análisis de estos archivos (B0, previo a cualquier modelo) dejó
las cifras y decisiones de esta sección; el importador (`src/scripts/
import-data.ts`) es idempotente (`createMany({ skipDuplicates: true })`) y se
relanza sin duplicar.

### Tablas y lo que de verdad hay en los datos

| Tabla | Filas reales | Qué guarda / hallazgos de B0 |
|---|---|---|
| `his_patients` (`Patient`) | 14.502 | PK `IdPaciente` (natural, no autoincrement). `NombrePaciente` (iniciales) **no se importa**: minimización de datos. 11 tipos de documento, sexo {Femenino, Masculino}, 5 regímenes, 27 departamentos, zona {Urbana, Rural} |
| `his_triages` (`Triage`) | 16.106 | De 17.781 filas del extracto, **1.675 llegan totalmente vacías** (una por cada ingreso sin triage) y se saltan al importar. `code` (25 valores) **no** es el nivel: el nivel 1–5 sale del texto de `classification` con `/TRIAGE\s*([1-5])/` (en los datos reales solo aparecen 1 a 4). Signos vitales fuera de rango (`0/0`, FC `1154`, T° `3636`) se guardan como `null`. `patientId` es huérfano en 4 filas (paciente fuera del extracto): se guardan con `patientId: null` en vez de descartar el triage |
| `his_admissions` (`Admission`) | 17.781 | PK única, 0 huérfanos de paciente. `triageId` opcional (1.675 sin triage). 712 camas, **347 virtuales** (`bedName` contiene "VIRTUAL"), que ocupan 9.255 ingresos. `unit` = grupo de cama (URGENCIAS, HOSPITALIZACION, PEDIATRIA, RECUPERACION, GINECO OBSTRETICIA, UNIDAD DE CUIDADO BASICO/INTERMEDIO/INTENSIVO, SALA PARTOS). `riskType` normaliza variantes que solo difieren en mayúsculas. **No hay fecha de egreso**: los campos "derivados" (`firstCareAt`, `lastActivityAt`, `triageLevel`, `waitMinutes`, `stayHours`, `patientSex/Regime/Zone/Age`) los calcula una UPDATE de SQL estático al final del import, no la carga fila a fila |
| `his_procedures` (`Procedure`) | 2.061 códigos CUPS | Catálogo derivado de `his_service_records`: el nombre es el más frecuente entre las filas que comparten código (el HIS no trae maestro aparte) |
| `his_medications` (`Medication`) | 1.327 códigos | Catálogo derivado de `his_medication_dispenses`. `kind`: prefijo `DM…` → `insumo` (dispositivo médico); el resto (ATC, `NP…`) → `medicamento` |
| `his_service_records` (`ServiceRecord`) | 582.357 | PK única, sin huérfanos, cantidad siempre > 0. 72 áreas, 47 especialidades |
| `his_medication_dispenses` (`MedicationDispense`) | 579.465 | PK única, sin huérfanos, cantidad siempre > 0. **No hay stock** en el HIS |
| `his_surgery_schedules` (`SurgerySchedule`) | 12.770 (de 13.046 − 276 duplicados exactos) | **Sin FK** (ver más abajo). `executed` ∈ {`si`, `no`, `desconocido`}: `desconocido` = sin ingreso verificable en el extracto |
| `medication_stock` (`MedicationStock`) | la que registre FARMACIA | La única tabla `his_*`-adyacente que **sí** escribe la API (`PUT /medications/:code/stock`, `medications:manage`). Sin FK a `Medication`: se puede registrar stock de un código que aún no tiene dispensaciones |

### FK impuestas vs. no impuestas (B0, verificado contra los datos reales)

**FK reales, comprobadas sin huérfanos** (impuestas en `schema.prisma`):
`Admission → Patient`, `ServiceRecord → Admission`, `ServiceRecord →
Procedure`, `MedicationDispense → Admission`, `MedicationDispense →
Medication`. Una relación 1:1 opcional: `Admission.triageId → Triage` (con
`Triage → Patient` opcional aparte, porque 4 triages son huérfanos de
paciente).

**FK que el diccionario de datos declara pero los datos reales no cumplen, y
por eso NO se imponen**: `SurgerySchedule` hacia `Patient`/`Admission`. Cifras
verificadas: de 13.046 filas, `IdPaciente` cae fuera del extracto de
`Paciente` en **8.554**; `OidIngreso` está vacío en **2.404** y fuera del
extracto en **7.365** más. De las 3.277 filas con ingreso sí presente en el
extracto, 2.228 tienen su procedimiento en `ServiceRecord` del mismo ingreso
(= ejecución verificable). Por eso `SurgerySchedule.admissionId` es un `Int?`
sin relación declarada: la unidad del ingreso vinculado se resuelve con una
segunda consulta y se cruza en memoria (`surgeries.service.ts`), nunca con un
`include` de Prisma.

### Derivados (no vienen del HIS, los calcula el importador)

- **Ocupación = estimación**, no un dato directo: sin fecha de egreso, la
  estancia de un ingreso termina en su *última actividad registrada*
  (`lastActivityAt` = `max(providedAt)` en servicios y `max(dispensedAt)` en
  medicamentos de ese ingreso). El censo se calcula a las 23:59:59 hora
  Colombia. La capacidad son las camas **físicas** distintas de la unidad;
  los ingresos en cama virtual cuentan en el censo pero no en la capacidad,
  así que la ocupación **puede superar el 100 %** — con los datos reales,
  `HOSPITALIZACION` llega a 113,95 % y `PEDIATRIA` a 121,05 % (ver
  `docs/frontend.md` §7 para cómo pintarlo). Toda respuesta que la use declara
  `metodo: "censo_estimado_ultima_actividad"`.
- **Fecha de referencia** = `max(admittedAt)` de los datos (2026-09-21), nunca
  `now()`: los datos del extracto terminan ahí (`his.periodo.ts`,
  `fechaReferencia()`, cacheada 5 min en memoria).
- **Stock, días de inventario, rotación y riesgo de agotamiento**: no
  calculables con el HIS solo → `'insufficient_data'`, salvo que FARMACIA
  registre `MedicationStock` por API; entonces `daysOfInventory = stock /
  consumoMedioDiario(30 días)`. La **rotación** sigue siendo
  `'insufficient_data'` siempre: exigiría histórico de stock, que no existe.
- **Cirugía**: `executed` se calcula comparando `SurgerySchedule` con
  `ServiceRecord` del mismo ingreso (cuando el ingreso está en el extracto).
  Los porcentajes "ejecutada"/"sin ejecución registrada" se calculan **solo**
  sobre las verificables, nunca sobre el total (`unknown` queda aparte).
- Nunca sale un registro de paciente individual de la API: solo agregados.
  `MotivoConsulta` (texto libre del HIS) tampoco se importa.

### Importar los datos

```bash
npm run data:import                 # lee data/raw/*.txt (o --dir otra-carpeta)
```

Lectura en streaming (`node:readline`), sin dependencias nuevas. Valida que
la cabecera de cada archivo sea exactamente la esperada (si no, aborta con un
mensaje claro); normaliza con Zod por archivo (`trim`, vacío → `null`,
enteros, fechas con `-05:00`, `riskType` unificando mayúsculas, `level`
extraído de `classification`, `kind` por prefijo `DMT`/`DM`, `virtualBed` por
"VIRTUAL", signos vitales fuera de rango → `null`). Orden: pacientes →
triages → ingresos → atenciones (llena `firstCareAt`) → catálogos
`Procedure`/`Medication` → servicios → medicamentos → cirugías (deduplicadas
en memoria) → derivados por SQL estático. Imprime un resumen por archivo
(procesadas/insertadas/duplicadas/vacías/saltadas/inválidas/avisos) y deja
`data/import-report.json` con el detalle (primeros 20 errores por archivo,
**sin volcar datos de paciente**).

### Verificar contra los datos reales

```bash
npm run test:real                   # REAL_DATA=1 vitest run tests/real-data
```

Corre **solo** contra `hospital_local` (con `REAL_DATA=1`, `tests/setup.ts`
NO reescribe `DATABASE_URL`: usa la de `.env`), nunca contra las bases de
test normales (que usan fixtures pequeños en `tests/fixtures/his/`). Qué
garantiza cada archivo:

- `tests/real-data/conteos.test.ts`: los conteos de esta tabla (pacientes
  14.502, ingresos 17.781, triages 16.106, servicios 582.357, medicamentos
  579.465, cirugías 12.770, camas virtuales 347) y derivados (medianas de
  `waitMinutes` por nivel, `executed = 'si'` entre las verificables)
  calculados **leyendo los archivos crudos en el propio test**, nunca
  asumidos — si el importador o los datos cambian, el test lo detecta solo.
- `tests/real-data/asistente.test.ts`: un `count` por `unit` vía el asistente
  (dataset `admissions` del catálogo, `docs/agent-integration.md`) que cuadra
  con el conteo por unidad hecho a mano sobre los crudos.

Confirmado en este repositorio (`hospital_local`, verificado con `psql`):
14.502 / 17.781 / 16.106 / 582.357 / 579.465 / 12.770 filas exactas en las
seis tablas principales — coinciden con B0 al dígito.
