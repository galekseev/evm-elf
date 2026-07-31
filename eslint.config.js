import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';

const TS_FILES = ['**/*.ts'];

export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', 'coverage/**'],
  },
  { ...js.configs.recommended, files: TS_FILES },
  ...tsPlugin.configs['flat/recommended'].map((config) => ({ ...config, files: TS_FILES })),
  {
    files: TS_FILES,
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
    },
  },
];
