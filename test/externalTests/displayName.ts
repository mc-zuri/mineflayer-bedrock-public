import assert from 'assert'
import type { TestFunction } from './plugins/testCommon.ts'

export default (): TestFunction => async (bot) => {
  const player = bot.players[bot.username]!
  assert.strictEqual(player.displayName.toString(), bot.username)
}
