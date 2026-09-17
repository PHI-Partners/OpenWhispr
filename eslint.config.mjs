import { join } from 'node:path';
import js from '@eslint/js';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default defineConfig(
  includeIgnoreFile(join(import.meta.dirname, '.gitignore'), { gitignoreResolution: true }),
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      // Type information comes from the tsconfig that includes each file: every linted file must belong to one.
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // tsc owns unused-code checks (noUnusedLocals / noUnusedParameters in tsconfig.base.json).
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
  },
  // Last, so it switches off every rule that would fight Prettier's formatting.
  eslintConfigPrettier,
);
