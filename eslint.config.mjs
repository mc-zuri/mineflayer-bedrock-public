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
      '@typescript-eslint/no-use-before-define': ['error', { functions: false, classes: false, variables: false, allowNamedExports: true }]
    }
  }
]
