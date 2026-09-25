module.exports = inject

function inject (bot, options) {
  let playerRuntimeId
  let respawnFallback
  let sentRespawnReady = false
  let sentRespawnAction = false
  bot.isAlive = true

  bot._client.once('start_game', packet => {
    playerRuntimeId = packet.runtime_entity_id
  })

  // Bedrock ships the death cause + the formatted death messages (Java exposes neither on its bare 'death' event). Keep
  // the last one on bot.deathCause and emit 'deathInfo' so a bot can react to how it died (lava, mob, fall, ...).
  bot.deathCause = null
  bot._client.on('death_info', packet => {
    bot.deathCause = { cause: packet.cause, messages: packet.messages || [] }
    bot.emit('deathInfo', bot.deathCause)
  })

  bot._client.on('set_health', packet => update({ health: packet.health }))
  bot._client.on('respawn', packet => {
    if (packet.state !== 1 && packet.state !== 'ready_to_spawn') return

    const position = packet.position ?? (packet.x != null
      ? { x: packet.x, y: packet.y, z: packet.z }
      : { x: 0, y: 0, z: 0 })
    if (!bot.isAlive) {
      sendRespawnReady(position)
      clearTimeout(respawnFallback)
      respawnFallback = undefined
      sendRespawnAction()
      // the client's player is placed at the spawn alive, at full health, before the server restates its health
      update({ health: maxHealth })
    } else {
      queueRespawnReady(position)
    }
  })
  // the most health the player can have, as the server last sent it
  let maxHealth = 20
  bot._client.on('update_attributes', packet => {
    if (playerRuntimeId !== undefined && String(packet.runtime_entity_id) !== String(playerRuntimeId)) return
    const health = (packet.attributes || []).find(attribute => attribute.name === 'minecraft:health')
    if (health && typeof health.max === 'number' && health.max > 0) maxHealth = health.max
    const attributes = new Map((packet.attributes || []).map(attribute => [attribute.name, attribute.current]))
    update({
      health: attributes.get('minecraft:health'),
      food: attributes.get('minecraft:player.hunger'),
      foodSaturation: attributes.get('minecraft:player.saturation')
    })
  })

  function update (values) {
    let changed = false
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) continue
      bot[name] = value
      changed = true
    }
    if (!changed) return

    bot.emit('health')
    if (bot.health <= 0 && bot.isAlive) {
      bot.isAlive = false
      sentRespawnReady = false
      sentRespawnAction = false
      bot.emit('death')
      if (options.respawn) bot.respawn()
    } else if (bot.health > 0) {
      if (!bot.isAlive) bot.emit('spawn')
      bot.isAlive = true
      clearTimeout(respawnFallback)
      respawnFallback = undefined
      sentRespawnReady = false
      sentRespawnAction = false
    }
  }

  bot.respawn = () => {
    if (bot.isAlive || playerRuntimeId === undefined) return
    sendRespawnReady({ x: 0, y: 0, z: 0 })
    clearTimeout(respawnFallback)
    respawnFallback = setTimeout(sendRespawnAction, 5000)
  }

  function sendRespawnReady (position) {
    if (sentRespawnReady) return
    sentRespawnReady = true
    queueRespawnReady(position)
  }

  function queueRespawnReady (position) {
    bot._client.queue('respawn', {
      position,
      x: position.x,
      y: position.y,
      z: position.z,
      state: 2,
      runtime_entity_id: compatibleRuntimeId(playerRuntimeId)
    })
  }

  function sendRespawnAction () {
    if (sentRespawnAction || bot.isAlive || playerRuntimeId === undefined) return
    sentRespawnAction = true
    const position = { x: 0, y: 0, z: 0 }
    bot._client.queue('player_action', {
      runtime_entity_id: compatibleRuntimeId(playerRuntimeId),
      action: 'respawn',
      position,
      result_position: position,
      face: -1
    })
  }

  function compatibleRuntimeId (runtimeId) {
    return bot._client.options?.version === '1.16.201' ? Number(runtimeId) : runtimeId
  }

  bot._client.on('close', () => clearTimeout(respawnFallback))
}
