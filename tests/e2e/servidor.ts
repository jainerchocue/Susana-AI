import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { urlBaseDatosE2E } from './entorno';

/**
 * Arranca `src/server.ts` como PROCESO HIJO real (E0: "nada de supertest ni
 * de createApp() en memoria"). Lo consumen el global setup y cualquier tarea
 * que necesite su propio servidor con otra configuracion (p.ej. limites.e2e).
 */

const RAIZ = path.resolve(__dirname, '..', '..');
const SCRIPT_SERVIDOR = path.join(RAIZ, 'src', 'server.ts');
/**
 * `src/config/env.ts` llama a `process.loadEnvFile('<cwd>/.env')` y RELLENA
 * cualquier variable ausente con lo que encuentre ahi -- incluida `AGENT_URL`,
 * aunque la hayamos borrado del `env` que le pasamos al hijo. La unica forma
 * de que el hijo arranque de verdad "sin AGENT_URL" es que ese `.env` no
 * exista en su cwd: por eso el proceso hijo arranca aqui (`tests/e2e`, sin
 * `.env` propio) y no en la raiz del repo. `--import tsx` sigue resolviendo
 * bien: Node busca `node_modules` subiendo desde el cwd y encuentra el de la
 * raiz igual. El resto de rutas del codigo son relativas al archivo
 * (`__dirname`) o absolutas, asi que no les afecta este cambio de cwd.
 */
const CWD_SERVIDOR = path.join(RAIZ, 'tests', 'e2e');
const TIMEOUT_ARRANQUE_MS = 60_000;
const INTERVALO_REINTENTO_MS = 300;
const TIMEOUT_PARADA_MS = 15_000;
/** Cuanta salida del proceso hijo se conserva para el mensaje de error. */
const MAX_SALIDA_CONSERVADA = 8_000;

export interface OpcionesServidor {
  puerto: number;
  env?: Record<string, string>;
}

export interface ServidorIniciado {
  url: string;
  internalUrl: string;
  detener(): Promise<void>;
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Variables con las que arranca el servidor E2E. `PASSWORD_BREACH_CHECK` y
 * `MAIL_ENABLED` en false porque E0 deja fuera de alcance el correo y no hay
 * salida a internet garantizada en la corrida; sin `AGENT_URL` porque el chat
 * tambien queda fuera. Limites altos: los reales los prueba `limites.e2e.test.ts`
 * en un servidor propio.
 *
 * `CORS_ORIGINS` se fija a proposito a `ORIGEN` (`cliente.ts`), el mismo
 * origen que manda toda la suite en la cabecera `Origin`: sin esto, el hijo
 * hereda el `CORS_ORIGINS` del `.env` de quien corra los tests (valor de
 * conveniencia para `npm run dev`, no un origen real) y, si ese valor es `*`,
 * dos cosas se rompen a la vez -- `verificarOrigen` rechaza SIEMPRE `*`
 * (CLAUDE.md §15: "'*' nunca se acepta aqui"), asi que toda mutacion
 * autenticada por cookie responde 403 "Origen no permitido"; y `app.ts`
 * trata `CORS_ORIGINS` con `*` como `origin: true` (refleja cualquier
 * origen), que es precisamente lo que `salud.e2e.test.ts` comprueba que NO
 * pase con un origen no permitido.
 */
function construirEnv(puerto: number, extra?: Record<string, string>): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = { ...process.env };
  delete base.AGENT_URL;

  return {
    ...base,
    NODE_ENV: 'development',
    PORT: String(puerto),
    INTERNAL_PORT: String(puerto + 1),
    API_URL: `http://localhost:${puerto}`,
    DATABASE_URL: urlBaseDatosE2E(),
    MAIL_ENABLED: 'false',
    PASSWORD_BREACH_CHECK: 'false',
    LOG_LEVEL: 'warn',
    CORS_ORIGINS: 'http://localhost:5173',
    RATE_LIMIT_MAX: '100000',
    AUTH_RATE_LIMIT_MAX: '100000',
    AUTH_SIGNIN_MAX: '100000',
    AUTH_MFA_MAX: '100000',
    ...extra,
  };
}

/** Espera a que el proceso responda 200 en `/health/ready`, o falla con su salida reciente. */
async function esperarListo(
  url: string,
  prefijo: string,
  proceso: ChildProcess,
  yaMurio: () => boolean,
  salida: () => string,
): Promise<void> {
  const desde = Date.now();
  while (Date.now() - desde < TIMEOUT_ARRANQUE_MS) {
    if (yaMurio()) {
      throw new Error(`El servidor E2E murio antes de arrancar.\n${salida()}`);
    }
    try {
      const respuesta = await fetch(`${url}${prefijo}/health/ready`, { signal: AbortSignal.timeout(2000) });
      if (respuesta.status === 200) return;
    } catch {
      // El puerto aun no acepta conexiones o la BD no esta lista: se reintenta.
    }
    await esperar(INTERVALO_REINTENTO_MS);
  }
  proceso.kill('SIGKILL');
  throw new Error(
    `El servidor E2E no respondio 200 en ${prefijo}/health/ready tras ${TIMEOUT_ARRANQUE_MS}ms.\n${salida()}`,
  );
}

/**
 * Arranca `src/server.ts` (los DOS puertos, jobs y timeouts reales) y espera a
 * que este listo. `detener()` manda SIGTERM, espera la salida y remata con
 * SIGKILL si no llega a tiempo: los dos puertos deben quedar libres siempre,
 * incluso si un test dejo el servidor en mal estado.
 */
export async function iniciarServidor(opts: OpcionesServidor): Promise<ServidorIniciado> {
  const env = construirEnv(opts.puerto, opts.env);
  const prefijo = env.API_PREFIX ?? '/api/v1';

  let salidaAcumulada = '';
  const registrar = (chunk: Buffer): void => {
    salidaAcumulada = (salidaAcumulada + chunk.toString()).slice(-MAX_SALIDA_CONSERVADA);
  };

  const proceso = spawn(process.execPath, ['--import', 'tsx', SCRIPT_SERVIDOR], {
    cwd: CWD_SERVIDOR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let muerto = false;
  proceso.once('exit', () => {
    muerto = true;
  });
  proceso.stdout.on('data', registrar);
  proceso.stderr.on('data', registrar);

  const url = `http://localhost:${opts.puerto}`;
  const internalUrl = `http://${env.INTERNAL_HOST ?? '127.0.0.1'}:${opts.puerto + 1}`;

  await esperarListo(
    url,
    prefijo,
    proceso,
    () => muerto,
    () => salidaAcumulada,
  );

  async function detener(): Promise<void> {
    if (muerto) return;
    proceso.kill('SIGTERM');
    const cerroLimpio = await new Promise<boolean>((resolve) => {
      const limite = setTimeout(() => resolve(false), TIMEOUT_PARADA_MS);
      proceso.once('exit', () => {
        clearTimeout(limite);
        resolve(true);
      });
    });
    if (!cerroLimpio) proceso.kill('SIGKILL');
  }

  return { url, internalUrl, detener };
}
