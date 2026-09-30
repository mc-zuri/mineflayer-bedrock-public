import assert from 'assert'

export default () => async (bot) => {
  const player = bot.players[bot.username]
  assert.strictEqual(player.displayName.toString(), bot.username)
}
