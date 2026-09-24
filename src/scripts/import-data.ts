import '../bootstrap';
import fs from 'node:fs';
import path from 'node:path';
import { disconnectDatabase } from '../core/db/prisma';
import { importarDirectorio, type ResumenArchivo, type ResumenImportacion } from '../modules/his/his.import';

/**
 * Envoltorio fino de la CLI (`npm run data:import -- [--dir data/raw]`). Toda
 * la logica de importacion vive en `src/modules/his/his.import.ts` (TC1):
 * este archivo solo la invoca, imprime el resumen y lo vuelca a disco.
 *
 * Se reexportan `importarDirectorio`/`ResumenArchivo`/`ResumenImportacion`
 * porque `tests/helpers.ts` y `tests/modules/his-import.test.ts` los importan
 * desde AQUI: moverlos sin reexportarlos les habria roto el import.
 */
export { importarDirectorio, type ResumenArchivo, type ResumenImportacion };

function imprimirResumen(resumen: ResumenImportacion): void {
  process.stdout.write('\n=== Resumen de importacion HIS ===\n');
  for (const a of resumen.archivos) {
    process.stdout.write(
      `${a.archivo.padEnd(42)} procesadas=${a.procesadas} insertadas=${a.insertadas} ` +
        `duplicadas=${a.duplicadas} vacias=${a.vacias} invalidas=${a.invalidas}\n`,
    );
    for (const aviso of a.avisos) process.stdout.write(`  aviso: ${aviso}\n`);
  }
  process.stdout.write(`\nTiempo total: ${(resumen.ms / 1000).toFixed(1)} s\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const indiceDir = args.indexOf('--dir');
  const dir = indiceDir >= 0 ? (args[indiceDir + 1] ?? 'data/raw') : 'data/raw';

  const resumen = await importarDirectorio(dir);
  imprimirResumen(resumen);

  const rutaReporte = path.resolve(process.cwd(), 'data/import-report.json');
  fs.writeFileSync(rutaReporte, JSON.stringify(resumen, null, 2), 'utf-8');
  process.stdout.write(`\nInforme detallado: ${rutaReporte}\n`);
}

// Solo se ejecuta al invocar el archivo directamente (CLI), no cuando los
// tests importan `importarDirectorio`.
if (require.main === module) {
  main()
    .catch((error: unknown) => {
      process.stderr.write(`\nFallo la importacion: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    })
    .finally(() => {
      void disconnectDatabase();
    });
}
