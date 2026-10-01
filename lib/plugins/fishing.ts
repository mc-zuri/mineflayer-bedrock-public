import { Vec3 } from 'vec3'
import { createDoneTask, createTask } from '../promise_utils.ts'
import type { Entity } from 'prismarine-entity'
import type { BotInternal } from '../types/internal.ts'

export default inject

function inject (bot: BotInternal): void {
  let bobberId = 90
  // Before 1.14 the bobber entity keep changing name at each version (but the id stays 90)
  // 1.14 changes the id, but hopefully we can stick with the name: fishing_bobber
  // the alternative would be to rename it in all version of mcData
  if (bot.supportFeature('fishingBobberCorrectlyNamed')) {
    bobberId = bot.registry.entitiesByName.fishing_bobber.id
  }

  let fishingTask = createDoneTask()
  // The bobber's entity id. The entity is looked up when needed: this spawn_entity listener can run
  // before the entities plugin's one, which creates it (when that plugin is replaced through options.plugins
  // or loaded later, it is injected after this one).
  let lastBobberId: number | null | undefined = null

  bot._client.on('spawn_entity', (packet) => {
    // A fishing hook's objectData is its owner's entity id (vanilla, all versions): another player's
    // bobber spawning while this bot casts is not ours.
    if (packet.type === bobberId && packet.objectData === bot.entity.id && !fishingTask.done && lastBobberId == null) {
      lastBobberId = packet.entityId
    }
  })

  bot._client.on('world_particles', (packet) => {
    if (lastBobberId == null || fishingTask.done) return
    const lastBobber: Entity | undefined = bot.entities[lastBobberId]
    if (!lastBobber) return

    const pos = lastBobber.position

    const bobberCondition = bot.registry.supportFeature('updatedParticlesPacket')
      ? ((packet.particle!.type === 'fishing' || packet.particle!.type === 'bubble') && packet.amount === 6 && pos.distanceTo(new Vec3(packet.x, pos.y, packet.z)) <= 1.23)
      // This "(particles.fishing ?? particles.bubble).id" condition doesn't make sense (these are both valid types)
      : (packet.particleId === (bot.registry.particlesByName.fishing ?? bot.registry.particlesByName.bubble).id && packet.particles === 6 && pos.distanceTo(new Vec3(packet.x, pos.y, packet.z)) <= 1.23)

    if (bobberCondition) {
      bot.activateItem()
      lastBobberId = undefined
      fishingTask.finish()
    }
  })
  bot._client.on('entity_destroy', (packet) => {
    if (lastBobberId == null) return
    if (packet.entityIds.some(id => id === lastBobberId)) {
      lastBobberId = undefined
      fishingTask.cancel(new Error('Fishing cancelled'))
    }
  })

  async function fish () {
    if (!fishingTask.done) {
      fishingTask.cancel(new Error('Fishing cancelled due to calling bot.fish() again'))
    }

    fishingTask = createTask()

    bot.activateItem()

    await fishingTask.promise
  }

  bot.fish = fish
}
