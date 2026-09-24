import os from 'node:os';

/**
 * Se importa ANTES que nada. El threadpool de libuv se dimensiona la primera
 * vez que algo lo usa (crypto, fs, dns) y ya no cambia: si esto corriera
 * después, la variable no tendría efecto.
 *
 * Con 4 hilos por defecto, scrypt bloquea también las lecturas de disco y la
 * resolución DNS de Prisma (auditoría C-03).
 */
process.env.UV_THREADPOOL_SIZE ??= String(Math.max(8, os.cpus().length * 2));

export const THREADPOOL_SIZE = Number(process.env.UV_THREADPOOL_SIZE);
