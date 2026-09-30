// Members mineflayer (entities.ts, physics.ts via prismarine-physics) sets on prismarine-entity
// Entities that prismarine-entity's d.ts does not declare.
// Not fixable here: the d.ts types `vehicle` as Entity, but the constructor sets it to null and
// mineflayer sets it to null on dismount.
import type { Item } from 'prismarine-item'
import type { Entity } from 'prismarine-entity'
import type { EntityAttribute } from '../protocol.ts'

declare module 'prismarine-entity' {
  interface Entity {
    /** set for players (entities.ts); 0 until then */
    eyeHeight: number
    headYaw?: number
    headPitch?: number
    crouching?: boolean
    /** entity_update_attributes, keyed by attribute key */
    attributes?: { [key: string]: { value: number, modifiers: EntityAttribute['modifiers'] } }
    /** always undefined: named_entity_spawn has no `data` field in any version */
    dataBlobs?: unknown
    /** 'thunderbolt' for spawn_entity_weather (1.8 – 1.15) */
    globalType?: string
    // physics state written by prismarine-physics PlayerState.apply (bot entity only)
    isInWater?: boolean
    isInLava?: boolean
    isInWeb?: boolean
    isCollidedHorizontally?: boolean
    isCollidedVertically?: boolean
    /** null clears the slot */
    setEquipment (index: number, item: Item | null): void
  }
}

/** the d.ts declares no default export; index.js is `module.exports = (registryOrVersion) => class Entity`.
 * Cast the default import: `(prismarineEntity as unknown as EntityLoader)(bot.version)` */
export type EntityLoader = (registryOrVersion: string | object) => typeof Entity
