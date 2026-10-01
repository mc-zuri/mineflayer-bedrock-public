import { Vec3 } from 'vec3'
import assert from 'assert'
import * as math from '../math.ts'
import * as conv from '../conversions.ts'
import { performance } from 'perf_hooks'
import { createDoneTask, createTask } from '../promise_utils.ts'
import { Physics, PlayerState } from 'prismarine-physics'
import minecraftData from 'minecraft-data'
import type { IndexedData } from 'minecraft-data'
import type { Effect, Entity } from 'prismarine-entity'
import type { PhysicsAttribute, PhysicsEntity } from 'prismarine-physics'
import type { BotInternal } from '../types/internal.ts'
import type { BotOptions, ControlState, ControlStateStatus } from '../types/mineflayer.ts'
import type { MovementFlags } from '../types/protocol.ts'

type Reply = (() => void) & { teleport?: boolean }

export default inject

const PI = Math.PI
const PI_2 = Math.PI * 2
const PHYSICS_INTERVAL_MS = 50
const PHYSICS_TIMESTEP = PHYSICS_INTERVAL_MS / 1000 // 0.05

// the sprint modifier's id: a UUID before 1.21, a resource location since
const SPRINT_MODIFIER_UUID = '662a6b8d-da3e-4c1c-8813-96ea6097278d'

function inject (bot: BotInternal, { physicsEnabled, maxCatchupTicks }: BotOptions): void {
  const PHYSICS_CATCHUP_TICKS = maxCatchupTicks ?? 4
  const world = { getBlock: (pos: Vec3) => { return bot.blockAt(pos, false) } }
  // 26.3+: teleport_confirm carries the position, and the server accepts one move packet per
  // client tick (tick_end ends a tick)
  const confirmHasPosition = bot.registry.version['>=']('26.3')
  const sendsTickEnd = bot.registry.version['>=']('26.3')
  const physics = Physics(bot.registry, world)

  const positionUpdateSentEveryTick = bot.supportFeature('positionUpdateSentEveryTick')
  const hasConfigurationState = bot.supportFeature('hasConfigurationState') // 1.20.2+

  bot.jumpQueued = false
  bot.jumpTicks = 0 // autojump cooldown

  const controlState: ControlStateStatus = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
    sneak: false
  }
  // null until the first teleport is answered
  let lastSentYaw: number | null = null
  let lastSentPitch: number | null = null
  let doPhysicsTimer: ReturnType<typeof setInterval> | null = null
  let lastPhysicsFrameTime: number | null = null
  let shouldUsePhysics = false
  bot.physicsEnabled = physicsEnabled ?? true
  let deadTicks = 21

  const lastSent: { x: number, y: number, z: number, yaw: number, pitch: number, onGround: boolean, time: number, flags: MovementFlags } = {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    onGround: false,
    time: 0,
    flags: { onGround: false, hasHorizontalCollision: false }
  }

  // This function should be executed each tick (every 0.05 seconds)
  // How it works: https://gafferongames.com/post/fix_your_timestep/

  // WARNING: THIS IS NOT ACCURATE ON WINDOWS (15.6 Timer Resolution)
  // use WSL or switch to Linux
  // see: https://discord.com/channels/413438066984747026/519952494768685086/901948718255833158
  let timeAccumulator = 0
  let catchupTicks = 0
  function doPhysics () {
    const now = performance.now()
    const deltaSeconds = (now - lastPhysicsFrameTime!) / 1000 // set before the timer starts
    lastPhysicsFrameTime = now

    timeAccumulator += deltaSeconds
    catchupTicks = 0
    while (timeAccumulator >= PHYSICS_TIMESTEP) {
      tickPhysics(now)
      // 26.3+: the server accepts one move packet per client tick, which tick_end closes
      if (sendsTickEnd && bot._client.state === 'play') bot._client.write('tick_end', {})
      timeAccumulator -= PHYSICS_TIMESTEP
      catchupTicks++
      if (catchupTicks >= PHYSICS_CATCHUP_TICKS) break
    }
    // Whole ticks past the cap are dropped, never replayed: the accumulator holds less than one tick here.
    timeAccumulator %= PHYSICS_TIMESTEP
  }

  function tickPhysics (now: number) {
    if (bot._client.state !== 'play') return // do nothing outside of the play state (e.g. server transfer configuration phase)
    flushReplies()
    if (!bot.entity?.position || !Number.isFinite(bot.entity.position.x)) return // entity not ready
    if (bot.blockAt(bot.entity.position) == null) return // check if chunk is unloaded
    if (bot.physicsEnabled && shouldUsePhysics) {
      const state = new PlayerState(bot, controlState)
      state.attributes = engineAttributes(bot.entity.attributes)
      // A changed bot.physics.gravity (creative.startFlying sets 0) wins over the gravity attribute (1.20.5+)
      if (state.attributes && physics.gravity !== DEFAULT_GRAVITY) delete state.attributes[gravityResource]
      // The abilities the server granted (abilities packet): flying holds the bot up, landing ends it
      state.flying = !!bot.entity.flying
      state.mayFly = bot.abilities.mayFly
      state.flySpeed = bot.abilities.flyingSpeed
      state.gameMode = bot.game.gameMode
      // A bot never double-taps forward or jump: it sprints with the sprint control, and flies when the
      // server (or creative.startFlying) says so
      state.sprintTriggerTime = 0
      state.jumpTriggerTime = 0
      // The entities around: boats and shulkers are solid, mobs push the player away
      state.entities = nearbyEntities()
      physics.simulatePlayer(state, world).apply(bot)
      if (state.flying !== !!bot.entity.flying) {
        // the client ended (or started) the flight itself: it tells the server, like vanilla's onUpdateAbilities
        bot.entity.flying = state.flying
        bot.abilities.flying = state.flying
        sendAbilities()
      }
      bot.emit('physicsTick')
      bot.emit('physicTick') // Deprecated, only exists to support old plugins. May be removed in the future
    }
    if (shouldUsePhysics) {
      updatePosition(now)
    }
  }

  // remove this when 'physicTick' is removed
  bot.on('newListener', (name) => {
    if (name === 'physicTick') console.warn('Mineflayer detected that you are using a deprecated event (physicTick)! Please use this event (physicsTick) instead.')
  })

  function cleanup () {
    clearInterval(doPhysicsTimer)
    doPhysicsTimer = null
    cancelRespawnReply()
    clearTimeout(replyTimer)
    replyTimer = null
    pendingReplies.length = 0
  }

  function sendPacketPosition (position: Vec3, onGround: boolean) {
    // sends data, no logic
    if (bot._client.state !== 'play') return
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) return
    const oldPos = new Vec3(lastSent.x, lastSent.y, lastSent.z)
    lastSent.x = position.x
    lastSent.y = position.y
    lastSent.z = position.z
    lastSent.onGround = onGround
    lastSent.flags = { onGround, hasHorizontalCollision: undefined } // 1.21.3+
    bot._client.write('position', lastSent)
    bot.emit('move', oldPos)
  }

  function sendPacketLook (yaw: number, pitch: number, onGround: boolean) {
    // sends data, no logic
    if (bot._client.state !== 'play') return
    const oldPos = new Vec3(lastSent.x, lastSent.y, lastSent.z)
    lastSent.yaw = yaw
    lastSent.pitch = pitch
    lastSent.onGround = onGround
    lastSent.flags = { onGround, hasHorizontalCollision: undefined } // 1.21.3+
    bot._client.write('look', lastSent)
    bot.emit('move', oldPos)
  }

  // send false: the position was already sent another way (26.3+ teleport_confirm), only record it
  function sendPacketPositionAndLook (position: Vec3, yaw: number, pitch: number, onGround: boolean, send = true) {
    // sends data, no logic
    if (bot._client.state !== 'play') return
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) return
    const oldPos = new Vec3(lastSent.x, lastSent.y, lastSent.z)
    lastSent.x = position.x
    lastSent.y = position.y
    lastSent.z = position.z
    lastSent.yaw = yaw
    lastSent.pitch = pitch
    lastSent.onGround = onGround
    lastSent.flags = { onGround, hasHorizontalCollision: undefined } // 1.21.3+
    if (send) bot._client.write('position_look', lastSent)
    bot.emit('move', oldPos)
  }

  function deltaYaw (yaw1: number, yaw2: number | null) {
    let dYaw = (yaw1 - (yaw2 as number)) % PI_2 // null (no teleport answered yet) counts as 0
    if (dYaw < -PI) dYaw += PI_2
    else if (dYaw > PI) dYaw -= PI_2

    return dYaw
  }

  // returns false if bot should send position packets
  function isEntityRemoved () {
    if (bot.isAlive === true) deadTicks = 0
    if (bot.isAlive === false && deadTicks <= 20) deadTicks++
    if (deadTicks >= 20) return true
    return false
  }

  function updatePosition (now: number) {
    // Only send updates for 20 ticks after death
    if (isEntityRemoved()) return
    // Don't send position with invalid coordinates (NaN after death)
    if (!Number.isFinite(bot.entity.position.x)) return

    sendInputState()

    // Increment the yaw in baby steps so that notchian clients (not the server) can keep up.
    const dYaw = deltaYaw(bot.entity.yaw, lastSentYaw)
    const dPitch = bot.entity.pitch - (lastSentPitch || 0)

    // Vanilla doesn't clamp yaw, so we don't want to do it either
    const maxDeltaYaw = PHYSICS_TIMESTEP * physics.yawSpeed
    const maxDeltaPitch = PHYSICS_TIMESTEP * physics.pitchSpeed
    // physics only runs once a teleport was answered, which sets both
    lastSentYaw! += math.clamp(-maxDeltaYaw, dYaw, maxDeltaYaw)
    lastSentPitch! += math.clamp(-maxDeltaPitch, dPitch, maxDeltaPitch)

    const yaw = Math.fround(conv.toNotchianYaw(lastSentYaw!))
    const pitch = Math.fround(conv.toNotchianPitch(lastSentPitch!))
    const position = bot.entity.position
    const onGround = bot.entity.onGround

    // Only send a position update if necessary, select the appropriate packet
    const positionUpdated = lastSent.x !== position.x || lastSent.y !== position.y || lastSent.z !== position.z ||
      // Send a position update every second, even if no other update was made
      // This function rounds to the nearest 50ms (or PHYSICS_INTERVAL_MS) and checks if a second has passed.
      (Math.round((now - lastSent.time) / PHYSICS_INTERVAL_MS) * PHYSICS_INTERVAL_MS) >= 1000
    const lookUpdated = lastSent.yaw !== yaw || lastSent.pitch !== pitch

    if (positionUpdated && lookUpdated) {
      sendPacketPositionAndLook(position, yaw, pitch, onGround)
      lastSent.time = now // only reset if positionUpdated is true
    } else if (positionUpdated) {
      sendPacketPosition(position, onGround)
      lastSent.time = now // only reset if positionUpdated is true
    } else if (lookUpdated) {
      sendPacketLook(yaw, pitch, onGround)
    } else if (positionUpdateSentEveryTick || onGround !== lastSent.onGround) {
      // For versions < 1.12, one player packet should be sent every tick
      // for the server to update health correctly
      // For versions >= 1.12, onGround !== lastSent.onGround should be used, but it doesn't ever trigger outside of login
      bot._client.write('flying', {
        onGround: bot.entity.onGround,
        flags: { onGround: bot.entity.onGround, hasHorizontalCollision: undefined } // 1.21.3+
      })
    }

    lastSent.onGround = bot.entity.onGround // onGround is always set
  }

  bot.physics = physics
  const DEFAULT_GRAVITY = physics.gravity
  const gravityResource = bot.registry.attributesArray.find(attribute => attribute.name === 'gravity')?.resource ?? ''

  // The entities a tick can reach (the client knows them all; a tick moves the player well under 8 blocks): the
  // engine collides with the solid ones (boats, shulkers) and is pushed by the mobs it touches
  const ENTITY_REACH = 8
  function nearbyEntities (): PhysicsEntity[] {
    const pos = bot.entity.position
    const result: PhysicsEntity[] = []
    for (const entity of Object.values(bot.entities)) {
      if (entity === bot.entity || entity === bot.vehicle || entity.isValid === false || !entity.name) continue
      const at = entity.position
      if (Math.abs(at.x - pos.x) > ENTITY_REACH || Math.abs(at.y - pos.y) > ENTITY_REACH || Math.abs(at.z - pos.z) > ENTITY_REACH) continue
      result.push({ id: entity.id, type: entity.name, pos: at.clone(), vel: entity.velocity.clone() })
    }
    return result
  }

  // ServerboundPlayerAbilitiesPacket: since 1.16 only the flying bit, before every ability and both speeds
  function sendAbilities () {
    const abilities = bot.abilities
    if (bot.registry.version['>=']('1.16')) {
      bot._client.write('abilities', { flags: abilities.flying ? 2 : 0 })
    } else {
      const flags = (abilities.invulnerable ? 1 : 0) | (abilities.flying ? 2 : 0) | (abilities.mayFly ? 4 : 0) | (abilities.instantBuild ? 8 : 0)
      bot._client.write('abilities', { flags, flyingSpeed: abilities.flyingSpeed, walkingSpeed: abilities.walkingSpeed })
    }
  }

  // The engine reads the attributes by minecraft-data's resource names. Before 1.20.5 the packet names the
  // attribute, with or without the minecraft: namespace; since, it carries the registry id, which
  // minecraft-protocol decodes with a mapper that lags the registry on 1.21+ (1.21.11 decodes movement_speed
  // as generic.scale): a decoded name goes back to its id, then to the registry's attribute.
  const attributeResources = new Map<string, string>()
  const bareName = (name: string) => name.replace(/^minecraft:/, '')
  {
    const protocol = bot.registry.protocol as { play?: { toClient?: { types?: { [name: string]: unknown } } } }
    const packetType = JSON.stringify(protocol.play?.toClient?.types?.['packet_entity_update_attributes'] ?? null)
    const mappings = packetType.match(/"mappings":(\{[^}]*\})/)
    if (mappings) {
      for (const [id, name] of Object.entries(JSON.parse(mappings[1]!) as { [id: string]: string })) {
        const attribute = bot.registry.attributesArray[Number(id)]
        if (attribute) attributeResources.set(bareName(name), attribute.resource)
      }
    } else {
      for (const attribute of bot.registry.attributesArray) attributeResources.set(bareName(attribute.resource), attribute.resource)
    }
  }

  // An entity's attributes as the engine reads them. The server's copy of the sprint modifier is left out: the
  // engine adds the client's own while it sprints (vanilla replaces one with the other, they share an id).
  function engineAttributes (attributes: Entity['attributes']): { [resource: string]: PhysicsAttribute } | undefined {
    if (!attributes) return undefined
    const result: { [resource: string]: PhysicsAttribute } = {}
    for (const [key, attribute] of Object.entries(attributes)) {
      const resource = attributeResources.get(bareName(key))
      if (resource === undefined) continue
      result[resource] = {
        value: attribute.value,
        modifiers: attribute.modifiers.filter(m => m.uuid !== SPRINT_MODIFIER_UUID && !String(m.uuid).endsWith('sprinting'))
      }
    }
    return result
  }

  function getEffectLevel (mcData: IndexedData, effectName: string, effects: Effect[]) {
    const effectDescriptor = mcData.effectsByName[effectName]
    if (!effectDescriptor) {
      return 0
    }
    const effectInfo = effects[effectDescriptor.id]
    if (!effectInfo) {
      return 0
    }
    return effectInfo.amplifier + 1
  }

  bot.elytraFly = async () => {
    if (bot.entity.elytraFlying) {
      throw new Error('Already elytra flying')
    } else if (bot.entity.onGround) {
      throw new Error('Unable to fly from ground')
    } else if (bot.entity.isInWater) {
      throw new Error('Unable to elytra fly while in water')
    }

    const mcData = minecraftData(bot.version)
    if (getEffectLevel(mcData, 'Levitation', bot.entity.effects) > 0) {
      throw new Error('Unable to elytra fly with levitation effect')
    }

    const torsoSlot = bot.getEquipmentDestSlot('torso')
    const item = bot.inventory.slots[torsoSlot]
    if (item == null || item.name !== 'elytra') {
      throw new Error('Elytra must be equip to start flying')
    }
    bot._client.write('entity_action', {
      entityId: bot.entity.id,
      actionId: bot.supportFeature('entityActionUsesStringMapper') ? 'start_elytra_flying' : 8,
      jumpBoost: 0
    })
  }

  bot.setControlState = (control, state) => {
    assert.ok(control in controlState, `invalid control: ${control}`)
    assert.ok(typeof state === 'boolean', `invalid state: ${state}`)
    if (controlState[control] === state) return
    controlState[control] = state
    if (control === 'jump' && state) {
      bot.jumpQueued = true
    }
    // the keys reach the server with the next tick's packets (sendInputState)
  }

  // What the server hears of the keys, sent each tick before the movement packet like vanilla's
  // LocalPlayer.sendPosition: 1.21.2+ the keys themselves (player_input) when one changed; the sprint
  // state when it changed (the sprint the engine decided: it needs forward, food, no blindness...);
  // before player_input, the sneak key when it changed.
  const NO_INPUT = 'false,false,false,false,false,false,false'
  let sentInput = NO_INPUT
  let sentSprinting = false
  let sentSneaking = false
  function sendInputState () {
    if (bot.supportFeature('newPlayerInputPacket')) {
      const inputs = {
        forward: controlState.forward,
        backward: controlState.back,
        left: controlState.left,
        right: controlState.right,
        jump: controlState.jump,
        shift: controlState.sneak,
        sprint: controlState.sprint
      }
      const keys = Object.values(inputs).join()
      if (keys !== sentInput) {
        sentInput = keys
        bot._client.write('player_input', { inputs })
      }
    }
    const sprinting = bot.physicsEnabled ? !!bot.entity.sprinting : controlState.sprint
    if (sprinting !== sentSprinting) {
      sentSprinting = sprinting
      bot._client.write('entity_action', {
        entityId: bot.entity.id,
        actionId: bot.supportFeature('entityActionUsesStringMapper')
          ? (sprinting ? 'start_sprinting' : 'stop_sprinting')
          : (sprinting ? 3 : 4),
        jumpBoost: 0
      })
    }
    if (!bot.supportFeature('newPlayerInputPacket') && controlState.sneak !== sentSneaking) {
      sentSneaking = controlState.sneak
      bot._client.write('entity_action', {
        entityId: bot.entity.id,
        actionId: sentSneaking ? 0 : 1,
        jumpBoost: 0
      })
    }
  }
  function resetInputState () {
    // a new player entity (login, respawn) starts with no keys, not sprinting, not sneaking on the server
    sentInput = NO_INPUT
    sentSprinting = false
    sentSneaking = false
  }

  bot.getControlState = (control) => {
    assert.ok(control in controlState, `invalid control: ${control}`)
    return controlState[control]
  }

  bot.clearControlStates = () => {
    for (const control in controlState) {
      bot.setControlState(control as ControlState, false)
    }
  }

  bot.controlState = {} as ControlStateStatus // accessors defined below

  for (const control of Object.keys(controlState) as ControlState[]) {
    Object.defineProperty(bot.controlState, control, {
      enumerable: true,
      get () {
        return controlState[control]
      },
      set (state) {
        bot.setControlState(control, state)
        return state
      }
    })
  }

  let lookingTask = createDoneTask()

  bot.on('move', () => {
    if (!lookingTask.done && Math.abs(deltaYaw(bot.entity.yaw, lastSentYaw)) < 0.001) {
      lookingTask.finish()
    }
  })

  bot._client.on('explosion', explosion => {
    // TODO: emit an explosion event with more info
    if (bot.physicsEnabled && bot.game.gameMode !== 'creative') {
      if (explosion.playerKnockback) { // 1.21.3+
        // Fixes issue #3635
        bot.entity.velocity.x += explosion.playerKnockback.x
        bot.entity.velocity.y += explosion.playerKnockback.y
        bot.entity.velocity.z += explosion.playerKnockback.z
      }
      if ('playerMotionX' in explosion) {
        bot.entity.velocity.x += explosion.playerMotionX!
        bot.entity.velocity.y += explosion.playerMotionY!
        bot.entity.velocity.z += explosion.playerMotionZ!
      }
    }
  })

  bot.look = async (yaw, pitch, force) => {
    if (!lookingTask.done) {
      lookingTask.finish() // finish the previous one
    }
    lookingTask = createTask()

    // this is done to bypass certain anticheat checks that detect the player's sensitivity
    // by calculating the gcd of how much they move the mouse each tick
    const sensitivity = conv.fromNotchianPitch(0.15) // this is equal to 100% sensitivity in vanilla
    const yawChange = Math.round((yaw - bot.entity.yaw) / sensitivity) * sensitivity
    const pitchChange = Math.round((pitch - bot.entity.pitch) / sensitivity) * sensitivity

    if (yawChange === 0 && pitchChange === 0) {
      return
    }

    bot.entity.yaw += yawChange
    bot.entity.pitch += pitchChange

    if (force) {
      lastSentYaw = yaw
      lastSentPitch = pitch
      return
    }

    await lookingTask.promise
  }

  bot.lookAt = async (point, force) => {
    const delta = point.minus(bot.entity.position.offset(0, bot.entity.eyeHeight, 0))
    const yaw = Math.atan2(-delta.x, -delta.z)
    const groundDistance = Math.sqrt(delta.x * delta.x + delta.z * delta.z)
    const pitch = Math.atan2(delta.y, groundDistance)
    await bot.look(yaw, pitch, force)
  }

  // 1.21.3+
  bot._client.on('player_rotation', (packet) => {
    bot.entity.yaw = conv.fromNotchianYaw(packet.yaw)
    bot.entity.pitch = conv.fromNotchianPitch(packet.pitch)
  })

  // player position and look (clientbound)
  // The vanilla client hands every play packet to the client thread, which drains the queue at the
  // start of a tick (PacketUtils.ensureRunningOnSameThread) and writes each reply as the packet is
  // handled. So a teleport is answered at most once per tick however fast the server sends them,
  // and replies to different packets (a pong, a teleport confirm) leave in packet arrival order.
  const pendingReplies: Reply[] = []
  let replyTimer: ReturnType<typeof setTimeout> | null = null

  function flushReplies () {
    clearTimeout(replyTimer)
    replyTimer = null
    if (bot._client.state !== 'play') return
    while (pendingReplies.length) pendingReplies.shift()!()
  }

  bot._replyOnNextTick = (reply) => {
    pendingReplies.push(reply)
    // While no tick is running (the login packet starts it) a reply waits at most one tick.
    if (doPhysicsTimer === null && replyTimer === null) replyTimer = setTimeout(flushReplies, PHYSICS_INTERVAL_MS)
  }
  // The teleport's state is applied as the packet arrives, like the handlers around it
  // (player_rotation, entity_velocity), so a later packet is not overwritten by an earlier teleport.
  // Only the reply waits for the next tick, carrying the values this teleport set.
  bot._client.on('position', (packet) => {
    // A newer teleport supersedes the one a deferred reply would answer.
    cancelRespawnReply()
    // Is this necessary? Feels like it might wrongly overwrite hitbox size sometimes
    // e.g. when crouching/crawling/swimming. Can someone confirm?
    bot.entity.height = 1.8

    const vel = bot.entity.velocity
    const pos = bot.entity.position
    let newYaw: number, newPitch: number

    // Note: 1.20.5+ uses a bitflags object, older versions use a bitmask number
    if (typeof packet.flags === 'object' && packet.dx !== undefined) {
      // 1.21.2+: the packet carries a velocity, like vanilla PositionMoveRotation.calculateAbsolute.
      // Position and rotation are absolute or, with their flag, relative; the pitch is clamped.
      const flags = packet.flags
      pos.set(
        (flags.x ? pos.x : 0) + packet.x,
        (flags.y ? pos.y : 0) + packet.y,
        (flags.z ? pos.z : 0) + packet.z
      )
      const oldYaw = conv.toNotchianYaw(bot.entity.yaw)
      const oldPitch = conv.toNotchianPitch(bot.entity.pitch)
      newYaw = (flags.yaw ? oldYaw : 0) + packet.yaw
      newPitch = math.clamp(-90, (flags.pitch ? oldPitch : 0) + packet.pitch, 90)
      // yawDelta (rotate delta): the kept velocity turns with the rotation change
      if (flags.yawDelta) math.rotateDeltaMovement(vel, oldPitch - newPitch, oldYaw - newYaw)
      // The velocity is absolute or, with its dx/dy/dz flag, added to the current one
      vel.set(
        (flags.dx ? vel.x : 0) + packet.dx,
        (flags.dy ? vel.y : 0) + packet.dy!,
        (flags.dz ? vel.z : 0) + packet.dz!
      )
    } else if (typeof packet.flags === 'object') {
      // 1.20.5 - 1.21.1: bitflags object
      // Velocity is only set to 0 if the flag is not set, otherwise keep current velocity
      vel.set(
        packet.flags.x ? vel.x : 0,
        packet.flags.y ? vel.y : 0,
        packet.flags.z ? vel.z : 0
      )
      // If flag is set, then the corresponding value is relative, else it is absolute
      pos.set(
        packet.flags.x ? (pos.x + packet.x) : packet.x,
        packet.flags.y ? (pos.y + packet.y) : packet.y,
        packet.flags.z ? (pos.z + packet.z) : packet.z
      )
      newYaw = (packet.flags.yaw ? conv.toNotchianYaw(bot.entity.yaw) : 0) + packet.yaw
      newPitch = (packet.flags.pitch ? conv.toNotchianPitch(bot.entity.pitch) : 0) + packet.pitch
    } else {
      // Legacy path with bitmask number
      // Velocity is only set to 0 if the flag is not set, otherwise keep current velocity
      vel.set(
        packet.flags & 1 ? vel.x : 0,
        packet.flags & 2 ? vel.y : 0,
        packet.flags & 4 ? vel.z : 0
      )
      // If flag is set, then the corresponding value is relative, else it is absolute
      pos.set(
        packet.flags & 1 ? (pos.x + packet.x) : packet.x,
        packet.flags & 2 ? (pos.y + packet.y) : packet.y,
        packet.flags & 4 ? (pos.z + packet.z) : packet.z
      )
      newYaw = (packet.flags & 8 ? conv.toNotchianYaw(bot.entity.yaw) : 0) + packet.yaw
      newPitch = (packet.flags & 16 ? conv.toNotchianPitch(bot.entity.pitch) : 0) + packet.pitch
    }

    bot.entity.yaw = conv.fromNotchianYaw(newYaw)
    bot.entity.pitch = conv.fromNotchianPitch(newPitch)
    bot.entity.onGround = false
    bot.jumpTicks = 0

    const teleportPos = pos.clone()
    const reply: Reply = () => answerTeleport(packet.teleportId, teleportPos, newYaw, newPitch)
    reply.teleport = true
    bot._replyOnNextTick(reply)
  })

  function answerTeleport (teleportId: number | undefined, pos: Vec3, yaw: number, pitch: number) {
    if (bot.supportFeature('teleportUsesOwnPacket')) {
      // 1.9+: position has teleportId. 26.3+ also echoes the resolved position and rotation
      // (older protocols do not serialize the extra fields).
      bot._client.write('teleport_confirm', { teleportId: teleportId!, x: pos.x, y: pos.y, z: pos.z, yaw, pitch })
    }
    // 26.3+: the confirm carries the position and is the client's move packet for this tick (the
    // server allows one per tick), so no position_look follows it
    const sendMove = !confirmHasPosition

    const confirmMove = () => {
      shouldUsePhysics = true
      lastSentYaw = conv.fromNotchianYaw(yaw)
      lastSentPitch = conv.fromNotchianPitch(pitch)
      bot.emit('forcedMove')
    }

    // After death/respawn, delay the forced position_look response.
    // Sending it immediately causes "Invalid move player packet" kicks
    // on older servers, but the server needs it to complete the respawn.
    if (respawnTimer > 0 && Date.now() - respawnTimer < 2000) {
      respawnTimer = 0 // only delay once
      respawnReply = setTimeout(() => {
        respawnReply = null
        sendPacketPositionAndLook(pos, yaw, pitch, false, sendMove)
        confirmMove()
      }, 1500)
      return
    }

    sendPacketPositionAndLook(pos, yaw, pitch, false, sendMove)
    confirmMove()
  }

  bot.waitForTicks = async function (ticks) {
    if (ticks <= 0) return
    await new Promise<void>((resolve, reject) => {
      // Assuming 20 ticks per second, add extra time for lag
      const timeout = setTimeout(() => {
        bot.removeListener('physicsTick', tickListener)
        reject(new Error(`Timeout waiting for ${ticks} ticks after ${(ticks * 50 + 5000)}ms`))
      }, ticks * 50 + 5000) // 50ms per tick + 5s buffer

      const tickListener = () => {
        ticks--
        if (ticks === 0) {
          clearTimeout(timeout)
          bot.removeListener('physicsTick', tickListener)
          resolve()
        }
      }

      bot.on('physicsTick', tickListener)
    })
  }

  let respawnTimer = 0
  // The deferred respawn reply answers one teleport of the current play session. The server only
  // accepts a reply to its latest teleport, and once the client leaves play (start_configuration)
  // or a new session begins (login) the position it carries means nothing to the server and the
  // play-state packet cannot be written anyway.
  let respawnReply: ReturnType<typeof setTimeout> | null = null
  function cancelRespawnReply () {
    clearTimeout(respawnReply)
    respawnReply = null
  }
  bot.on('mount', () => { shouldUsePhysics = false })
  bot.on('death', () => {
    shouldUsePhysics = false
    respawnTimer = Date.now()
  })
  bot.on('respawn', () => {
    shouldUsePhysics = false
    resetInputState()
    // A teleport queued before the respawn positioned the bot in the old world; answering it now
    // would turn physics back on before the server has placed the bot in the new one. Pongs stay
    // queued, as transaction-ordering anticheats expect every ping answered in order.
    for (let i = pendingReplies.length - 1; i >= 0; i--) {
      if (pendingReplies[i]!.teleport) pendingReplies.splice(i, 1)
    }
  })
  bot.on('login', () => {
    shouldUsePhysics = false
    resetInputState()
    cancelRespawnReply()
    // A reply still queued here belongs to the world the bot just left, and its id means nothing
    // to the server it is about to talk to.
    pendingReplies.length = 0
    if (doPhysicsTimer === null) {
      lastPhysicsFrameTime = performance.now()
      doPhysicsTimer = setInterval(doPhysics, PHYSICS_INTERVAL_MS)
    }
  })
  // A proxy (e.g. Velocity) transferring us to another server makes the client
  // re-enter the configuration phase, during which play-state movement packets
  // are not allowed. Physics is re-enabled by the position packet handler once
  // the server finishes configuration and play resumes.
  if (hasConfigurationState) {
    bot._client.on('start_configuration', () => {
      shouldUsePhysics = false
      cancelRespawnReply()
    })
  }
  // Replies queued in play are meaningless once the client leaves it (e.g. reconfiguration).
  bot._client.on('state', (state) => {
    if (state !== 'play') pendingReplies.length = 0
  })
  bot.on('end', cleanup)
}
