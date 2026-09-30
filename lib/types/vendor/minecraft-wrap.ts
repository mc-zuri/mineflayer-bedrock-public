// minecraft-wrap's d.ts (1.10) omits `Wrap`, the name the package exports WrapServer under first
// (index.js: `Wrap: require('./lib/wrap_server')`); the e2e harness uses that name.
import type { WrapServer } from 'minecraft-wrap'

declare module 'minecraft-wrap' {
  export const Wrap: typeof WrapServer
}
