import assert from 'assert'
import { onceWithCleanup } from '../../lib/promise_utils.ts'

export default () => async (bot) => {
  await bot.test.runExample('examples/bee.js', async (name) => {
    assert.strictEqual(name, 'bee')
    // Wait for the server to confirm the op instead of sleeping a fixed 2s.
    const opped = onceWithCleanup(bot, 'messagestr', {
      timeout: 5000,
      checkCondition: (msg) => msg.includes(`Opped ${name}`) || msg.includes(`Made ${name} a server operator`)
    })
    bot.chat(`/op ${name}`) // to counteract spawn protection
    await opped
    await bot.test.tellAndListen(name, 'fly', (message) => {
      if (message !== 'My flight was amazing !') {
        assert.fail(`Unexpected message: ${message}`) // error
      }
      return true // stop listening
    })
  })
}
