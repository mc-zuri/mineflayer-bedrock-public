const conv = require('../conversions')

module.exports = inject

function inject (bot) {
  const Entity = require('prismarine-entity')(bot.registry)
  const ChatMessage = require('prismarine-chat')(bot.registry)
  const uniqueToRuntime = new Map()

  bot._playerFromUUID = uuid => Object.values(bot.players).find(player => player.uuid === uuid)

  bot.findPlayer = bot.findPlayers = filter => {
    const matches = Object.values(bot.entities).filter(entity => {
      if (entity.type !== 'player') return false
      if (filter == null) return true
      if (filter instanceof RegExp) return filter.test(entity.username)
      if (typeof filter === 'function') return filter(entity)
      if (typeof filter === 'string') return entity.username?.toLowerCase() === filter.toLowerCase()
      return false
    })

    if (typeof filter !== 'string') return matches
    if (matches.length === 0) return null
    return matches.length === 1 ? matches[0] : matches
  }

  bot.nearestEntity = (match = () => true) => {
    if (!bot.entity) return null
    let nearest = null
    let nearestDistance = Infinity
    for (const entity of Object.values(bot.entities)) {
      if (entity === bot.entity || !entity.isValid || !match(entity)) continue
      const distance = bot.entity.position.distanceSquared(entity.position)
      if (distance < nearestDistance) {
        nearest = entity
        nearestDistance = distance
      }
    }
    return nearest
  }

  bot._client.on('player_list', packet => {
    const records = Array.isArray(packet.records) ? packet.records : packet.records.records
    const packetType = Array.isArray(packet.records) ? null : packet.records.type
    for (const record of records) {
      const type = record.type || packetType
      if (type === 'add') addPlayerListRecord(record)
      if (type === 'remove') removePlayerListRecord(record.uuid)
    }
  })

  bot._client.on('add_player', packet => {
    const runtimeId = runtimeNumber(packet.runtime_id ?? packet.runtime_entity_id)
    if (runtimeId == null) return
    const entity = fetchEntity(runtimeId)
    const player = bot._playerFromUUID(packet.uuid) || bot.players[packet.username]
    const uniqueId = packet.unique_id ?? packet.entity_id_self

    setPlayerEntity(entity, packet.username, packet.uuid)
    setTransform(entity, packet)
    entity.uniqueId = uniqueId
    entity.gamemode = packet.gamemode
    applyMetadata(entity, packet.metadata)
    uniqueToRuntime.set(String(uniqueId), runtimeId)

    if (player) player.entity = entity
    bot.emit('entitySpawn', entity)
  })

  bot._client.on('add_entity', packet => {
    const runtimeId = runtimeNumber(packet.runtime_id ?? packet.runtime_entity_id)
    if (runtimeId == null) return
    const entity = fetchEntity(runtimeId)
    const uniqueId = packet.unique_id ?? packet.entity_id_self

    setEntityData(entity, packet.entity_type)
    setTransform(entity, packet)
    entity.uniqueId = uniqueId
    applyMetadata(entity, packet.metadata)
    applyAttributes(entity, packet.attributes)
    uniqueToRuntime.set(String(uniqueId), runtimeId)
    bot.emit('entitySpawn', entity)
    // Java parity: a firework rocket entity spawning means a firework was used (e.g. an elytra boost).
    if (/firework/.test(entity.name || '')) bot.emit('usedFirework', entity.id)
  })

  bot._client.on('add_item_entity', packet => {
    const runtimeId = runtimeNumber(packet.runtime_entity_id)
    if (runtimeId == null) return
    const entity = fetchEntity(runtimeId)

    setEntityData(entity, 'minecraft:item')
    setPosition(entity, packet.position ?? coordinates(packet, ''))
    setVelocity(entity, packet.velocity ?? coordinates(packet, 'speed_'))
    entity.uniqueId = packet.entity_id_self
    entity.item = bot._bedrockItemFromNotch?.(packet.item) || null
    entity.getDroppedItem = () => entity.item
    applyMetadata(entity, packet.metadata)
    uniqueToRuntime.set(String(entity.uniqueId), runtimeId)
    bot.emit('entitySpawn', entity)
    // An add_item_entity is a dropped item; emit itemDrop too, matching the Java plugin, so ecosystem plugins that
    // wait on it (e.g. mineflayer-collectblock) can pathfind to and collect the drop.
    bot.emit('itemDrop', entity)
  })

  bot._client.on('take_item_entity', packet => {
    const collected = entityForRuntime(packet.runtime_entity_id)
    const collector = entityForRuntime(packet.target)
    if (collector && collected) {
      // The bot's own inventory is not touched here: the server delivers the picked-up stack authoritatively (BDS via a
      // normal inventory_transaction, PowerNukkitX via inventory_slot), so the inventory plugin applies it with the real
      // server stack_id. This packet is only the pickup signal for the playerCollect event.
      bot.emit('playerCollect', collector, collected)
    }
  })

  // Entity riding. Bedrock signals mount/dismount with set_entity_link { link: { ridden_entity_id, rider_entity_id,
  // type } } - the equivalent of Java's attach_entity. type is a u8: 0 remove, 1 rider, 2 passenger. Mirror it into the
  // same bot.vehicle / entity.passengers state and mount/dismount events the core entities plugin exposes, so ride-aware
  // code (and bot.dismount) works on Bedrock.
  bot._client.on('set_entity_link', packet => {
    const link = packet.link
    if (!link) return
    // set_entity_link addresses entities by their UNIQUE id (not runtime id); resolve via the unique->runtime map,
    // and match the bot's own entity by its uniqueId (it isn't always in that map).
    const byUnique = (uniqueId) => {
      if (uniqueId == null) return null
      const key = String(uniqueId)
      if (bot.entity && String(bot.entity.uniqueId) === key) return bot.entity
      const rt = uniqueToRuntime.get(key)
      return rt == null ? null : bot.entities[rt]
    }
    const passenger = byUnique(link.rider_entity_id)
    const vehicle = byUnique(link.ridden_entity_id)
    if (!passenger) return
    const removing = link.type === 0 || link.type === 'remove'
    // Detach from any previous vehicle first.
    const prev = passenger.vehicle
    if (prev && Array.isArray(prev.passengers)) {
      const i = prev.passengers.indexOf(passenger)
      if (i !== -1) prev.passengers.splice(i, 1)
    }
    if (removing || !vehicle) {
      passenger.vehicle = null
      bot.emit('entityDetach', passenger, prev || vehicle) // Java parity: any rider leaving a vehicle
    } else {
      passenger.vehicle = vehicle
      if (!Array.isArray(vehicle.passengers)) vehicle.passengers = []
      if (!vehicle.passengers.includes(passenger)) vehicle.passengers.push(passenger)
      bot.emit('entityAttach', passenger, vehicle) // Java parity: any rider boarding a vehicle
    }
    if (passenger === bot.entity) {
      // a dismount the bot made itself has already left (vehicles.js), so the server's confirmation is no second one
      if (passenger.vehicle) { bot.vehicle = vehicle; bot.emit('mount') } else if (bot.vehicle) { const was = bot.vehicle; bot.vehicle = null; bot.emit('dismount', was) }
    }
  })

  bot._client.on('remove_entity', packet => {
    const runtimeId = uniqueToRuntime.get(String(packet.entity_id_self))
    if (runtimeId == null) return
    uniqueToRuntime.delete(String(packet.entity_id_self))
    removeEntity(runtimeId)
  })

  // On a dimension transfer Bedrock does not remove_entity each old-world actor; the client is expected to drop them all
  // and repopulate from the new dimension's add_entity/add_player. Purge every tracked entity except the bot itself
  // (Java parity: mineflayer clears bot.entities on respawn) so stale mobs/players/items never linger across worlds.
  bot._client.on('change_dimension', () => {
    for (const runtimeId of Object.keys(bot.entities)) {
      if (bot.entities[runtimeId] === bot.entity) continue
      removeEntity(Number(runtimeId)) // emits entityGone, invalidates, and delinks any player.entity
    }
    uniqueToRuntime.clear()
    if (bot.vehicle) { const was = bot.vehicle; bot.vehicle = null; bot.emit('dismount', was) }
  })

  bot._client.on('move_entity', packet => {
    const entity = entityForRuntime(packet.runtime_entity_id)
    if (!entity) return
    setPosition(entity, packet.position)
    if (packet.rotation) {
      entity.yaw = conv.fromNotchianYaw(packet.rotation.yaw)
      entity.pitch = conv.fromNotchianPitch(packet.rotation.pitch)
      entity.headYaw = conv.fromNotchianYaw(packet.rotation.head_yaw)
    }
    bot.emit('entityMoved', entity)
  })

  bot._client.on('move_player', packet => {
    const entity = entityForRuntime(packet.runtime_id)
    if (!entity) return
    if (packet.position) {
      // the wire position is the feet plus 1.62001 (float32) for any player pose
      entity.position.set(Math.fround(packet.position.x), Math.fround(Math.fround(packet.position.y) - 1.6200100183486938), Math.fround(packet.position.z))
    }
    entity.yaw = conv.fromNotchianYaw(packet.yaw)
    entity.pitch = conv.fromNotchianPitch(packet.pitch)
    entity.headYaw = conv.fromNotchianYaw(packet.head_yaw)
    entity.onGround = packet.on_ground
    bot.emit('entityMoved', entity)
    // When the server teleports the BOT's own player (mode teleport/reset, e.g. /tp or an anti-cheat pullback), Java fires
    // 'forcedMove'. A 'normal' mode move_player is the continuous ride/position stream, which is not a forced move.
    if (entity === bot.entity && (packet.mode === 'teleport' || packet.mode === 'reset')) {
      bot.emit('move', bot.entity.position)
      bot.emit('forcedMove')
    }
  })

  bot._client.on('move_entity_delta', packet => {
    const entity = entityForRuntime(packet.runtime_entity_id)
    if (!entity) return
    if (packet.x != null) entity.position.x = packet.x
    if (packet.y != null) entity.position.y = packet.y
    if (packet.z != null) entity.position.z = packet.z
    if (packet.rot_x != null) entity.pitch = conv.fromNotchianPitchByte(packet.rot_x)
    if (packet.rot_y != null) entity.yaw = conv.fromNotchianYawByte(packet.rot_y)
    if (packet.rot_z != null) entity.headYaw = conv.fromNotchianYawByte(packet.rot_z)
    entity.onGround = packet.on_ground
    bot.emit('entityMoved', entity)
  })

  bot._client.on('set_entity_motion', packet => {
    const entity = entityForRuntime(packet.runtime_entity_id)
    // the local player's motion is the physics session's (client_input), applied on the tick it takes effect
    if (!entity || entity === bot.entity) return
    setVelocity(entity, packet.velocity)
  })

  bot._client.on('set_entity_data', packet => {
    const entity = entityForRuntime(packet.runtime_entity_id)
    if (!entity) return
    const wasSneaking = Boolean(entity.metadata.flags?.sneaking)
    const wasGliding = Boolean(entity.metadata.flags?.gliding)
    const wasInBed = isSleepingMeta(entity.metadata)
    applyMetadata(entity, packet.metadata)
    const isSneaking = Boolean(entity.metadata.flags?.sneaking)
    entity.crouching = isSneaking // Java-parity named property alongside the entityCrouch/entityUncrouch events
    if (wasSneaking !== isSneaking) {
      if (entity.type === 'player') {
        entity.height = isSneaking ? 1.5 : 1.8
        entity.eyeHeight = isSneaking ? 1.27 : 1.62
      }
      bot.emit(isSneaking ? 'entityCrouch' : 'entityUncrouch', entity)
    }
    // Elytra gliding: mirror the Bedrock 'gliding' actor flag onto entity.elytraFlying (Java parity) and emit
    // entityElytraFlew on the rising edge, which bot.elytraFly awaits to confirm the server accepted the glide.
    const isGliding = Boolean(entity.metadata.flags?.gliding)
    entity.elytraFlying = isGliding
    if (!wasGliding && isGliding) bot.emit('entityElytraFlew', entity)
    // Sleep: on Bedrock the "currently sleeping" state is the player_flags SLEEPING bit (value 2), set on entering a
    // bed and cleared on waking (verified live). NOT player_bed_position - that is the player's spawn bed and persists
    // after waking. Emit entitySleep/entityWake so the bed plugin sets bot.isSleeping and fires 'sleep'/'wake'.
    const isInBed = isSleepingMeta(entity.metadata)
    if (wasInBed !== isInBed) bot.emit(isInBed ? 'entitySleep' : 'entityWake', entity)
    // bot.oxygenLevel / the 'breath' event are owned by breath.js (a getter-only property re-derived after every
    // set_entity_data); the previous updateBreath() call here assigned that getter-only property (a silent no-op) and
    // double-fired 'breath'. Leave breath handling to breath.js.
    bot.emit('entityUpdate', entity)
  })

  bot._client.on('entity_event', packet => {
    const entity = entityForRuntime(packet.runtime_entity_id)
    if (!entity) return
    const event = {
      hurt_animation: 'entityHurt',
      death_animation: 'entityDead',
      arm_swing: 'entitySwingArm', // mob melee swings arrive here (not the 'animate' packet, which is the player path)
      tame_fail: 'entityTaming',
      tame_success: 'entityTamed',
      shake_wet: 'entityShakingOffWater',
      use_item: 'entityEat',
      eating_item: 'entityEat',
      eat_grass_animation: 'entityEatingGrass'
    }[packet.event_id]
    if (event) bot.emit(event, entity)
  })

  bot._client.on('animate', packet => {
    const entity = entityForRuntime(packet.runtime_entity_id)
    if (!entity) return
    const event = {
      swing_arm: 'entitySwingArm',
      wake_up: 'entityWake',
      critical_hit: 'entityCriticalEffect',
      magic_critical_hit: 'entityMagicCriticalEffect'
    }[packet.action_id]
    if (event) bot.emit(event, entity)
  })

  bot._client.on('update_attributes', packet => {
    const entity = entityForRuntime(packet.runtime_entity_id)
    if (!entity) return
    applyAttributes(entity, packet.attributes)
    bot.emit('entityAttributes', entity)
  })

  bot._client.on('mob_effect', packet => {
    const entity = entityForRuntime(packet.runtime_entity_id)
    if (!entity) return

    if (packet.event_id === 'remove') {
      const effect = entity.effects[packet.effect_id] || {
        id: packet.effect_id,
        amplifier: packet.amplifier,
        duration: packet.duration
      }
      delete entity.effects[packet.effect_id]
      bot.emit('entityEffectEnd', entity, effect)
      return
    }

    const effect = {
      id: packet.effect_id,
      amplifier: packet.amplifier,
      duration: packet.duration
    }
    entity.effects[effect.id] = effect
    bot.emit('entityEffect', entity, effect)
  })

  bot.on('spawn', () => {
    if (bot.entity) bot.emit('entitySpawn', bot.entity)
  })

  function addPlayerListRecord (record) {
    let player = bot._playerFromUUID(record.uuid) || bot.players[record.username]
    const isNew = !player
    if (!player) player = {}

    const previousUsername = player.username
    player.uuid = record.uuid
    player.username = record.username
    player.displayName = new ChatMessage({ text: '', extra: [{ text: record.username }] })
    player.ping ??= 0
    player.gamemode ??= 0
    player.entity ??= Object.values(bot.entities).find(entity => entity.type === 'player' && entity.uuid === record.uuid) || null
    player.xboxUserId = record.xbox_user_id
    player.buildPlatform = record.build_platform
    player.entityUniqueId = record.entity_unique_id

    if (previousUsername && previousUsername !== record.username) delete bot.players[previousUsername]
    bot.players[record.username] = player
    bot.uuidToUsername[record.uuid] = record.username
    if (player.entity === bot.entity || record.uuid === bot.entity?.uuid) bot.player = player

    bot.emit(isNew ? 'playerJoined' : 'playerUpdated', player)
  }

  function removePlayerListRecord (uuid) {
    const player = bot._playerFromUUID(uuid)
    if (!player || player.entity === bot.entity) return
    player.entity = null
    delete bot.players[player.username]
    delete bot.uuidToUsername[uuid]
    bot.emit('playerLeft', player)
  }

  function fetchEntity (runtimeId) {
    return bot.entities[runtimeId] || (bot.entities[runtimeId] = new Entity(runtimeId))
  }

  function entityForRuntime (runtimeId) {
    const id = runtimeNumber(runtimeId)
    return id == null ? null : bot.entities[id]
  }

  function removeEntity (runtimeId) {
    const entity = bot.entities[runtimeId]
    if (!entity || entity === bot.entity) return
    bot.emit('entityGone', entity)
    entity.isValid = false
    if (entity.username && bot.players[entity.username]) bot.players[entity.username].entity = null
    delete bot.entities[runtimeId]
  }

  function runtimeNumber (runtimeId) {
    const id = Number(runtimeId)
    if (!Number.isSafeInteger(id)) {
      bot._warn(`Ignoring Bedrock entity runtime ID outside JavaScript's safe integer range: ${runtimeId}`)
      return null
    }
    return id
  }

  // The player is currently sleeping when the SLEEPING bit (value 2) of the player_flags metadata byte is set.
  function isSleepingMeta (metadata) {
    return !!((Number(metadata.player_flags) || 0) & 2)
  }

  function coordinates (packet, prefix) {
    const x = packet[`${prefix}x`]
    const y = packet[`${prefix}y`]
    const z = packet[`${prefix}z`]
    return x == null || y == null || z == null ? undefined : { x, y, z }
  }

  function setPlayerEntity (entity, username, uuid) {
    const data = bot.registry.entitiesArray?.find(entry => entry.name === 'player')
    entity.type = 'player'
    entity.name = 'player'
    entity.username = username
    entity.uuid = uuid
    applyEntityData(entity, data)
  }

  function setEntityData (entity, identifier) {
    const name = identifier.replace(/^minecraft:/, '')
    const data = bot.registry.entitiesArray?.find(entry => entry.name === name)
    entity.name = name
    applyEntityData(entity, data)
    if (!data) {
      entity.type = 'other'
      entity.displayName = identifier
      entity.kind = 'unknown'
    }
  }

  function applyEntityData (entity, data) {
    if (!data) return
    entity.type = data.type || 'object'
    entity.displayName = data.displayName
    entity.entityType = data.id
    entity.name = data.name
    entity.kind = data.category
    entity.height = data.height
    entity.width = data.width
  }

  function setTransform (entity, packet) {
    setPosition(entity, packet.position)
    setVelocity(entity, packet.velocity)
    entity.yaw = conv.fromNotchianYaw(packet.yaw)
    entity.pitch = conv.fromNotchianPitch(packet.pitch)
    entity.headYaw = conv.fromNotchianYaw(packet.head_yaw)
  }

  function setPosition (entity, position) {
    if (position) entity.position.set(position.x, position.y, position.z)
  }

  function setVelocity (entity, velocity) {
    if (velocity) entity.velocity.set(velocity.x, velocity.y, velocity.z)
  }

  function applyMetadata (entity, metadata = []) {
    for (const entry of metadata) entity.metadata[entry.key] = entry.value
    // Bedrock keys metadata by string names ('nametag', 'air', ...); Java ecosystem code and prismarine-entity read the
    // shared NUMERIC indices. Bridge the ones with a clean 1:1 mapping so entity.metadata[<index>] works on bedrock:
    //   [1] air ticks, [2] custom name (drives getCustomName), [3] custom-name-visible.
    // Index 0 (the entity flags byte: on-fire/sneaking/sprinting/...) is NOT bridged: bedrock's 'flags' is a decoded
    // object with a different, version-specific bit layout; reconstructing the Java byte is a separate follow-up.
    if ('air' in entity.metadata) entity.metadata[1] = entity.metadata.air
    if ('nametag' in entity.metadata) {
      const tag = entity.metadata.nametag
      entity.metadata[2] = (typeof tag === 'string' && tag.length) ? tag : undefined
    }
    if ('always_show_nametag' in entity.metadata) entity.metadata[3] = !!Number(entity.metadata.always_show_nametag)
  }


  function applyAttributes (entity, attributes = []) {
    entity.attributes ??= {}
    for (const attribute of attributes) {
      // Bedrock's current value is already resolved (the server applies modifiers), so store it as `value` with an empty
      // `modifiers` array - the shape mineflayer/ecosystem code expects (e.g. explosion.js getAttributeValue iterates
      // prop.modifiers). Keep min/max/default too.
      const entry = {
        value: attribute.current ?? attribute.value,
        modifiers: [],
        min: attribute.min,
        max: attribute.max,
        default: attribute.default
      }
      entity.attributes[attribute.name] = entry
      // Also expose it under the Java attribute key ecosystem code looks up (generic.*), so a server-driven property
      // change is discoverable by name on Bedrock too. Additive only - the bedrock key above is kept, and this does not
      // affect physics (prismarine-physics ignores entity.attributes on the Bedrock edition and uses its own constants).
      const javaKey = JAVA_ATTR_ALIAS[attribute.name]
      if (javaKey) entity.attributes[javaKey] = entry
    }
  }
}

// Bedrock attribute resource id -> the Java attribute key mineflayer/ecosystem code reads (mineflayer stores attributes
// under these generic.* keys). Only the attributes with a meaningful Java equivalent are aliased; Bedrock-only movement
// modifiers (air_drag/friction/bounciness/lava/underwater) have no Java analogue and are left under their bedrock key.
const JAVA_ATTR_ALIAS = {
  'minecraft:movement': 'generic.movement_speed',
  'minecraft:underwater_movement': 'generic.water_movement_efficiency',
  'minecraft:follow_range': 'generic.follow_range',
  'minecraft:attack_damage': 'generic.attack_damage',
  'minecraft:knockback_resistance': 'generic.knockback_resistance',
  'minecraft:absorption': 'generic.absorption',
  'minecraft:luck': 'generic.luck',
  'minecraft:health': 'generic.max_health'
}
