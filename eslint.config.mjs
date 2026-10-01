import neostandard from 'neostandard'

export default [
  ...neostandard({
    ts: true,
    ignores: ['test/server_*/**', 'versions/**', 'server_jars/**']
  }),
  {
    files: ['**/*.ts'],
    rules: {
      // same options as standard 17
      '@typescript-eslint/no-use-before-define': ['error', { functions: false, classes: false, variables: false, allowNamedExports: true }],
      // tsc already rejects real redeclarations; an interface plus a value of the same name
      // (e.g. the ScoreBoard type and its loader) is valid TypeScript
      '@typescript-eslint/no-redeclare': 'off'
    }
  }
]
