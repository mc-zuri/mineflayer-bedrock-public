// The controls on a real server: the server agrees with every move the physics makes (it never pulls the bot
// back with a teleport), and sees the bot sprint and sneak.
import assert from 'assert'
import { Vec3 } from 'vec3'
import { onceWithCleanup } from '../../lib/promise_utils.ts'
import type { TestBot, TestFunction } from './plugins/testCommon.ts'

// the speeds (blocks per tick) of a player on flat ground: walking, sprinting, sneaking
const WALK = 0.21585
const SPRINT = 0.28061
const SNEAK = 0.06475

/** a survival bot standing on the ground at the origin, facing -z; counts the server's corrections */
async function onTheGround (bot: TestBot) {
  await bot.test.becomeSurvival()
  bot.creative.stopFlying()
  await bot.look(0, 0, true)
  // a player sprints only with more than 6 food: earlier tests may have starved the bot
  if (!(bot.food > 6)) {
    const fed = onceWithCleanup(bot, 'health', { timeout: 5000, checkCondition: () => bot.food > 6 })
    bot.chat(bot.registry.version['>=']('1.13') ? `/effect give ${bot.username} minecraft:saturation 1 255` : `/effect ${bot.username} 23 1 255`)
    await fed
  }
  await onceWithCleanup(bot, 'physicsTick', { timeout: 5000, checkCondition: () => bot.entity.onGround })
  const corrections = { count: 0 }
  const onCorrection = () => { corrections.count++ }
  bot.on('forcedMove', onCorrection)
  return { corrections, done: () => bot.off('forcedMove', onCorrection) }
}

/** the horizontal speed over the next ticks */
async function speed (bot: TestBot, ticks = 10) {
  const start = bot.entity.position.clone()
  await bot.waitForTicks(ticks)
  const end = bot.entity.position
  return Math.hypot(end.x - start.x, end.z - start.z) / ticks
}

/** the server's view of the bot's shared flags (it sends a player its own entity data) */
function serverFlags (bot: TestBot): number {
  const flags = bot.entity.metadata[0]
  return typeof flags === 'number' ? flags : 0
}

async function serverSees (bot: TestBot, what: string, check: (flags: number) => boolean) {
  if (check(serverFlags(bot))) return
  await onceWithCleanup(bot, 'entityUpdate', { timeout: 5000, checkCondition: (entity) => entity === bot.entity && check(serverFlags(bot)) })
    .catch(() => { throw new Error(`the server never saw the bot ${what} (flags ${serverFlags(bot)})`) })
}

export default (): Record<string, TestFunction> => ({
  async walkSprintJump (bot) {
    const { corrections, done } = await onTheGround(bot)
    try {
      // not straight along an axis: on 1.13 the float sine of exactly north leaves a move across of 1e-16
      // blocks, which vanilla's collision drops and counts as hitting a wall, which stops the sprint
      await bot.look(0.2, 0, true)
      bot.setControlState('forward', true)
      await bot.waitForTicks(10)
      const walk = await speed(bot)
      assert.ok(Math.abs(walk - WALK) < 0.005, `walked ${walk} blocks a tick`)
      assert.ok(!bot.entity.sprinting)

      bot.setControlState('sprint', true)
      await bot.waitForTicks(10)
      const sprint = await speed(bot)
      assert.ok(Math.abs(sprint - SPRINT) < 0.005, `sprinted ${sprint} blocks a tick`)
      assert.ok(bot.entity.sprinting)
      await serverSees(bot, 'sprint', flags => (flags & 0x08) !== 0)

      // a sprint jump: up and down again, still sprinting
      bot.setControlState('jump', true)
      await onceWithCleanup(bot, 'physicsTick', { timeout: 2000, checkCondition: () => !bot.entity.onGround })
      bot.setControlState('jump', false)
      await onceWithCleanup(bot, 'physicsTick', { timeout: 2000, checkCondition: () => bot.entity.onGround })
      assert.ok(bot.entity.sprinting)

      bot.clearControlStates()
      await bot.waitForTicks(10)
      assert.ok(!bot.entity.sprinting)
      assert.strictEqual(await speed(bot, 5), 0)
      await serverSees(bot, 'stop sprinting', flags => (flags & 0x08) === 0)
      await bot.waitForTicks(20) // a correction would come within a second
      assert.strictEqual(corrections.count, 0, 'the server pulled the bot back')
    } finally {
      bot.clearControlStates()
      done()
    }
  },

  async sneak (bot) {
    const { corrections, done } = await onTheGround(bot)
    try {
      bot.setControlState('sneak', true)
      await serverSees(bot, 'sneak', flags => (flags & 0x02) !== 0)
      // the sprint key does nothing while sneaking
      bot.setControlState('sprint', true)
      bot.setControlState('forward', true)
      await bot.waitForTicks(10)
      const sneak = await speed(bot)
      assert.ok(Math.abs(sneak - SNEAK) < 0.005, `sneaked ${sneak} blocks a tick`)
      assert.ok(!bot.entity.sprinting)
      bot.clearControlStates()
      await serverSees(bot, 'stop sneaking', flags => (flags & 0x02) === 0)
      await bot.waitForTicks(20)
      assert.strictEqual(corrections.count, 0, 'the server pulled the bot back')
    } finally {
      bot.clearControlStates()
      done()
    }
  },

  async sneakStopsAtEdges (bot) {
    // a 1 block high platform: the sneaking bot stops at its edge, a walking one falls off
    const ground = bot.test.groundY
    const { corrections, done } = await onTheGround(bot)
    try {
      bot.chat(`/fill -1 ${ground} -3 1 ${ground} 1 stone`)
      await bot.test.awaitCommandsProcessed('platform-built')
      await bot.test.teleport(new Vec3(0.5, ground + 1, 0.5))
      await onceWithCleanup(bot, 'physicsTick', { timeout: 5000, checkCondition: () => bot.entity.onGround })
      bot.setControlState('sneak', true)
      bot.setControlState('forward', true)
      await bot.waitForTicks(60)
      assert.strictEqual(bot.entity.position.y, ground + 1, 'the sneaking bot fell off')
      assert.ok(bot.entity.position.z < -3 + 0.31 && bot.entity.position.z > -3 - 0.31, `stopped at z ${bot.entity.position.z}`)
      bot.setControlState('sneak', false)
      await onceWithCleanup(bot, 'physicsTick', { timeout: 2000, checkCondition: () => bot.entity.position.y === ground })
      bot.clearControlStates()
      await bot.waitForTicks(20)
      assert.strictEqual(corrections.count, 1, 'only the teleport onto the platform') // the test's own teleport
    } finally {
      bot.clearControlStates()
      done()
    }
  }
})
