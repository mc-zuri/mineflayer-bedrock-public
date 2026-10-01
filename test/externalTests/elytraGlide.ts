// Gliding as a player does it: jump in the air with an elytra on (since 1.15 the client starts the glide itself,
// before it asks the server), then a firework rocket boosts the glide while it flies; the server agrees.
import assert from 'assert'
import { Vec3 } from 'vec3'
import prismarineItem from 'prismarine-item'
import { onceWithCleanup } from '../../lib/promise_utils.ts'
import type { TestFunction } from './plugins/testCommon.ts'

export default (): TestFunction => async (bot) => {
  if (!bot.supportFeature('hasElytraFlying')) return
  // an earlier test's glide lasts until the server sees the bot on the ground (it stands at the origin)
  while (bot.entity.elytraFlying) await onceWithCleanup(bot, 'physicsTick', { timeout: 5000 })
  const Item = prismarineItem(bot.registry)
  await bot.test.setInventorySlot(6, new Item(bot.registry.itemsByName['elytra']!.id, 1))
  // (rockets attach to a gliding player, and boost it, since 1.11)
  const rockets = bot.supportFeature('fireworkNamePlural') || bot.supportFeature('fireworkNameSingular')
  const rocket = rockets ? bot.registry.itemsArray.find(item => item.displayName === 'Firework Rocket') : undefined
  if (rocket) await bot.test.setInventorySlot(36, new Item(rocket.id, 8))
  bot.setQuickBarSlot(0)
  await bot.test.teleport(bot.entity.position.offset(0, 60, 0))
  await bot.test.becomeSurvival()
  bot.creative.stopFlying()
  let corrections = 0
  const onCorrection = () => { corrections++ }
  try {
    await bot.look(bot.entity.yaw, 0, true)
    await onceWithCleanup(bot, 'physicsTick', { timeout: 5000, checkCondition: () => bot.entity.velocity.y < -0.2 })
    // (from here on: some servers answer the test's teleport with a second position packet)
    bot.on('forcedMove', onCorrection)
    // a jump in the air starts the glide
    const serverGlides = onceWithCleanup(bot, 'entityElytraFlew', { timeout: 5000, checkCondition: (entity) => entity === bot.entity })
    bot.setControlState('jump', true)
    await bot.waitForTicks(2)
    bot.setControlState('jump', false)
    if (bot.registry.version['>=']('1.15')) assert.ok(bot.entity.elytraFlying, 'the client starts the glide')
    await serverGlides.catch(() => {
      if (!bot.entity.elytraFlying) throw new Error('the bot never glided')
    })
    await bot.waitForTicks(10)
    assert.ok(bot.entity.elytraFlying)
    if (rocket) {
      // a rocket speeds the glide up (vanilla: toward 1.5 blocks a tick along the look)
      const before = Math.hypot(bot.entity.velocity.x, bot.entity.velocity.z)
      bot.activateItem()
      bot.deactivateItem()
      await onceWithCleanup(bot, 'usedFirework', { timeout: 5000 })
      await bot.waitForTicks(10)
      const boosted = Math.hypot(bot.entity.velocity.x, bot.entity.velocity.z)
      assert.ok(boosted > Math.max(before, 1), `the rocket took the glide from ${before} to ${boosted} blocks a tick`)
    }
    await bot.waitForTicks(20)
    assert.strictEqual(corrections, 0, 'the server pulled the gliding bot back')
  } finally {
    bot.off('forcedMove', onCorrection)
    bot.clearControlStates()
    await bot.test.becomeCreative()
    await bot.test.teleport(new Vec3(0.5, bot.test.groundY, 0.5))
  }
}
