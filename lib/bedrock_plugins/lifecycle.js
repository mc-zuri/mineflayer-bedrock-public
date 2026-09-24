const { Vec3 } = require('vec3')
const conv = require('../conversions')

module.exports = inject

const PLAYER_HEIGHT = 1.8
const PLAYER_WIDTH = 0.6
const PLAYER_EYE_HEIGHT = 1.62
// A player's position on the wire is its feet plus the client's 1.62001 (in float32), whatever its pose.
const WIRE_EYE_OFFSET = 1.6200100183486938
const feetY = (y) => Math.fround(Math.fround(y) - WIRE_EYE_OFFSET)

function inject (bot) {
  const Entity = require('prismarine-entity')(bot.registry)
  let respawnPending = false
  let loggedIn = false

  bot.quit = reason => bot.end(reason ?? 'disconnect.quitting')
  bot.players = {}
  bot.uuidToUsername = {}
  bot.entities = {}

  bot._client.once('start_game', packet => {
    const entityId = Number(packet.runtime_entity_id)
    const position = packet.player_position ?? packet.spawn
    const entity = new Entity(entityId)
    const profile = bot._client.profile || {}

    entity.position = new Vec3(Math.fround(position.x), feetY(position.y), Math.fround(position.z))
    entity.yaw = conv.fromNotchianYaw(packet.rotation?.z ?? 0)
    entity.pitch = conv.fromNotchianPitch(packet.rotation?.x ?? 0)
    entity.username = profile.name || bot._client.username || bot.username
    entity.uuid = profile.uuid
    entity.uniqueId = packet.entity_id
    entity.type = 'player'
    entity.name = 'player'
    entity.height = PLAYER_HEIGHT
    entity.width = PLAYER_WIDTH
    entity.eyeHeight = PLAYER_EYE_HEIGHT

    bot.username = entity.username
    bot.entity = entity
    bot.entities[entityId] = entity
    bot.player = bot.players[entity.username] || {
      username: entity.username,
      uuid: entity.uuid
    }
    bot.player.entity = entity
    bot.players[entity.username] = bot.player
    if (entity.uuid) bot.uuidToUsername[entity.uuid] = entity.username
    loggedIn = true
    bot.emit('login')
  })

  // The client's loading screen: it opens on start_game (and on a dimension change, under the id the change names) and
  // closes once the player can move. The server ignores the player's movement until the client reports it closed.
  function loadingScreen (type, id) {
    bot._client.queue('serverbound_loading_screen', id == null ? { type } : { type, loading_screen_id: id })
  }
  bot._client.once('start_game', () => loadingScreen(1))
  bot._client.on('spawn', () => loadingScreen(2))
  bot._client.on('change_dimension', packet => {
    loadingScreen(1, packet.loading_screen_id)
    loadingScreen(2, packet.loading_screen_id)
  })

  bot._client.on('spawn', () => bot.emit('spawn'))
  bot.on('spawn', () => { respawnPending = false })
  bot._client.on('respawn', packet => {
    const position = packet.position ?? (packet.x != null ? packet : null)
    if (!bot.entity || !position) return
    bot.entity.position.set(Math.fround(position.x), feetY(position.y), Math.fround(position.z))
    if (packet.state === 1 || packet.state === 'ready_to_spawn') {
      bot.emit('forcedMove')
      if (!bot.isAlive && !respawnPending) {
        respawnPending = true
        bot.emit('respawn')
      }
    }
  })
  bot._client.on('kick', packet => {
    bot.emit('kicked', packet.message ?? packet.reason ?? packet, loggedIn)
  })
}
