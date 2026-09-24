#!/usr/bin/env node
/**
 * Gate de vulnerabilidades para CI.
 *
 * `npm audit` audita el LOCKFILE completo, no el arbol instalado: una CVE en el
 * CLI de Prisma o en vitest —que nunca se despliegan, porque el Dockerfile hace
 * `npm prune --omit=dev`— dejaba el gate en rojo de forma permanente. Un gate
 * que siempre falla se acaba desactivando, y entonces no protege de nada.
 *
 * Esto falla solo si la CVE es alcanzable desde `dependencies`. Lo demas se
 * imprime como aviso para que no se pierda de vista.
 *
 * ponytail: dos comandos de npm y un Set. No hace falta audit-ci ni otra
 * dependencia para cruzar dos listas.
 */
import { execFileSync } from 'node:child_process';

const BLOQUEANTES = new Set(['high', 'critical']);

function npmJson(args) {
  try {
    return JSON.parse(execFileSync('npm', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  } catch (error) {
    // npm audit y npm ls salen con codigo != 0 cuando encuentran algo; el JSON
    // sigue siendo valido y es justo lo que hay que leer.
    if (error.stdout) return JSON.parse(error.stdout);
    throw error;
  }
}

/** Nombres de todo paquete presente en el arbol de produccion. */
function paquetesDeProduccion() {
  const arbol = npmJson(['ls', '--omit=dev', '--all', '--json']);
  const vistos = new Set();
  const recorrer = (nodo) => {
    for (const [nombre, hijo] of Object.entries(nodo.dependencies ?? {})) {
      if (vistos.has(nombre)) continue;
      vistos.add(nombre);
      recorrer(hijo);
    }
  };
  recorrer(arbol);
  return vistos;
}

const prod = paquetesDeProduccion();
const auditoria = npmJson(['audit', '--json']);
const vulnerabilidades = Object.values(auditoria.vulnerabilities ?? {});

const bloqueantes = [];
const soloDesarrollo = [];

for (const v of vulnerabilidades) {
  if (!BLOQUEANTES.has(v.severity)) continue;
  (prod.has(v.name) ? bloqueantes : soloDesarrollo).push(v);
}

const linea = (v) => `  ${v.severity.padEnd(8)} ${v.name} (${v.range})`;

if (soloDesarrollo.length > 0) {
  console.log(`\n⚠ ${soloDesarrollo.length} CVE alta(s) solo en devDependencies (no se despliegan):`);
  for (const v of soloDesarrollo) console.log(linea(v));
  console.log('  Revisalas, pero no bloquean el build.');
}

if (bloqueantes.length > 0) {
  console.error(`\n✖ ${bloqueantes.length} CVE alta(s) en dependencias de PRODUCCION:`);
  for (const v of bloqueantes) console.error(linea(v));
  console.error('\nSe despliegan con la imagen. Actualiza o sustituye el paquete.');
  process.exit(1);
}

console.log(`\n✓ Sin CVE altas en dependencias de produccion (${prod.size} paquetes revisados).`);
