// A survival bot next to primed TNT: getExplosionDamages predicts the damage the server deals, and the explosion
// pushes the bot away, which the server agrees with (it never pulls the bot back).
import assert from 'assert'
import { Vec3 } from 'vec3'
import { onceWithCleanup } from '../../lib/promise_utils.ts'
import type { TestFunction } from './plugins/testCommon.ts'

const TNT_POWER = 4

export default (): TestFunction => async (bot) => {
  const ground = bot.test.groundY
  await bot.test.becomeSurvival()
  bot.creative.stopFlying()
  try {
    // a player who just joined is invulnerable for 60 ticks (ServerPlayer.spawnInvulnerableTime)
    await bot.waitForTicks(60)
    await onceWithCleanup(bot, 'physicsTick', { timeout: 5000, checkCondition: () => bot.entity.onGround })
    if (bot.health < 20) {
      const healed = onceWithCleanup(bot, 'health', { timeout: 5000, checkCondition: () => bot.health >= 20 })
      bot.chat(bot.registry.version['>=']('1.13') ? `/effect give ${bot.username} minecraft:instant_health 1 5` : `/effect ${bot.username} 6 1 5`)
      await healed
    }
    let corrections = 0
    const onCorrection = () => { corrections++ }
    bot.on('forcedMove', onCorrection)

    // the TNT 4.5 blocks east of the bot, which stands on the origin block
    const tntName = bot.registry.entitiesByName['tnt'] ? 'tnt' : 'PrimedTnt'
    const start = bot.entity.position.clone()
    const healthBefore = bot.health
    const exploded = onceWithCleanup(bot._client, 'explosion', { timeout: 10000 })
    bot.chat(`/summon ${tntName} ${start.x + 4.5} ${ground} ${start.z} {Fuse:30,fuse:30}`)
    const [packet] = await exploded
    const center = packet.center ?? { x: packet.x!, y: packet.y!, z: packet.z! }
    const at = new Vec3(center.x, center.y, center.z)
    // the damage the bot expects, where it stood when the TNT exploded (the server does not send the armor
    // attribute of a player without armor: give it the 0 it has)
    const unarmored = Object.assign(Object.create(Object.getPrototypeOf(bot.entity)), bot.entity, {
      attributes: { ...bot.entity.attributes, 'generic.armor': { value: 0, modifiers: [] } }
    })
    const predicted = bot.getExplosionDamages(unarmored, at, TNT_POWER)!
    // the knockback the packet carries pushes the bot away from the TNT (west)
    const knockback = packet.playerKnockback?.x ?? packet.playerMotionX ?? 0
    assert.ok(knockback < 0, `the explosion pushes the bot west, by ${knockback}`)
    // (the health may have come with the explosion)
    if (!(bot.health < healthBefore)) await onceWithCleanup(bot, 'health', { timeout: 5000, checkCondition: () => bot.health < healthBefore })
    const dealt = healthBefore - bot.health
    assert.ok(Math.abs(dealt - predicted) <= 1, `getExplosionDamages predicted ${predicted}, the server dealt ${dealt}`)

    // pushed west, then lands; the server agrees with every move
    await onceWithCleanup(bot, 'physicsTick', { timeout: 5000, checkCondition: () => bot.entity.onGround && bot.entity.velocity.x === 0 })
    assert.ok(bot.entity.position.x < start.x - 0.3, `the bot only went from ${start} to ${bot.entity.position}`)
    await bot.waitForTicks(20) // a correction would come within a second
    bot.off('forcedMove', onCorrection)
    assert.strictEqual(corrections, 0, 'the server pulled the bot back')
  } finally {
    await bot.test.becomeCreative()
  }
}
