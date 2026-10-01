// minecraft-wrap's d.ts (1.10) omits `Wrap`, the name the package exports WrapServer under first
// (index.js: `Wrap: require('./lib/wrap_server')`); the e2e harness uses that name.
// `export {}` keeps this file a module, so the block below augments minecraft-wrap instead of replacing it
export {}

declare module 'minecraft-wrap' {
  export const Wrap: typeof WrapServer
}
