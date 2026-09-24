import js from '@eslint/js';
import ts from 'typescript-eslint';
import security from 'eslint-plugin-security';
import prettier from 'eslint-config-prettier';

/**
 * Reglas alineadas con CLAUDE.md: sin `any`, sin `@ts-ignore`, sin promesas
 * sueltas y sin `console.log` (el logger ya redacta secretos; console lo esquiva).
 */
export default ts.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'eslint.config.mjs'] },

  js.configs.recommended,
  ...ts.configs.strictTypeChecked,
  security.configs.recommended,

  {
    // Acotado a lo que esta en tsconfig.eslint.json. Sin `files`, el parser con
    // tipos se aplica tambien a scripts/*.mjs y falla al no encontrarlos en el
    // proyecto. Esos se lintan en el bloque de mas abajo, sin reglas de tipos.
    files: ['src/**/*.ts', 'tests/**/*.ts', 'prisma/**/*.ts', '*.mts'],
    languageOptions: {
      parserOptions: { project: ['./tsconfig.eslint.json'], tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // ── CLAUDE.md §11: TypeScript estricto ──────────────────────────────
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': 'allow-with-description' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
      // El `!` tras authenticate esta justificado: el middleware garantiza req.auth.
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // `return next(err)` es el idioma de Express y se lee mejor que
      // `{ next(err); return; }`. La regla aqui empeora el codigo.
      '@typescript-eslint/no-confusing-void-expression': 'off',
      // Express exige 4 argumentos en el manejador de errores aunque no use next.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Un generico de retorno (body<T>) es diseño intencionado, no un error.
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',

      // ── CLAUDE.md §7: seguridad ─────────────────────────────────────────
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'security/detect-object-injection': 'off', // demasiados falsos positivos con Record<string,…>
      'security/detect-non-literal-fs-filename': 'off', // el autoload construye rutas a proposito

      // ── CLAUDE.md §12: estilo ───────────────────────────────────────────
      complexity: ['warn', 15],
      'max-lines-per-function': ['warn', { max: 90, skipComments: true, skipBlankLines: true }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-param-reassign': 'error',
    },
  },

  // El seed y los scripts sí imprimen por consola: es su interfaz.
  {
    files: ['prisma/**/*.ts', 'scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },

  // Los tests usan aserciones y datos de relleno con libertad.
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      'max-lines-per-function': 'off',
    },
  },

  prettier,

  /**
   * Scripts de CI en JS plano de Node (scripts/audit-prod.mjs). Se lintan de
   * verdad —bugs, variables sin usar— pero sin las reglas que exigen tipos.
   */
  {
    files: ['scripts/**/*.mjs'],
    ...ts.configs.disableTypeChecked,
    languageOptions: {
      // ponytail: dos globals a mano en vez de añadir el paquete `globals`
      // para un unico script. Si aparecen mas, ya tocara instalarlo.
      globals: { console: 'readonly', process: 'readonly' },
    },
    // Sin bloque `rules` a proposito: definirlo aqui REEMPLAZARIA los de
    // disableTypeChecked (que apagan las reglas con tipos) y eslint reventaria
    // al cargar la primera de ellas sobre un archivo sin proyecto de tipos.
  },
);
