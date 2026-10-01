import assert from 'assert'
import { Vec3 } from 'vec3'
import { onceWithCleanup } from '../../lib/promise_utils.ts'
import type { TestFunction } from './plugins/testCommon.ts'

export default (): TestFunction => async (bot) => {
  const groundY = bot.test.groundY
  const eye = new Vec3(0, groundY + 1, 0)
  const isWater = () => ['water', 'flowing_water'].includes(bot.blockAt(eye)?.name as string)

  // A dirt shell around a 1x2 water column on the bot's block: the eyes are
  // under water and the water can't flow away.
  bot.chat(`/fill -1 ${groundY} -1 1 ${groundY + 2} 1 dirt`)
  bot.chat(`/fill 0 ${groundY} 0 0 ${groundY + 1} 0 water`)
  if (!isWater()) await onceWithCleanup(bot.world, 'blockUpdate', { timeout: 5000, checkCondition: isWater })

  // Creative players never lose air: only survival drains it, 1 per tick
  // (300 = oxygenLevel 20), and the server sends every change as metadata.
  let breaths = 0
  const countBreath = () => { breaths++ }
  bot.on('breath', countBreath)
  try {
    const drowning = onceWithCleanup(bot, 'breath', { timeout: 10000, checkCondition: () => bot.oxygenLevel < 20 })
    await bot.test.becomeSurvival()
    await drowning
    assert(bot.oxygenLevel < 20 && bot.oxygenLevel >= 0, `oxygenLevel should be draining under water, got ${bot.oxygenLevel}`)

    // Out of the water the air comes back (at once before 1.13, +4 per tick since).
    const breathing = onceWithCleanup(bot, 'breath', { timeout: 10000, checkCondition: () => bot.oxygenLevel === 20 })
    bot.chat(`/fill 0 ${groundY} 0 0 ${groundY + 1} 0 air`)
    await breathing
    assert(breaths >= 2, `expected breath events while drowning and recovering, got ${breaths}`)
  } finally {
    bot.removeListener('breath', countBreath)
    await bot.test.becomeCreative()
  }
}
