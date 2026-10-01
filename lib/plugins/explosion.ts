import { Vec3 } from 'vec3'
import type { Entity } from 'prismarine-entity'
import type { world } from 'prismarine-world'
import type { BotInternal } from '../types/internal.ts'
import type { Difficulty } from '../types/mineflayer.ts'

export default inject

// https://minecraft.wiki/w/Explosion
// vanilla ServerExplosion.getSeenPercent: the share of points of the entity's bounding box the explosion sees
function calcExposure (entity: Entity, explosionPos: Vec3, world: world.WorldSync) {
  const width = entity.width ?? 0.6 // a player's box when the entity's size is not known
  const height = entity.height ?? 1.8
  const minX = entity.position.x - width / 2
  const minY = entity.position.y
  const minZ = entity.position.z - width / 2
  const dx = 1 / (width * 2 + 1)
  const dy = 1 / (height * 2 + 1)
  const dz = 1 / (width * 2 + 1)

  const d3 = (1 - Math.floor(1 / dx) * dx) / 2
  const d4 = (1 - Math.floor(1 / dz) * dz) / 2

  let sampled = 0
  let exposed = 0
  const pos = new Vec3(0, 0, 0)
  for (let x = 0; x <= 1; x += dx) {
    for (let y = 0; y <= 1; y += dy) {
      for (let z = 0; z <= 1; z += dz) {
        pos.set(minX + x * width + d3, minY + y * height, minZ + z * width + d4)
        // (from the point to the explosion, like vanilla's clip: a point on a block's face is not behind it)
        const dir = explosionPos.minus(pos)
        const range = dir.norm()
        if (world.raycast(pos, dir.normalize(), range) === null) {
          exposed++
        }
        sampled++
      }
    }
  }
  return exposed / sampled
}

// https://minecraft.wiki/w/Armor#Damage_protection
function getDamageAfterAbsorb (damages: number, armorValue: number, toughness: number) {
  const var3 = 2 + toughness / 4
  const var4 = Math.min(Math.max(armorValue - damages / var3, armorValue * 0.2), 20)
  return damages * (1 - var4 / 25)
}

// https://minecraft.wiki/w/Attribute#Operations
function getAttributeValue (prop: NonNullable<Entity['attributes']>[string]) {
  let X = prop.value
  for (const mod of prop.modifiers) {
    if (mod.operation !== 0) continue
    X += mod.amount
  }
  let Y = X
  for (const mod of prop.modifiers) {
    if (mod.operation !== 1) continue
    Y += X * mod.amount
  }
  for (const mod of prop.modifiers) {
    if (mod.operation !== 2) continue
    Y += Y * mod.amount
  }
  return Y
}

// attribute keys: 1.9 – 1.15, 1.16 – 1.20.4 (namespaced ids), 1.20.5+ (minecraft-data names)
const ARMOR_KEYS = ['generic.armor', 'minecraft:generic.armor']
const ARMOR_TOUGHNESS_KEYS = ['generic.armorToughness', 'minecraft:generic.armor_toughness', 'generic.armor_toughness']

function findAttribute (entity: Entity, keys: string[]) {
  for (const key of keys) {
    const attribute = entity.attributes?.[key]
    if (attribute) return attribute
  }
  return undefined
}

function inject (bot: BotInternal): void {
  // Explosion.doExplosionA: (impact² + impact) / 2 * 8 * the diameter before 1.9, * 7 since
  const damageMultiplier = bot.registry.version['>=']('1.9') ? 7 : 8

  const difficultyValues: Record<Difficulty, number> = {
    peaceful: 0,
    easy: 1,
    normal: 2,
    hard: 3
  }

  bot.getExplosionDamages = (targetEntity, sourcePos, power, rawDamages = false) => {
    const distance = targetEntity.position.distanceTo(sourcePos)
    const radius = 2 * power
    if (distance >= radius) return 0
    const exposure = calcExposure(targetEntity, sourcePos, bot.world)
    const impact = (1 - distance / radius) * exposure
    let damages = Math.floor((impact * impact + impact) * damageMultiplier * power + 1)

    // The following modifiers are constant for the input targetEntity and doesnt depend
    // on the source position, so if the goal is to compare between positions they can be
    // ignored to save computations
    const armorAttribute = findAttribute(targetEntity, ARMOR_KEYS)
    if (!rawDamages && armorAttribute) {
      const armor = getAttributeValue(armorAttribute)
      const armorToughnessAttribute = findAttribute(targetEntity, ARMOR_TOUGHNESS_KEYS)
      const armorToughness = armorToughnessAttribute ? getAttributeValue(armorToughnessAttribute) : 0
      damages = getDamageAfterAbsorb(damages, armor, armorToughness)

      // TODO: protection enchantment and resistance effects

      if (targetEntity.type === 'player') damages *= difficultyValues[bot.game.difficulty] * 0.5
    } else if (!rawDamages && !armorAttribute) {
      return null
    }
    return Math.floor(damages)
  }
}
