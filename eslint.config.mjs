import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const IGNORE_PATTERNS = [
  '**/.next/**',
  '**/.open-next/**',
  '**/.turbo/**',
  '**/.wrangler/**',
  '**/build/**',
  '**/coverage/**',
  '**/dist/**',
  '**/node_modules/**',
  '**/playwright-report/**',
  '**/storybook-static/**',
  '**/test-results/**',
  '**/cloudflare-env.d.ts',
  '**/package-lock.json',
  'pnpm-lock.yaml',
];

const TYPESCRIPT_FILES = ['**/*.{ts,tsx,mts,cts}'];

const recommendedTypeScriptConfigs = tseslint.configs.recommended.map((config) => ({
  ...config,
  files: config.files ?? TYPESCRIPT_FILES,
}));

export default tseslint.config(
  {
    ignores: IGNORE_PATTERNS,
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        ...globals.es2022,
        ...globals.node,
      },
    },
  },
  ...recommendedTypeScriptConfigs,
  {
    files: TYPESCRIPT_FILES,
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2022,
        ...globals.node,
        ...globals.serviceworker,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-use-before-define': 'off',
      'no-console': 'off',
      'no-empty': 'off',
      'no-undef': 'off',
      'no-useless-assignment': 'off',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      'react-refresh/only-export-components': ['error', {allowConstantExport: true}],
    },
  },
  {
    files: ['**/*.{test,spec}.{ts,tsx}', '**/test/**/*.ts', '**/test/**/*.tsx', '**/e2e/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.vitest,
      },
    },
  },
);
