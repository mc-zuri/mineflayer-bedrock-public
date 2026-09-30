import { Vec3 } from 'vec3'
import prismarineWorld from 'prismarine-world'
import type { Entity } from 'prismarine-entity'
import type { BotInternal } from '../types/internal.ts'
import type { Shape } from 'prismarine-world/types/iterators'
import type { PrismarineWorldDefault, RaycastMatcher } from '../types/vendor/prismarine-world.ts'

const { RaycastIterator } = (prismarineWorld as PrismarineWorldDefault).iterators

export default (bot: BotInternal): void => {
  function getViewDirection (pitch: number, yaw: number): Vec3 {
    const csPitch = Math.cos(pitch)
    const snPitch = Math.sin(pitch)
    const csYaw = Math.cos(yaw)
    const snYaw = Math.sin(yaw)
    return new Vec3(-snYaw * csPitch, snPitch, -csYaw * csPitch)
  }

  bot.blockInSight = (maxSteps = 256, vectorLength = 5 / 16) => {
    const block = bot.blockAtCursor(maxSteps * vectorLength)
    if (block) return block
  }

  bot.blockAtCursor = (maxDistance = 256, matcher: RaycastMatcher | null = null) => {
    return bot.blockAtEntityCursor(bot.entity, maxDistance, matcher)
  }

  bot.entityAtCursor = (maxDistance = 3.5) => {
    const block = bot.blockAtCursor(maxDistance)
    maxDistance = block?.intersect!.distanceTo(bot.entity.position) ?? maxDistance // set: no matcher

    const entities = Object.values(bot.entities)
      .filter(entity => entity.type !== 'object' && entity.username !== bot.username && entity.position.distanceTo(bot.entity.position) <= maxDistance)

    const dir = new Vec3(-Math.sin(bot.entity.yaw) * Math.cos(bot.entity.pitch), Math.sin(bot.entity.pitch), -Math.cos(bot.entity.yaw) * Math.cos(bot.entity.pitch))
    const iterator = new RaycastIterator(bot.entity.position.offset(0, bot.entity.eyeHeight, 0), dir.normalize(), maxDistance)

    let targetEntity: Entity | null = null
    let targetDist = maxDistance

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]
      const w = entity.width / 2

      const shapes: Shape[] = [[-w, 0, -w, w, entity.height, w]]
      const intersect = iterator.intersect(shapes, entity.position)
      if (intersect) {
        const entityDir = entity.position.minus(bot.entity.position) // Can be combined into 1 line
        const sign = Math.sign(entityDir.dot(dir))
        if (sign !== -1) {
          const dist = bot.entity.position.distanceTo(intersect.pos)
          if (dist < targetDist) {
            targetEntity = entity
            targetDist = dist
          }
        }
      }
    }

    return targetEntity
  }

  bot.blockAtEntityCursor = (entity = bot.entity, maxDistance = 256, matcher: RaycastMatcher | null = null) => {
    // pitch and yaw 0 (looking straight ahead, north) are valid
    if (!entity.position || !entity.height || entity.pitch == null || entity.yaw == null) return null
    const { position, height, pitch, yaw } = entity

    const eyePosition = position.offset(0, height, 0)
    const viewDirection = getViewDirection(pitch, yaw)

    return bot.world.raycast(eyePosition, viewDirection, maxDistance, matcher)
  }
}
