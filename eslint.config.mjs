import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import prettier from 'eslint-config-prettier/flat'
import importPlugin from 'eslint-plugin-import'

/**
 * Gaussian front-end standards: the KDevstream `.eslintrc.js` rule set in ESLint 9 flat config.
 * ESLint 9 no longer reads `.eslintrc.*`, and eslint-config-next 16 ships flat configs only, so its
 * `extends` map to the flat equivalents below:
 * - next/core-web-vitals, plugin:@typescript-eslint/recommended, plugin:import/recommended, prettier
 * - blank lines around declarations, blocks, comments and returns, and a grouped import order;
 *   `pnpm lint:fix` applies them
 * Formatting is Prettier's (`.prettierrc.json`).
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    name: 'gaussian/import-recommended',

    // Next registers the import plugin only for its own source extensions; register the same
    // object for every linted file (.cjs tooling included) so its rules apply everywhere.
    plugins: { import: nextVitals.find(config => config.plugins?.import).plugins.import },
    rules: importPlugin.flatConfigs.recommended.rules
  },
  prettier,
  {
    name: 'gaussian/rules',
    rules: {
      'jsx-a11y/alt-text': 'off',
      'react/display-name': 'off',
      'react/no-children-prop': 'off',
      '@next/next/no-img-element': 'off',
      '@next/next/no-page-custom-font': 'off',

      // Vitest's `importOriginal<typeof import('…')>()` mocks need `import()` type annotations.
      '@typescript-eslint/consistent-type-imports': ['error', { disallowTypeAnnotations: false }],
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-explicit-any': 'off',

      // A leading underscore marks a parameter or binding that is unused on purpose.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',

      // `ban-types` was split in typescript-eslint v8: recommended's no-wrapper-object-types and
      // no-unsafe-function-type still ban Object/Boolean/Number/String/Symbol/Function; `{}` stays allowed.
      '@typescript-eslint/no-empty-object-type': 'off',
      'lines-around-comment': [
        'error',
        {
          beforeBlockComment: true,
          beforeLineComment: true,
          allowBlockStart: true,
          allowObjectStart: true,
          allowArrayStart: true
        }
      ],
      'padding-line-between-statements': [
        'error',
        { blankLine: 'any', prev: 'export', next: 'export' },
        { blankLine: 'always', prev: ['const', 'let', 'var'], next: '*' },
        { blankLine: 'any', prev: ['const', 'let', 'var'], next: ['const', 'let', 'var'] },
        { blankLine: 'always', prev: '*', next: ['function', 'multiline-const', 'multiline-block-like'] },
        { blankLine: 'always', prev: ['function', 'multiline-const', 'multiline-block-like'], next: '*' }
      ],
      'newline-before-return': 'error',
      'import/newline-after-import': ['error', { count: 1 }],
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', ['internal', 'parent', 'sibling', 'index'], ['object', 'unknown']],
          pathGroups: [
            { pattern: 'react', group: 'external', position: 'before' },
            { pattern: 'next/**', group: 'external', position: 'before' },
            { pattern: '~/**', group: 'external', position: 'before' },
            { pattern: '@/**', group: 'internal' }
          ],
          pathGroupsExcludedImportTypes: ['react', 'type'],
          'newlines-between': 'always-and-inside-groups'
        }
      ]
    },
    settings: {
      // Next already sets React version detection, the import parsers and the node resolver.
      'import/resolver': { typescript: { project: './tsconfig.json', alwaysTryTypes: true } }
    }
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/explicit-module-boundary-types': 'off',

      // `no-var-requires` became `no-require-imports` in typescript-eslint v8.
      '@typescript-eslint/no-require-imports': 'off',

      // The compiler already checks namespace members (`pnpm typecheck`); this rule was ~75% of lint time.
      'import/namespace': 'off'
    }
  },
  globalIgnores([
    '**/dist/**',
    '**/.next/**',
    '**/.nuxt/**',
    '**/.output/**',
    'coverage/**',
    'packages/meridian/src/generated/**',
    '**/next-env.d.ts'
  ])
])

export default eslintConfig
