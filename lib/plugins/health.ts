import type { BotOptions } from '../types/mineflayer.ts'
import type { BotInternal } from '../types/internal.ts'

export default inject

function inject (bot: BotInternal, options: BotOptions): void {
  bot.isAlive = true
  // a respawn of a living bot (dimension change, proxy server switch): 'spawn' on the next update_health
  let spawnPending = false

  bot._client.on('respawn', () => {
    // vanilla only shows the death screen while the player's health is 0: a respawn that is not
    // the answer to a death leaves the bot alive, even when no update_health follows
    if (bot.health <= 0) bot.isAlive = false
    else spawnPending = true
    bot.emit('respawn')
  })

  // 1.21.4+ servers ignore block and item interactions until the client has
  // sent player_loaded (or 60 ticks have passed)
  function spawn () {
    if (bot.supportFeature('sendsPlayerLoadedPacket')) bot._client.write('player_loaded', {})
    bot.emit('spawn')
  }

  bot._client.once('update_health', (packet) => {
    if (packet.health > 0) {
      spawnPending = false
      spawn()
    }
  })

  bot._client.on('update_health', (packet) => {
    bot.health = packet.health
    bot.food = packet.food
    bot.foodSaturation = packet.foodSaturation
    bot.emit('health')
    if (bot.health <= 0) {
      if (bot.isAlive) {
        bot.isAlive = false
        bot.emit('death')
      }
      if (!options.respawn) return
      bot.respawn()
    } else if (bot.health > 0 && (!bot.isAlive || spawnPending)) {
      bot.isAlive = true
      spawnPending = false
      spawn()
    }
  })

  const respawn = () => {
    if (bot.isAlive) return
    bot._client.write('client_command', bot.supportFeature('respawnIsPayload') ? { payload: 0 } : { actionId: 0 })
  }

  bot.respawn = respawn
}
