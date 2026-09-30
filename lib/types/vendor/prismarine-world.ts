// prismarine-world's d.ts says WorldSync.raycast returns a RaycastResult ({ x, y, z, face, intersect });
// the implementation (src/worldsync.js) returns the Block itself. Without a matcher it sets
// block.face and block.intersect from the hit; with a matcher it returns the matched block untouched,
// and the matcher is also given the RaycastIterator.
import type { Vec3 } from 'vec3'
import type { Block } from 'prismarine-block'
import type { RaycastIterator, BlockFace } from 'prismarine-world/types/iterators'

export type RaycastMatcher = (block: Block, iterator: RaycastIterator) => boolean

/** block returned by WorldSync.raycast; face/intersect are only set when no matcher is given */
export type RaycastHitBlock = Block & { face?: BlockFace, intersect?: Vec3 }

declare module 'prismarine-world/types/world' {
  interface WorldSync {
    raycast (from: Vec3, direction: Vec3, range: number, matcher?: RaycastMatcher | null): RaycastHitBlock | null
  }
}

// index.js is `module.exports = loader; module.exports.iterators = ...`, so the default import carries
// `iterators`, but the d.ts only declares it as a named export (an augmentation cannot add it to the
// default export). Cast the default import to this type to reach it.
export type PrismarineWorldDefault = typeof import('prismarine-world').default & { iterators: typeof import('prismarine-world/types/iterators') }
