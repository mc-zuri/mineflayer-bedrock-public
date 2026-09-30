// What mineflayer calls on prismarine-chunk's Java (PC) chunk columns that its d.ts gets wrong or leaves
// out (src/pc/<version>/ChunkColumn.js, src/pc/common/CommonChunkColumn.js).
import type { NBT } from 'prismarine-nbt'
import type { Int64, Vec3Like } from '../protocol.ts'

declare module 'prismarine-chunk' {
  interface PCChunk {
    /** bitMap: section mask before 1.17, i64 mask array in 1.17, not read 1.18+ */
    load (data: Buffer, bitMap?: number | Int64[], skyLightSent?: boolean, fullChunk?: boolean): void
    /** 1.17+: the light arrays and i64 masks as the packets carry them */
    loadParsedLight? (skyLight: number[][], blockLight: number[][], skyLightMask: Int64[], blockLightMask: Int64[], emptySkyLightMask: Int64[], emptyBlockLightMask: Int64[]): void
    /** pos is relative to the chunk column */
    setBlockEntity (pos: Vec3Like, tag: NBT | undefined): void
  }
}
