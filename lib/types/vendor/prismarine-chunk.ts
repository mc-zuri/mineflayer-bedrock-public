// What mineflayer calls on prismarine-chunk's Java (PC) chunk columns that its d.ts gets wrong or leaves
// out (src/pc/<version>/ChunkColumn.js, src/pc/common/CommonChunkColumn.js).
import type { NBT } from 'prismarine-nbt'
import type { Int64, LightMask, Vec3Like } from '../protocol.ts'

/** what a 1.17+ column's dumpLight() returns: the light packets' arrays, masks as [hi, lo] pairs */
export interface PCChunkLightDump {
  skyLight: Uint8Array[]
  blockLight: Uint8Array[]
  skyLightMask: Array<[number, number]>
  blockLightMask: Array<[number, number]>
  emptySkyLightMask: Array<[number, number]>
  emptyBlockLightMask: Array<[number, number]>
}

declare module 'prismarine-chunk' {
  interface PCChunk {
    /** bitMap: section mask before 1.17, i64 mask array in 1.17, not read 1.18+ */
    load (data: Buffer, bitMap?: number | Int64[], skyLightSent?: boolean, fullChunk?: boolean): void
    /** 1.17+: the light arrays and i64 masks as the packets carry them */
    loadParsedLight? (skyLight: number[][], blockLight: number[][], skyLightMask: LightMask, blockLightMask: LightMask, emptySkyLightMask: LightMask, emptyBlockLightMask: LightMask): void
    /** undefined before 1.14, the light sections as one Buffer 1.14 – 1.16, the light packets' arrays and [hi, lo] masks 1.17+ */
    dumpLight (): undefined | Buffer | PCChunkLightDump
    /** before 1.13: the block's metadata (a number; the d.ts says Buffer) */
    setBlockData (pos: Vec3Like, data: number): void
    /** pos is relative to the chunk column */
    setBlockEntity (pos: Vec3Like, tag: NBT | undefined): void
  }
}
