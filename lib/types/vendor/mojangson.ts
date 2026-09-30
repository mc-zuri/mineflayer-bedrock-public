// mojangson ships no typings. Ambient declaration (no top-level import/export) of its API.
declare module 'mojangson' {
  import type { NBT } from 'prismarine-nbt'

  /** parses SNBT into a prismarine-nbt style tag tree */
  export function parse (text: string): NBT
  /** strips the type tags from a parsed tree */
  export function simplify (data: NBT): any
  export function stringify (data: NBT): string
  export function normalize (text: string): string

  const mojangson: { parse: typeof parse, simplify: typeof simplify, stringify: typeof stringify, normalize: typeof normalize }
  export default mojangson
}
