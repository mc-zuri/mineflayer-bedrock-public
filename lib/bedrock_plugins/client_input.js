const conv = require('../conversions')
const Vec3 = require('vec3')
const { Physics, PlayerState, BedrockSession } = require('prismarine-physics')

// The player's reported position is its feet plus this, sneaking or not (the client's 1.62001 in float32).
const PLAYER_EYE_HEIGHT = 1.6200100183486938

module.exports = inject

// The entities a player collides with like blocks: the height of their position above the box floor, and their box.
const SOLID_ENTITIES = {
  boat: { offset: 0.375, width: 1.4, height: 0.455 },
  chest_boat: { offset: 0.375, width: 1.4, height: 0.455 }
}

function inject (bot, options = {}) {
  // World view the physics engine queries for collision. A column that has not loaded is a floor under the player,
  // as the client has it: a player teleported ahead of its chunks stands where it landed (gravity goes into its
  // velocity, and it collides from the next tick) instead of falling through, and is not pushed out of anything.
  // So an unloaded block below the player's feet (inside the world's height) is solid and one at or above them is
  // air. Without block data at all (an unsupported version) every block reads null, as before.
  const Block = require('prismarine-block')(bot.registry)
  const unloaded = bot.registry.blocksByName.invisible_bedrock || bot.registry.blocksByName.bedrock
  const world = {
    getBlock: (pos) => {
      const block = typeof bot.blockAt === 'function' ? bot.blockAt(pos) : null
      // a waterlogged block carries the water of its second layer
      if (block && typeof bot.bedrockLiquidAt === 'function') block.liquid = bot.bedrockLiquidAt(pos)
      if (block || !unloaded || !bot._bedrockWorldSupport || !bot._bedrockWorldSupport.supported || !bot.game) return block
      if (pos.y < bot.game.minY || pos.y >= bot.game.minY + bot.game.height) return null
      if (!bot.entity || Math.floor(pos.y) >= Math.floor(bot.entity.position.y)) return null
      const solid = Block.fromStateId(unloaded.defaultState, 0)
      solid.position = new Vec3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z))
      return solid
    },
    // whether the column at a position has loaded
    loaded: (pos) => !bot._bedrockWorldSupport || !bot._bedrockWorldSupport.supported || !bot.world || typeof bot.world.getColumnAt !== 'function' || !!bot.world.getColumnAt(new Vec3(pos.x, 0, pos.z)),
    // Boats are solid to a player: their boxes (the position is the box floor plus the height offset), except the one
    // the bot rides.
    solidEntityBoxes: (query) => {
      const boxes = []
      for (const entity of Object.values(bot.entities || {})) {
        if (!SOLID_ENTITIES[entity.name] || entity === bot.vehicle || !entity.position) continue
        const { offset, width, height } = SOLID_ENTITIES[entity.name]
        const at = shownPosition(entity)
        const w = Math.fround(Math.fround(entity.metadata?.boundingbox_width ?? width) * 0.5)
        const minY = Math.fround(at.y - offset)
        const box = {
          minX: Math.fround(at.x - w),
          minY,
          minZ: Math.fround(at.z - w),
          maxX: Math.fround(at.x + w),
          maxY: Math.fround(minY + Math.fround(entity.metadata?.boundingbox_height ?? height)),
          maxZ: Math.fround(at.z + w)
        }
        if (box.maxX > query.minX && box.minX < query.maxX && box.maxY > query.minY && box.minY < query.maxY && box.maxZ > query.minZ && box.minZ < query.maxZ) boxes.push(box)
      }
      return boxes
    },
    // Dolphin's Grace: whether a dolphin's box meets the box the player looks in.
    dolphinsNear: (query) => Object.values(bot.entities || {}).some(entity => {
      if (entity.name !== 'dolphin' || !entity.position) return false
      const w = (entity.metadata?.boundingbox_width ?? 0.9) * 0.5
      const h = entity.metadata?.boundingbox_height ?? 0.6
      const p = entity.position
      return p.x + w > query.minX && p.x - w < query.maxX && p.y + h > query.minY && p.y < query.maxY && p.z + w > query.minZ && p.z - w < query.maxZ
    })
  }
  // The client shows another entity where its interpolation has got to: each server move starts three equal steps from
  // the shown position to the new one, one at the start of each tick. The solid entities' boxes are where they are
  // shown, and a rider sits where its vehicle is shown.
  const INTERPOLATION_STEPS = 3
  const wrapDegrees = (a) => { a %= 360; if (a >= 180) a -= 360; if (a < -180) a += 360; return a }
  const interpolation = new Map() // entity id -> { at, target, steps }
  // where an entity collides: where it was shown before this tick's interpolation step
  function shownPosition (entity) {
    const state = interpolation.get(entity.id)
    return state ? (state.before || state.at) : entity.position
  }
  bot.on('entityMoved', entity => {
    if (entity === bot.entity || !entity.position) return
    const state = interpolation.get(entity.id)
    // a boat the bot steered until the server's unlink this tick is still its own until the tick runs: no move reaches it
    if (state && state.steeredUntilTick) return
    const target = { x: Math.fround(entity.position.x), y: Math.fround(entity.position.y), z: Math.fround(entity.position.z) }
    if (!state) {
      interpolation.set(entity.id, { at: target, target, steps: 0, entity })
      entity.bedrockShownPosition = target
    } else { state.target = target; state.steps = INTERPOLATION_STEPS }
  })
  // an entity is shown where it spawned until its first move
  bot.on('entitySpawn', entity => {
    if (entity === bot.entity || !entity.position) return
    const at = { x: Math.fround(entity.position.x), y: Math.fround(entity.position.y), z: Math.fround(entity.position.z) }
    interpolation.set(entity.id, { at, target: at, steps: 0, entity })
    entity.bedrockShownPosition = at
  })
  bot.on('entityGone', entity => interpolation.delete(entity.id))
  function advanceInterpolation () {
    for (const state of interpolation.values()) {
      state.steeredUntilTick = false
      state.before = state.at
      if (state.steps <= 0) continue
      // the yaw steps with the position, toward the server's last one the shorter way round
      const raw = typeof bot._bedrockRawRotation === 'function' ? bot._bedrockRawRotation(state.entity.id) : undefined
      if (raw) {
        const yaw = typeof state.yaw === 'number' ? state.yaw : raw.yaw
        const turn = Math.fround(wrapDegrees(Math.fround(raw.yaw - yaw)))
        state.yaw = state.steps === 1 ? raw.yaw : Math.fround(wrapDegrees(Math.fround(Math.fround(turn * Math.fround(1 / state.steps)) + yaw)))
        state.entity.bedrockShownYaw = state.yaw
      }
      if (state.steps === 1) state.at = { ...state.target }
      else {
        const t = Math.fround(1 / state.steps)
        state.at = {
          x: Math.fround(Math.fround(Math.fround(state.target.x - state.at.x) * t) + state.at.x),
          y: Math.fround(Math.fround(Math.fround(state.target.y - state.at.y) * t) + state.at.y),
          z: Math.fround(Math.fround(Math.fround(state.target.z - state.at.z) * t) + state.at.z)
        }
      }

      state.steps--
      // where the client shows it (the vehicles plugin starts a mounted boat from there)
      state.entity.bedrockShownPosition = state.at
    }
  }

  // A boat just mounted starts from where and as the client shows it on the first tick ridden (after that tick's
  // interpolation step).
  function placeMountedVehicle () {
    const v = bot.bedrockVehicle
    if (!v || !v.placeFrom) return
    const at = v.placeFrom.bedrockShownPosition || v.placeFrom.position
    v.pos.set(Math.fround(at.x), Math.fround(at.y), Math.fround(at.z))
    if (typeof v.placeFrom.bedrockShownYaw === 'number') v.yaw = v.placeFrom.bedrockShownYaw
    delete v.placeFrom
  }
  // A vehicle the client does not predict seats its rider where it was shown before this tick's interpolation step.
  function placeRiddenVehicle () {
    const v = bot.bedrockVehicle
    if (!v || v.predicted || !bot.vehicle) return
    const at = bot.vehicle.bedrockShownPosition || bot.vehicle.position
    v.pos.set(Math.fround(at.x), Math.fround(at.y), Math.fround(at.z))
  }

  let timer
  let spawned = false
  let movementAuthority = 'server'
  // Manual ticks (options.physicsTicks === 'manual', or a client that asks for them, such as a recording replayed
  // offline): no send timer; the caller runs each client tick with bot.bedrockTick(tick).
  const manual = options.physicsTicks === 'manual' || !!bot._client.manualTicks

  // Bedrock server-authoritative movement uses a rewind buffer (start_game.rewind_history_size, e.g. 40 ticks) and
  // correlates each player_auth_input to a server tick. An input whose tick is outside that window is dropped, so the
  // player never moves. Two things make a simple `tick++` per send drift out of the window: the server's tick is not
  // zero at join (start_game.current_tick), and our send timer does not fire at exactly 20 Hz (event-loop jitter drops
  // it to ~16 Hz under load), so counting sends falls behind the server's real tick by tens of ticks within seconds.
  // Instead we anchor to a known (serverTick, wall-clock) pair and derive each input's tick from elapsed real time, and
  // re-anchor from correct_player_move_prediction.tick (the server's authoritative tick), which keeps us in the window.
  const toTick = (v) => {
    if (v == null) return 0n
    if (typeof v === 'bigint') return v
    if (typeof v === 'number') return BigInt(Math.floor(v))
    if (Array.isArray(v)) return (BigInt(v[0] >>> 0) << 32n) | BigInt(v[1] >>> 0) // [high, low]
    try { return BigInt(v) } catch { return 0n }
  }
  let anchorTick = 0n
  let anchorTime = Date.now()
  let lastEmittedTick = null
  // what the last player_auth_input reported, for 'move'
  let lastSent = null
  const currentTick = () => anchorTick + BigInt(Math.max(0, Math.round((Date.now() - anchorTime) / 50)))
  bot._client.once('start_game', packet => {
    movementAuthority = packet.movement_authority ?? 'server'
    if (packet.current_tick != null) { anchorTick = toTick(packet.current_tick); anchorTime = Date.now() }
    session.handlePacket('start_game', packet)
  })
  bot._client.on('set_movement_authority', packet => {
    movementAuthority = packet.movement_authority
    if (movementAuthority === 'client') stop()
    else if (spawned) start()
  })
  bot.on('spawn', () => {
    spawned = true
    if (movementAuthority !== 'client') start()
  })
  bot._client.once('close', stop)

  function start () {
    if (manual || timer) return
    send()
    timer = setInterval(send, 50)
    timer.unref?.()
  }

  function stop () {
    clearInterval(timer)
    timer = undefined
  }

  // 1.26.40 to 1.26.45 wrap the optional fields in an outer presence bool that the vanilla client always sends as
  // true; 1.26.50 dropped it. Read the schema instead of hardcoding the version range.
  const inputFields = (bot.registry.protocol?.types?.packet_player_auth_input?.[1] || []).map(f => f && f.name).filter(n => typeof n === 'string')
  const presenceFlags = Object.fromEntries(inputFields.filter(n => n.endsWith('_presence')).map(n => [n, true]))
  const modern = bot.registry.version['>=']('1.26.40')

  // Block breaking on 1.26 rides the auth input, not a standalone packet: the real client puts start_break /
  // continue_break / predict_break / abort_break entries in block_action and sets the matching input_data flag (see
  // reviews capture). Other plugins (digging) enqueue actions here; send() drains them into the next tick.
  const pendingBlockActions = []
  bot._queueBlockAction = (...entries) => { for (const e of entries) if (e) pendingBlockActions.push(e) }

  // Movement. Bedrock 1.26 is server-authoritative: the client reports its input each tick (a local-frame move_vector
  // plus input-flag presses) and the server simulates and returns the authoritative position in correct_player_move_
  // prediction, which we apply. So setControlState only records intent; send() turns it into the move_vector/flags and
  // the server drives the actual motion. Verified live: forward input walks the bot and the corrections track it.
  const controlStateValues = { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false }
  bot.setControlState = (control, state) => {
    if (!(control in controlStateValues)) throw new Error(`unknown control state: ${control}`)
    state = !!state
    const wasPressed = controlStateValues[control]
    controlStateValues[control] = state
    // Jump is an impulse the physics engine consumes via jumpQueued (as mineflayer's Java controlState setter does).
    if (control === 'jump' && state && !wasPressed) bot.jumpQueued = true
  }
  bot.getControlState = (control) => {
    if (!(control in controlStateValues)) throw new Error(`unknown control state: ${control}`)
    return controlStateValues[control]
  }
  bot.clearControlStates = () => { for (const k of Object.keys(controlStateValues)) controlStateValues[k] = false }
  // Live proxy (Java parity): bot.controlState.jump = true routes through setControlState, so a direct assignment also
  // queues the jump impulse rather than silently not being consumed by the physics engine.
  bot.controlState = {}
  for (const k of Object.keys(controlStateValues)) {
    Object.defineProperty(bot.controlState, k, { enumerable: true, get: () => controlStateValues[k], set: (v) => bot.setControlState(k, v) })
  }

  // Wait for N physics ticks (mineflayer-java parity; used across the ecosystem to pace actions to the 20 Hz tick).
  bot.waitForTicks = async (ticks) => {
    if (!(ticks > 0)) return
    let remaining = ticks
    await new Promise((resolve) => {
      const onTick = () => { if (--remaining <= 0) { bot.removeListener('physicsTick', onTick); resolve() } }
      bot.on('physicsTick', onTick)
    })
  }

  // Steer the current vehicle (mineflayer-java parity). left/forward are -1..1; on Bedrock a ridden mount is driven by
  // the same move_vector the control states produce (verified: a saddled horse walks on forward), so map the analog
  // intent onto the control states. No-op with no vehicle.
  bot.moveVehicle = (left, forward) => {
    if (!bot.vehicle) return
    bot.setControlState('forward', forward > 0)
    bot.setControlState('back', forward < 0)
    bot.setControlState('left', left > 0)
    bot.setControlState('right', left < 0)
  }

  // Look control (mirrors the Java physics plugin). Bedrock transmits yaw/pitch on every player_auth_input tick, so
  // setting the entity look is enough; we keep vanilla's sensitivity rounding for anticheat parity. bot.lookAt/look are
  // what pathfinder and the interaction plugins call to aim before moving/placing/digging.
  bot.look = async (yaw, pitch, force) => {
    const sensitivity = conv.fromNotchianPitch(0.15) // 100% vanilla sensitivity
    const yawChange = Math.round((yaw - (bot.entity.yaw || 0)) / sensitivity) * sensitivity
    const pitchChange = Math.round((pitch - (bot.entity.pitch || 0)) / sensitivity) * sensitivity
    if (yawChange === 0 && pitchChange === 0) return
    bot.entity.yaw = (bot.entity.yaw || 0) + yawChange
    bot.entity.pitch = (bot.entity.pitch || 0) + pitchChange
    // Unless forced/ignored, await one send tick so the new orientation is transmitted in a player_auth_input before the
    // caller acts (Java's bot.look resolves only once the rotation has been applied). This keeps a look-then-attack /
    // useOn from firing with the pre-look yaw. force === 'ignore' (or true) resolves immediately, matching Java.
    if (force === 'ignore' || force === true) return
    if (typeof bot.waitForTicks === 'function' && bot.physicsEnabled !== false) await bot.waitForTicks(1)
  }
  bot.lookAt = async (point, force) => {
    const p = (point && typeof point.minus === 'function') ? point : new Vec3(point.x, point.y, point.z)
    const delta = p.minus(bot.entity.position.offset(0, PLAYER_EYE_HEIGHT, 0))
    const yaw = Math.atan2(-delta.x, -delta.z)
    const groundDistance = Math.sqrt(delta.x * delta.x + delta.z * delta.z)
    const pitch = Math.atan2(delta.y, groundDistance)
    await bot.look(yaw, pitch, force)
  }

  // Physics. Bedrock movement is server-authoritative, but BDS accepts a client that self-simulates and reports its
  // position (verified: near-vanilla walk/sprint on open ground with zero corrections). So we run the shared
  // prismarine-physics engine each tick - the same collision, step-up, gravity and jump that Java uses, now edition-aware
  // for Bedrock - and report the result over player_auth_input; correct_player_move_prediction is the authoritative
  // correction. Running the shared engine also gives bot.physics, bot.entity.onGround and a physicsTick, which is what
  // mineflayer-pathfinder consumes, so pathfinder works on Bedrock without a bespoke movement model.
  bot.physics = Physics(bot.registry, world)
  // The client's handling of the server's movement packets around its own ticks (prismarine-physics'
  // BedrockSession): a teleport, a movement correction installed on its tick with the ticks since re-simulated, the
  // movement attribute, a knockback and the restated actor flags. It owns the player's simulated state across ticks.
  const session = new BedrockSession({ physics: bot.physics, world })
  for (const name of ['move_player', 'correct_player_move_prediction', 'set_entity_motion', 'update_attributes', 'set_entity_data', 'mob_effect', 'movement_effect', 'update_player_game_type']) {
    bot._client.on(name, packet => session.handlePacket(name, packet))
  }
  if (bot.physicsEnabled === undefined) bot.physicsEnabled = true
  bot.jumpTicks = bot.jumpTicks || 0
  bot.jumpQueued = false
  bot.fireworkRocketDuration = bot.fireworkRocketDuration || 0
  bot._glideQueued = false

  // Elytra flight (mineflayer-java bot.elytraFly). On Bedrock, gliding starts on a jump press while airborne with an
  // elytra worn: the engine then reports start_gliding, and the server flips the 'gliding' actor flag, which
  // entities.js mirrors to bot.entity.elytraFlying + entityElytraFlew. Fire a firework while gliding (bot.activateItem
  // with a firework in hand) to boost, as on Java.
  bot.elytraFly = async () => {
    if (!bot.entity) throw new Error('elytraFly: no entity to glide')
    if (bot.entity.onGround) throw new Error('elytraFly: the bot must be airborne (jump or fall first)')
    if (bot.entity.isInWater) throw new Error('elytraFly: cannot start gliding in water')
    const torsoSlot = typeof bot.getEquipmentDestSlot === 'function' ? bot.getEquipmentDestSlot('torso') : null
    const chest = (torsoSlot != null && bot.inventory) ? bot.inventory.slots[torsoSlot] : null
    if (!chest || !/elytra/.test(chest.name || '')) throw new Error('elytraFly: an elytra must be equipped in the torso slot')
    if (bot.entity.elytraFlying) return
    bot._glideQueued = true
    return new Promise((resolve, reject) => {
      let done = false
      const onFlew = (e) => { if (e === bot.entity) finish(null) }
      const finish = (err) => { if (done) return; done = true; clearTimeout(to); bot.removeListener('entityElytraFlew', onFlew); if (err) reject(err); else resolve() }
      const to = setTimeout(() => finish(bot.entity.elytraFlying ? null : new Error('elytraFly: server did not confirm gliding')), 2500)
      bot.on('entityElytraFlew', onFlew)
    })
  }

  // prismarine-physics reads these entity fields; the Bedrock entity may not carry them yet, so default them in place.
  function ensurePhysicsEntity () {
    const e = bot.entity
    if (!e) return false
    if (!e.velocity) e.velocity = new Vec3(0, 0, 0)
    if (e.onGround === undefined) e.onGround = false
    if (!e.effects) e.effects = {}
    if (!e.attributes) e.attributes = {}
    for (const f of ['isInWater', 'isInLava', 'isInWeb', 'isCollidedHorizontally', 'isCollidedVertically', 'elytraFlying']) {
      if (e[f] === undefined) e[f] = false
    }
    if (!bot.inventory || !bot.inventory.slots) return false // PlayerState reads inventory slots; wait until it exists
    return true
  }

  // The server's tick of a movement correction is behind the client's own; a live timer that has fallen further
  // behind than that (event-loop stalls) catches up to it, and is never moved back.
  bot._client.on('correct_player_move_prediction', (packet) => {
    if (packet.tick == null || manual) return
    const tick = toTick(packet.tick)
    if (tick > currentTick()) { anchorTick = tick; anchorTime = Date.now() }
  })

  // The engine's player, kept across ticks: the session re-simulates past ticks from its own snapshots, so the
  // simulated fields are its own; the inputs (controls, look, effects, abilities, game mode, equipment) are read
  // from the bot every tick. When something else changed what the last tick wrote to the bot (a respawn, a plugin or
  // a test placing the player), the player is taken from the bot again.
  const SIMULATED = ['pos', 'vel', 'onGround', 'isInWater', 'isInLava', 'isInWeb', 'isCollidedHorizontally', 'isCollidedVertically', 'elytraFlying', 'jumpTicks', 'fireworkRocketDuration', 'bedrock', 'attributes']
  let state = null
  let written = null
  const writtenView = () => [bot.entity.position.x, bot.entity.position.y, bot.entity.position.z, bot.entity.velocity.x, bot.entity.velocity.y, bot.entity.velocity.z,
    bot.entity.onGround, bot.entity.isInWater, bot.entity.isInLava, bot.entity.isCollidedHorizontally, bot.entity.isCollidedVertically, bot.entity.elytraFlying,
    bot.jumpTicks, bot.fireworkRocketDuration, bot.bedrockPhysicsState]
  function playerState () {
    const fresh = new PlayerState(bot, { ...bot.controlState })
    const view = writtenView()
    if (!state || !written || view.some((value, i) => value !== written[i])) {
      state = fresh
      return state
    }
    for (const [key, value] of Object.entries(fresh)) if (!SIMULATED.includes(key)) state[key] = value
    return state
  }
  function writeBack () {
    state.apply(bot)
    bot.entity.position = state.pos.clone()
    bot.entity.velocity = state.vel.clone()
    bot.entity.attributes = { ...bot.entity.attributes, ...state.attributes }
    written = writtenView()
  }

  // Local-frame move vector and the matching input flags for the current controls (Bedrock: +z forward, +x left).
  // The packet's input flags, its move vectors and the player's sprint, sneak, swim, glide and flight state are all
  // the engine's: prismarine-physics runs the client's own input pipeline on the raw keys (the cook, the sprint
  // trigger and its wall test, the jump start and its cooldown, the pose triggers, the glide and flight double
  // taps) and builds the packet from the tick it simulated. This plugin supplies the keys and the server's packets.

  // One client tick on demand (manual ticks): exactly one physics step, reported with the given tick (or the one
  // after the last reported).
  bot.bedrockTick = (tick) => send(tick === undefined ? (lastEmittedTick == null ? currentTick() : lastEmittedTick + 1n) : toTick(tick))

  // bot.elytraFly: the client starts a glide on a jump press in the air with an elytra worn, so a queued request
  // presses jump for one tick, until the glide shows or the bot lands.
  function glideRequest () {
    if (!bot._glideQueued) return
    if (bot.entity.elytraFlying || bot.entity.onGround) { bot._glideQueued = false; bot._glideSent = false; return }
    if (bot._glideSent) return
    state.control = { ...state.control, jump: true }
    bot._glideSent = true
  }

  // The dismount button: sneak pressed while riding.
  let sneakWasDown = false
  function dismountOnSneak () {
    const down = !!bot.controlState.sneak
    if (down && !sneakWasDown && bot.vehicle && typeof bot.dismount === 'function') bot.dismount()
    sneakWasDown = down
  }

  // The server's respawn (ready to spawn): a new player at the spawn, whose first tick makes no move.
  bot._client.on('respawn', packet => {
    if (!state || !packet.position || (packet.state !== 1 && packet.state !== 'ready_to_spawn')) return
    bot.physics.respawn(state, packet.position)
    state.apply(bot)
    bot.entity.position = state.pos.clone()
    bot.entity.velocity = state.vel.clone()
    written = writtenView()
  })

  // Leaving a vehicle: the engine places the rider at the dismount spot, before the tick.
  bot.on('bedrockDismount', (vehicle, byRider = true, alpha, unlinked = false) => {
    if (!state || !state.vehicle) return
    // the boat the bot drove is shown where it was predicted: its box stands there, not where the server last put it
    if (vehicle && state.vehicle.predicted) {
      const at = { x: state.vehicle.pos.x, y: state.vehicle.pos.y, z: state.vehicle.pos.z }
      const yaw = Math.fround(state.vehicle.yaw)
      interpolation.set(vehicle.id, { at, target: at, steps: 0, yaw, entity: vehicle, steeredUntilTick: unlinked })
      vehicle.bedrockShownYaw = yaw
      vehicle.bedrockShownPosition = at
    }
    // one the server moves is left from where the server last put it, heading from where it is shown toward there
    const v = state.vehicle
    if (!v.predicted && v.serverPos) {
      v.posPrev = { x: v.pos.x, y: v.pos.y, z: v.pos.z }
      v.pos.set(v.serverPos.x, v.serverPos.y, v.serverPos.z)
    }
    bot.physics.dismount(state, undefined, byRider, alpha, unlinked)
    state.apply(bot)
    bot.entity.position = state.pos.clone()
    bot.entity.velocity = state.vel.clone()
    written = writtenView()
  })

  function predictBreaks (actions) {
    const air = bot.registry.blocksByName?.air
    if (!air || !bot.world) return
    for (const action of actions) {
      if (action.action !== 'predict_break' || !action.position) continue
      try { bot.world.setBlockStateId(new Vec3(action.position.x, action.position.y, action.position.z), air.defaultState) } catch (e) { /* not loaded */ }
    }
  }

  function send (forcedTick) {
    if (!bot.entity) return
    dismountOnSneak()
    const blockActions = pendingBlockActions.splice(0)
    // a block the client predicts broken is air for it at once, before this tick's move (the server's update follows)
    predictBreaks(blockActions)
    // Advance the shared physics engine once per elapsed server tick (keeps 20 Hz motion despite the ~16 Hz timer), then
    // report the resulting position and per-tick delta. Gravity, jump, step-up and collision all come from the engine;
    // move_vector/flags below still carry the raw intent the server also reads.
    const target = forcedTick === undefined ? currentTick() : forcedTick
    // Advance exactly one physics step per elapsed server tick. The send timer runs faster than 20 Hz, so many sends
    // fall inside the same tick and must step 0 (not a forced 1) - forcing a step over-predicts, which reads as ~19%
    // fast on walk and, for the faster sprint, over-shoots the server's tolerance so its correction snaps the bot back.
    let steps = lastEmittedTick == null || forcedTick !== undefined ? 1 : Number(target - lastEmittedTick)
    if (steps < 0) steps = 0
    if (steps > 8) steps = 8
    // The engine simulates from the raw keys and then reports what the client would have sent for that tick.
    let stepped = false
    if (bot._creativeFlying) {
      // Creative flight: bot.creative.flyTo drives the position itself, so the engine does not step; the tick stays
      // alive so physicsTick-based timers (waitForTicks, ecosystem loops) still fire while hovering.
      for (let i = 0; i < steps; i++) { bot.emit('physicsTick'); bot.emit('physicTick') }
    } else if (bot.physicsEnabled !== false && ensurePhysicsEntity()) {
      for (let i = 0; i < steps; i++) {
        const t = Number(target) - (steps - 1 - i)
        placeRiddenVehicle()
        advanceInterpolation()
        placeMountedVehicle()
        playerState()
        glideRequest()
        // `bot.bedrockTurns`: the turns ([pitch, yaw] degrees) the tick's input made, where the caller knows them apart from
        // the view's jitter (a replayed recording's camera); a rewind replays them
        session.tick(state, { t, control: state.control, yaw: state.yaw, pitch: state.pitch, turns: bot.bedrockTurns, riptideLaunch: state.riptideLaunch, spinHits: state.spinHits, fireworkUsed: state.fireworkUsed, usingItem: state.usingItem, itemUseStarted: state.itemUseStarted })
        writeBack()
        bot.emit('physicsTick')
        bot.emit('physicTick') // deprecated alias, matches the Java plugin; ecosystem plugins (e.g. mineflayer-pvp) use it
        stepped = true
      }
    }
    lastEmittedTick = target
    // no step this send (the timer runs faster than the tick): report the state as it stands
    const reported = stepped ? state : new PlayerState(bot, { ...bot.controlState })
    const packet = { ...bot.physics.playerAuthInput(reported), tick: target, ...presenceFlags }
    packet.input_data = modern
      ? packet.input_data
      : Object.fromEntries(packet.input_data.map(name => [name, true]))
    if (blockActions.length) {
      if (Array.isArray(packet.input_data)) packet.input_data.push('block_action')
      else packet.input_data.block_action = true
      packet.block_action = blockActions
    }
    bot._client.queue('player_auth_input', packet)
    // jumping in a vehicle that does not take the jump, the client leaves it after the tick
    if (stepped && state.bedrock && state.bedrock.leaveVehicle) {
      state.bedrock.leaveVehicle = false
      if (bot.vehicle && typeof bot.dismount === 'function') bot.dismount()
    }
    emitMove()
  }

  // Java's physics plugin emits 'move' (with the previous position) whenever it sends a position or a look; do the
  // same for the input that reports a new position or rotation, so 'move' listeners (viewers, pathfinders) follow a
  // walking Bedrock bot and not only its teleports.
  function emitMove () {
    const { position, yaw, pitch } = bot.entity
    if (lastSent && lastSent.position.equals(position) && lastSent.yaw === yaw && lastSent.pitch === pitch) return
    const oldPos = lastSent ? lastSent.position : position.clone()
    lastSent = { position: position.clone(), yaw, pitch }
    bot.emit('move', oldPos)
  }
}
