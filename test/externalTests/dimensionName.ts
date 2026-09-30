import assert from 'assert'

export default () => async (bot) => {
  assert.strictEqual(bot._getDimensionName(), 'minecraft:overworld')
}
