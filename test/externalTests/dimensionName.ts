import assert from 'assert'
import type { TestFunction } from './plugins/testCommon.ts'

export default (): TestFunction => async (bot) => {
  assert.strictEqual(bot._getDimensionName(), 'minecraft:overworld')
}
