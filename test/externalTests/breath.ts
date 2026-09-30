import assert from 'assert'

export default () => async (bot) => {
  await bot.waitForChunksToLoad()
  // TODO: ** Fix in 1.17
  if (bot.oxygenLevel) assert.strictEqual(bot.oxygenLevel, 20, 'Wrong oxygen level')
}
