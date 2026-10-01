import assert from 'assert'
import { once } from '../../lib/promise_utils.ts'
import type { TestFunction } from './plugins/testCommon.ts'

export default (): TestFunction => async (bot) => {
  if (bot.isRaining) {
    bot.test.sayEverywhere('/weather clear')
    await once(bot, 'rain')
  }
  assert.strictEqual(bot.isRaining, false)
  bot.test.sayEverywhere('/weather rain')

  await once(bot, 'rain')
  assert.strictEqual(bot.isRaining, true)
  bot.test.sayEverywhere('/weather clear')

  await once(bot, 'rain')
  assert.strictEqual(bot.isRaining, false)
}
