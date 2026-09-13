module.exports = {
  plugins: ['@trivago/prettier-plugin-sort-imports'],
  arrowParens: 'always',
  bracketSpacing: false,
  printWidth: 100,
  semi: true,
  singleQuote: true,
  tabWidth: 2,
  trailingComma: 'all',
  importOrderSeparation: false,
  importOrderCaseInsensitive: true,
  importOrderSortSpecifiers: true,
  importOrderGroupNamespaceSpecifiers: true,
  importOrder: [
    'react',
    'next',
    '<THIRD_PARTY_MODULES>',
    '@tileflow/',
    '@/',
    '^[../../]',
    '^[../]',
    '^[./]',
  ],
  overrides: [
    {
      files: [
        'packages/core/src/native.ts',
        'packages/core/test/native*.test.ts',
        'packages/core/docs/native-resource-urls.md',
      ],
      options: {useTabs: true},
    },
  ],
};
