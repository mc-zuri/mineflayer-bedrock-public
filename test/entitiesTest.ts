// Regression tests for the entities plugin on a fake bot: packets are emitted straight on a
// fake client, no server involved.
import EventEmitter from 'events'
import assert from 'assert'
import prismarineRegistry from 'prismarine-registry'
import { Vec3 } from 'vec3'
import * as conv from '../lib/conversions.ts'
import entitiesPlugin from '../lib/plugins/entities.ts'
import fishingPlugin from '../lib/plugins/fishing.ts'
import rayTracePlugin from '../lib/plugins/ray_trace.ts'
import bedPlugin from '../lib/plugins/bed.ts'
import creativePlugin from '../lib/plugins/creative.ts'
import placeEntityPlugin from '../lib/plugins/place_entity.ts'
import prismarineItem from 'prismarine-item'
import mc from 'minecraft-protocol'

function createFakeBot (version: string) {
  const registry = prismarineRegistry(version)
  const bot: any = new EventEmitter()
  bot.version = version
  bot.registry = registry
  bot.supportFeature = registry.supportFeature.bind(registry)
  bot.getControlState = () => false
  const client: any = new EventEmitter()
  client.username = 'bot'
  client.writes = []
  client.write = (name: string, params: unknown) => { client.writes.push({ name, params }) }
  bot._client = client
  entitiesPlugin(bot)
  client.emit('login', { entityId: 1 })
  return bot
}

describe('entities plugin', () => {
  describe('entity_status hand swap', () => {
    for (const version of ['1.12.2', '1.20.4']) {
      it(`swaps main and off hand without throwing (${version})`, () => {
        const bot = createFakeBot(version)
        const entity = bot.entities[1]
        const main = { name: 'main' }
        const off = { name: 'off' }
        entity.equipment[0] = main
        entity.equipment[1] = off
        let swapped = 0
        bot.on('entityHandSwap', () => { swapped++ })
        bot._client.emit('entity_status', { entityId: 1, entityStatus: 55 })
        assert.strictEqual(swapped, 1)
        assert.strictEqual(entity.equipment[0], off)
        assert.strictEqual(entity.equipment[1], main)
        assert.strictEqual(entity.heldItem, off)
      })
    }
  })

  describe('damage_event (1.20+)', () => {
    it('emits entityHurt with an Entity for an entity id the bot has not seen', () => {
      const bot = createFakeBot('1.20.4')
      const hurt: Array<[any, any]> = []
      bot.on('entityHurt', (entity: any, source: any) => { hurt.push([entity, source]) })
      // no source (sourceCauseId 0)
      bot._client.emit('damage_event', { entityId: 42, sourceTypeId: 0, sourceCauseId: 0, sourceDirectId: 0 })
      // the bot as the source (sourceCauseId is the id + 1)
      bot._client.emit('damage_event', { entityId: 43, sourceTypeId: 0, sourceCauseId: 2, sourceDirectId: 2 })
      assert.strictEqual(hurt.length, 2)
      assert.ok(hurt[0]![0], 'entityHurt must not be emitted with an undefined entity')
      assert.strictEqual(hurt[0]![0].id, 42)
      assert.strictEqual(hurt[0]![0], bot.entities[42])
      assert.strictEqual(hurt[0]![1], undefined)
      assert.strictEqual(hurt[1]![0].id, 43)
      assert.strictEqual(hurt[1]![1], bot.entities[1])
    })
  })

  describe('attach_entity (1.8 riding)', () => {
    it('keeps vehicle.passengers in step with entity.vehicle', () => {
      const bot = createFakeBot('1.8.8')
      const events: string[] = []
      bot.on('entityAttach', (entity: any, vehicle: any) => {
        events.push(`attach ${entity.id} ${vehicle.id} ${entity.vehicle?.id}`)
      })
      bot.on('entityDetach', (entity: any, vehicle: any) => {
        events.push(`detach ${entity.id} ${vehicle?.id} ${entity.vehicle?.id}`)
      })
      bot.on('mount', () => events.push('mount'))
      bot.on('dismount', (vehicle: any) => events.push(`dismount ${vehicle?.id}`))
      bot._client.emit('attach_entity', { entityId: 2, vehicleId: 7, leash: false })
      bot._client.emit('attach_entity', { entityId: 1, vehicleId: 8, leash: false })
      const cart7 = bot.entities[7]
      const cart8 = bot.entities[8]
      assert.deepStrictEqual(cart7.passengers.map((e: any) => e.id), [2])
      assert.deepStrictEqual(cart8.passengers.map((e: any) => e.id), [1])
      assert.strictEqual(bot.vehicle, cart8)

      // the bot switches carts: it leaves 8, and 7 keeps its passenger 2
      bot._client.emit('attach_entity', { entityId: 1, vehicleId: 7, leash: false })
      assert.deepStrictEqual(cart8.passengers.map((e: any) => e.id), [])
      assert.deepStrictEqual(cart7.passengers.map((e: any) => e.id), [2, 1])

      bot._client.emit('attach_entity', { entityId: 1, vehicleId: -1, leash: false })
      assert.deepStrictEqual(cart7.passengers.map((e: any) => e.id), [2])
      assert.strictEqual(bot.entity.vehicle, null)
      assert.strictEqual(bot.vehicle, null)
      assert.deepStrictEqual(events, ['attach 2 7 7', 'attach 1 8 8', 'mount', 'attach 1 7 7', 'mount', 'detach 1 7 undefined', 'dismount 7'])
    })
  })

  describe('attach_entity (leash)', () => {
    for (const [version, leash] of [['1.8.8', true], ['1.12.2', undefined], ['1.20.4', undefined], ['1.21.11', undefined]] as const) {
      it(`a leash is not riding (${version})`, () => {
        const bot = createFakeBot(version)
        const events: string[] = []
        for (const event of ['entityAttach', 'entityDetach', 'mount', 'dismount']) bot.on(event, () => events.push(event))
        bot._client.emit('entity_head_rotation', { entityId: 7, headYaw: 0 }) // makes entity 7 known
        // the bot (and entity 2) are leashed to entity 7, then unleashed
        bot._client.emit('attach_entity', { entityId: 1, vehicleId: 7, leash })
        bot._client.emit('attach_entity', { entityId: 2, vehicleId: 7, leash })
        assert.ok(!bot.vehicle) // undefined before any mount
        assert.ok(!bot.entity.vehicle)
        assert.deepStrictEqual(bot.entities[7].passengers, [])
        bot._client.emit('attach_entity', { entityId: 1, vehicleId: -1, leash })
        assert.ok(!bot.vehicle)
        assert.deepStrictEqual(events, [])
      })
    }
  })

  describe('set_passengers (1.9+ riding)', () => {
    for (const version of ['1.12.2', '1.20.4', '1.21.11']) {
      it(`a passenger missing from the new list has dismounted (${version})`, () => {
        const bot = createFakeBot(version)
        const events: string[] = []
        bot.on('mount', () => events.push('mount'))
        bot.on('dismount', (vehicle: any) => events.push(`dismount ${vehicle?.id}`))
        bot.on('entityAttach', (entity: any, vehicle: any) => events.push(`attach ${entity.id} ${vehicle.id}`))
        bot.on('entityDetach', (entity: any, vehicle: any) => events.push(`detach ${entity.id} ${vehicle.id}`))
        bot._client.emit('entity_head_rotation', { entityId: 7, headYaw: 0 }) // makes entity 7 known
        bot._client.emit('set_passengers', { entityId: 7, passengers: [1, 2] })
        const boat = bot.entities[7]
        assert.strictEqual(bot.vehicle, boat)
        assert.deepStrictEqual(boat.passengers.map((e: any) => e.id), [1, 2])

        // vanilla dismount: the server resends the vehicle's passengers without the bot
        bot._client.emit('set_passengers', { entityId: 7, passengers: [2] })
        assert.strictEqual(bot.vehicle, null)
        assert.strictEqual(bot.entity.vehicle, null)
        assert.deepStrictEqual(boat.passengers.map((e: any) => e.id), [2])
        assert.strictEqual(bot.entities[2].vehicle, boat)

        bot._client.emit('set_passengers', { entityId: 7, passengers: [] })
        assert.strictEqual(bot.entities[2].vehicle, null)
        assert.deepStrictEqual(boat.passengers, [])
        // set_passengers is the riding packet from 1.9: it emits the riding events (once per change)
        assert.deepStrictEqual(events, ['attach 1 7', 'attach 2 7', 'mount', 'detach 1 7', 'dismount 7', 'detach 2 7'])
      })
    }
  })

  describe('bot.vehicle', () => {
    it('is null before any riding packet and after a new login', () => {
      const bot = createFakeBot('1.20.4')
      assert.strictEqual(bot.vehicle, null)
      bot._client.emit('entity_head_rotation', { entityId: 7, headYaw: 0 }) // makes entity 7 known
      bot._client.emit('set_passengers', { entityId: 7, passengers: [1] })
      assert.strictEqual(bot.vehicle, bot.entities[7])
      // a new login (e.g. a proxy server switch) forgets every entity, the vehicle too
      bot._client.emit('login', { entityId: 1 })
      assert.strictEqual(bot.vehicle, null)
    })
  })

  describe('entity velocity units', () => {
    // vec3i16 in 1/8000 block per tick before 1.21.9, lpVec3 in blocks per tick after
    for (const [version, wire] of [['1.20.4', { x: 4000, y: 3360, z: -800 }], ['1.21.11', { x: 0.5, y: 0.42, z: -0.1 }]] as const) {
      it(`entity_velocity and spawn_entity set blocks per tick (${version})`, () => {
        const bot = createFakeBot(version)
        const expected = [0.5, 0.42, -0.1]
        const round = (v: any) => v.toArray().map((n: number) => Math.round(n * 1e6) / 1e6)
        bot._client.emit('entity_velocity', { entityId: 1, velocity: wire })
        assert.deepStrictEqual(round(bot.entity.velocity), expected)
        const zombie = bot.registry.entitiesByName.zombie.id
        const spawn = { entityId: 5, objectUUID: '00000000-0000-0000-0000-000000000005', type: zombie, objectData: 0, velocity: wire }
        bot._client.emit('spawn_entity', { ...spawn, x: 0, y: 64, z: 0, pitch: 0, yaw: 0, headPitch: 0 })
        assert.deepStrictEqual(round(bot.entities[5].velocity), expected)
      })
    }
  })

  describe('entity_teleport 1.21.3+', () => {
    for (const version of ['1.21.4', '1.21.11']) {
      it(`applies relative flags, velocity and degree rotation (${version})`, () => {
        const bot = createFakeBot(version)
        const round = (v: any) => v.toArray().map((n: number) => Math.round(n * 1e6) / 1e6)
        const teleport = (fields: object) => bot._client.emit('entity_teleport', {
          entityId: 5, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, yaw: 0, pitch: 0, flags: {}, onGround: true, ...fields
        })
        teleport({ x: 10, y: 64, z: -3, dx: 0.25, yaw: 90, pitch: 30 })
        const entity = bot.entities[5]
        assert.deepStrictEqual(round(entity.position), [10, 64, -3])
        assert.deepStrictEqual(round(entity.velocity), [0.25, 0, 0])
        assert.strictEqual(entity.yaw, conv.fromNotchianYaw(90))
        assert.strictEqual(entity.pitch, conv.fromNotchianPitch(30))

        teleport({ x: 1, y: -1, z: 0.5, dx: 0.5, dy: 0.1, yaw: 10, pitch: -5, flags: { x: true, y: true, z: true, dx: true, yaw: true, pitch: true } })
        assert.deepStrictEqual(round(entity.position), [11, 63, -2.5])
        assert.deepStrictEqual(round(entity.velocity), [0.75, 0.1, 0])
        assert.strictEqual(Math.round(entity.yaw * 1e9), Math.round(conv.fromNotchianYaw(100) * 1e9))
        assert.strictEqual(Math.round(entity.pitch * 1e9), Math.round(conv.fromNotchianPitch(25) * 1e9))
      })

      it(`yawDelta turns the kept velocity with the rotation (${version})`, () => {
        const bot = createFakeBot(version)
        const round = (v: any) => v.toArray().map((n: number) => Math.round(n * 1e6) / 1e6 + 0)
        const teleport = (fields: object) => bot._client.emit('entity_teleport', {
          entityId: 5, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, yaw: 0, pitch: 0, flags: {}, onGround: true, ...fields
        })
        teleport({ dx: 1, dz: 0.5 }) // yaw 0, velocity (1, 0, 0.5)
        const entity = bot.entities[5]
        // vanilla: from yaw 0 to 90 turns the velocity by -90 degrees around y: (x, z) -> (-z, x); dz is then added
        teleport({ yaw: 90, dz: 0.25, flags: { dx: true, dy: true, dz: true, yawDelta: true } })
        assert.deepStrictEqual(round(entity.velocity), [-0.5, 0, 1.25])
        assert.strictEqual(entity.yaw, conv.fromNotchianYaw(90))
        // pitch from 0 to -90 (absolute) turns (0, 0, z) up into y: (y, z) -> (y cos 90 + z sin 90, ...)
        teleport({ yaw: 90, pitch: -90, flags: { dx: true, dy: true, dz: true, yawDelta: true } })
        assert.deepStrictEqual(round(entity.velocity), [-0.5, 1.25, 0])
        // without the flag the velocity is kept as is
        teleport({ yaw: 0, pitch: 0, flags: { dx: true, dy: true, dz: true } })
        assert.deepStrictEqual(round(entity.velocity), [-0.5, 1.25, 0])
      })
    }
  })

  describe('player_info before 1.19.3', () => {
    for (const version of ['1.8.8', '1.12.2', '1.19.2']) {
      it(`update_game_mode updates the player's gamemode (${version})`, () => {
        const bot = createFakeBot(version)
        const uuid = '00000000-0000-0000-0000-000000000002'
        bot._client.emit('player_info', {
          action: 'add_player',
          data: [{ uuid, name: 'other', properties: [], gamemode: 0, ping: 5 }]
        })
        assert.strictEqual(bot.players.other.gamemode, 0)
        let updated = 0
        bot.on('playerUpdated', () => { updated++ })
        bot._client.emit('player_info', { action: 'update_game_mode', data: [{ uuid, gamemode: 1 }] })
        assert.strictEqual(bot.players.other.gamemode, 1)
        assert.strictEqual(updated, 1)
      })
    }
  })

  describe('a new login (proxy server switch)', () => {
    it('emits entityGone for the entities and playerLeft for the players it clears', () => {
      const bot = createFakeBot('1.12.2')
      bot._client.emit('player_info', { action: 'add_player', data: [{ uuid: '00000000-0000-0000-0000-000000000002', name: 'other', properties: [], gamemode: 0, ping: 5 }] })
      bot._client.emit('entity_head_rotation', { entityId: 5, headYaw: 0 }) // makes entity 5 known
      const oldBotEntity = bot.entity
      const other = bot.players.other
      const zombie = bot.entities[5]
      const gone: unknown[] = []
      const left: unknown[] = []
      bot.on('entityGone', (entity: unknown) => gone.push(entity))
      bot.on('playerLeft', (player: unknown) => left.push(player))
      bot._client.emit('login', { entityId: 7 })
      assert.deepStrictEqual(gone, [zombie]) // not the bot's own entity
      assert.strictEqual(zombie.isValid, false)
      assert.deepStrictEqual(left, [other])
      assert.notStrictEqual(bot.entity, oldBotEntity)
      assert.deepStrictEqual(Object.keys(bot.entities), ['7'])
      assert.deepStrictEqual(bot.players, {})
    })
  })

  describe('entity attributes', () => {
    // the attribute id field is `key` except on 1.17 – 1.20.4, where it is `name`
    for (const [version, id] of [['1.8.8', 'generic.movementSpeed'], ['1.16.5', 'minecraft:generic.movement_speed'],
      ['1.17.1', 'minecraft:generic.movement_speed'], ['1.20.4', 'minecraft:generic.movement_speed'], ['1.21.4', 'generic.movement_speed']] as const) {
      it(`are stored under their id (${version})`, () => {
        const bot = createFakeBot(version)
        const packetName = bot.registry.version['<']('1.9') ? 'update_attributes' : 'entity_update_attributes'
        // round trip through the protocol, so the test sees the real field name
        const serializer = mc.createSerializer({ state: mc.states.PLAY, isServer: true, version, customPackets: {} })
        const deserializer = mc.createDeserializer({ state: mc.states.PLAY, isServer: false, version, customPackets: {} })
        const fields = bot.registry.version['>=']('1.17') && bot.registry.version['<']('1.20.5') ? { name: id } : { key: id }
        const buffer = serializer.createPacketBuffer({ name: packetName, params: { entityId: 1, properties: [{ ...fields, value: 0.1, modifiers: [] }] } })
        const { data } = deserializer.parsePacketBuffer(buffer)
        bot._client.emit(data.name, data.params)
        assert.deepStrictEqual(Object.keys(bot.entity.attributes), [id])
        assert.strictEqual(bot.entity.attributes[id]!.value, 0.1)
      })
    }
  })

  describe('air supply (oxygenLevel)', () => {
    for (const version of ['1.20.4', '1.21.11']) {
      it(`only the bot's own air_supply sets oxygenLevel (${version})`, () => {
        const bot = createFakeBot(version)
        bot.oxygenLevel = 20
        let breaths = 0
        bot.on('breath', () => { breaths++ })
        bot._client.emit('entity_head_rotation', { entityId: 5, headYaw: 0 }) // makes entity 5 known
        bot.entities[5].name = 'zombie'
        // air_supply is metadata key 1 on every entity
        bot._client.emit('entity_metadata', { entityId: 5, metadata: [{ key: 1, type: 'int', value: 0 }] })
        assert.strictEqual(bot.oxygenLevel, 20)
        assert.strictEqual(breaths, 0)
        bot._client.emit('entity_metadata', { entityId: 1, metadata: [{ key: 1, type: 'int', value: 150 }] })
        assert.strictEqual(bot.oxygenLevel, 10)
        assert.strictEqual(breaths, 1)
      })
    }
  })
})

describe('entities plugin 26.3', () => {
  const version = '26.3'
  // packets go through the real 26.3 serializer, so the shapes are what minecraft-protocol decodes
  const serializer = mc.createSerializer({ state: 'play', isServer: true, version })
  const deserializer = mc.createDeserializer({ state: 'play', isServer: false, version })
  const send = (bot: any, name: string, params: unknown) => {
    const { data } = deserializer.parsePacketBuffer(serializer.createPacketBuffer({ name, params }))
    bot._client.emit(data.name, data.params)
  }

  it('rel_entity_move applies a single vecDelta', () => {
    const bot = createFakeBot(version)
    const entity = bot.entities[1]
    entity.position = new Vec3(10, 64, 10)
    send(bot, 'rel_entity_move', { entityId: 1, delta: { onGround: true, dX: 4096, dY: -2048, dZ: 0 } })
    assert.deepStrictEqual(entity.position.toArray(), [11, 63.5, 10])
  })

  it('rel_entity_move applies batched vecDelta steps in order, each from the previous one', () => {
    const bot = createFakeBot(version)
    const entity = bot.entities[1]
    entity.position = new Vec3(10, 64, 10)
    send(bot, 'rel_entity_move', {
      entityId: 1,
      delta: { onGround: false, steps: [{ ticks: 1, dX: 4096, dY: 0, dZ: 0 }, { ticks: 1, dX: 4096, dY: 0, dZ: 2048 }] }
    })
    assert.deepStrictEqual(entity.position.toArray(), [12, 64, 10.5])
  })

  it('entity_move_look applies the vecDelta and the rotation', () => {
    const bot = createFakeBot(version)
    const entity = bot.entities[1]
    entity.position = new Vec3(0, 64, 0)
    send(bot, 'entity_move_look', { entityId: 1, delta: { onGround: true, dX: 0, dY: 0, dZ: 4096 }, yaw: 64, pitch: 0 })
    assert.deepStrictEqual(entity.position.toArray(), [0, 64, 1])
    assert.strictEqual(entity.yaw, conv.fromNotchianYawByte(64))
  })

  it('sync_entity_position moves to the end of the path and keeps the velocity', () => {
    const bot = createFakeBot(version)
    const entity = bot.entities[1]
    entity.velocity = new Vec3(0.1, 0, 0)
    send(bot, 'sync_entity_position', {
      entityId: 1,
      pathType: 'stepped',
      path: { steps: [{ x: 1, y: 64, z: 1, tickOffset: 0 }, { x: 2, y: 64, z: 3, tickOffset: 1 }] },
      yaw: 90,
      pitch: 0,
      onGround: true
    })
    assert.deepStrictEqual(entity.position.toArray(), [2, 64, 3])
    send(bot, 'sync_entity_position', { entityId: 1, pathType: 'linear', path: { x: 5, y: 65, z: 6 }, yaw: 90, pitch: 0, onGround: true })
    assert.deepStrictEqual(entity.position.toArray(), [5, 65, 6])
    assert.deepStrictEqual(entity.velocity.toArray(), [0.1, 0, 0])
  })

  it('swing_animation is a swing; animation 0 is a wake up, not a swing', () => {
    const bot = createFakeBot(version)
    const events: string[] = []
    bot.on('entitySwingArm', () => events.push('swing'))
    bot.on('entityWake', () => events.push('wake'))
    send(bot, 'swing_animation', { entityId: 1, hand: 'main_hand', animation: 'whack', duration: 6 })
    send(bot, 'animation', { entityId: 1, animation: 0 })
    assert.deepStrictEqual(events, ['swing', 'wake'])
  })

  it('swingArm punches with the main hand and sends nothing for the off hand', () => {
    const bot = createFakeBot(version)
    bot.swingArm('right')
    bot.swingArm('left')
    assert.deepStrictEqual(bot._client.writes.map((w: { name: string }) => w.name), ['punch'])
    const clientSerializer = mc.createSerializer({ state: 'play', isServer: false, version })
    for (const { name, params } of bot._client.writes) clientSerializer.createPacketBuffer({ name, params }) // a valid 26.3 packet
  })
})

describe('ray_trace plugin', () => {
  it('blockAtEntityCursor raycasts for an entity looking at pitch 0 / yaw 0', () => {
    const bot: any = new EventEmitter()
    const hit = { name: 'stone' }
    const casts: any[] = []
    bot.world = { raycast: (...args: any[]) => { casts.push(args); return hit } }
    rayTracePlugin(bot)
    const entity = { position: new Vec3(0, 64, 0), height: 1.8, pitch: 0, yaw: 0 }
    assert.strictEqual(bot.blockAtEntityCursor(entity, 5), hit)
    assert.strictEqual(casts.length, 1)
    assert.deepStrictEqual(casts[0][0], new Vec3(0, 65.8, 0))
    assert.deepStrictEqual(casts[0][1].toArray().map((v: number) => Math.round(v * 1e6) / 1e6 + 0), [0, 0, -1])
  })
})

describe('fishing plugin', () => {
  it('finds its bobber when the entities plugin is injected after it', async () => {
    // e.g. options.plugins: { entities: customEntities } loads the replacement after the internal plugins
    const registry = prismarineRegistry('1.20.4')
    const bot: any = new EventEmitter()
    bot.version = '1.20.4'
    bot.registry = registry
    bot.supportFeature = registry.supportFeature.bind(registry)
    bot.getControlState = () => false
    const client: any = new EventEmitter()
    client.username = 'bot'
    client.write = () => {}
    bot._client = client
    let activations = 0
    bot.activateItem = () => { activations++ }
    fishingPlugin(bot)
    entitiesPlugin(bot)
    client.emit('login', { entityId: 1 })

    const fishing = bot.fish()
    assert.strictEqual(activations, 1) // cast
    const type = registry.entitiesByName['fishing_bobber']!.id
    client.emit('spawn_entity', { entityId: 50, objectUUID: '00000000-0000-0000-0000-000000000050', type, x: 10, y: 62, z: 10, pitch: 0, yaw: 0, headPitch: 0, objectData: 1 })
    // a bite: 6 fishing particles next to the bobber
    client.emit('world_particles', { particleId: registry.particlesByName['fishing']!.id, particles: 6, x: 10.2, y: 62, z: 10.1 })
    await fishing
    assert.strictEqual(activations, 2) // reeled in
  })

  for (const version of ['1.8.8', '1.12.2', '1.20.4', '1.21.11']) {
    it(`ignores another player's bobber, whose objectData is its owner (${version})`, async () => {
      const bot = createFakeBot(version)
      const registry = bot.registry
      let activations = 0
      bot.activateItem = () => { activations++ }
      fishingPlugin(bot)
      const fishing = bot.fish()
      const type = registry.supportFeature('fishingBobberCorrectlyNamed') ? registry.entitiesByName['fishing_bobber']!.id : 90
      const k = registry.supportFeature('fixedPointPosition') ? 32 : 1 // 1.8: 1/32 block
      const spawn = (entityId: number, owner: number, x: number) => bot._client.emit('spawn_entity', {
        entityId, objectUUID: `00000000-0000-0000-0000-0000000000${entityId}`, type, x: x * k, y: 62 * k, z: 10 * k, pitch: 0, yaw: 0, headPitch: 0, objectData: owner, velocity: { x: 0, y: 0, z: 0 }
      })
      const bite = (x: number) => bot._client.emit('world_particles', registry.supportFeature('updatedParticlesPacket')
        ? { particle: { type: 'fishing' }, amount: 6, x, y: 62, z: 10 }
        : { particleId: (registry.particlesByName.fishing ?? registry.particlesByName.bubble).id, particles: 6, x, y: 62, z: 10 })
      spawn(60, 2, 30) // player 2's bobber, cast just before ours
      spawn(50, 1, 10) // ours (the bot is entity 1)
      bite(30) // a bite on player 2's bobber
      assert.strictEqual(activations, 1)
      bite(10)
      await fishing
      assert.strictEqual(activations, 2) // reeled in
    })
  }
})

describe('creative plugin (1.21.3+, no set_creative_slot ack)', () => {
  function createCreativeBot () {
    const registry = prismarineRegistry('1.21.4')
    const bot: any = new EventEmitter()
    bot.registry = registry
    bot.supportFeature = registry.supportFeature.bind(registry)
    bot._client = new EventEmitter()
    bot._client.write = () => {}
    bot.inventory = new EventEmitter()
    bot.inventory.slots = []
    bot._setSlot = (slot: number, item: unknown) => { bot.inventory.slots[slot] = item }
    creativePlugin(bot)
    const Item = prismarineItem(registry)
    return { bot, Item, registry }
  }

  it('rejects when the server corrects the slot to another item', async () => {
    const { bot, Item, registry } = createCreativeBot()
    const stone = new Item(registry.itemsByName['stone']!.id, 1)
    const dirt = new Item(registry.itemsByName['dirt']!.id, 1)
    const set = bot.creative.setInventorySlot(36, stone, 300)
    bot.inventory.emit('updateSlot:36', stone, dirt)
    await assert.rejects(set, { message: 'Server rejected' })
  })

  it('clearSlot rejects when the server puts an item back', async () => {
    const { bot, Item, registry } = createCreativeBot()
    const stone = new Item(registry.itemsByName['stone']!.id, 1)
    bot.inventory.slots[36] = stone
    const clear = bot.creative.clearSlot(36)
    assert.doesNotThrow(() => bot.inventory.emit('updateSlot:36', null, stone))
    await assert.rejects(clear, { message: 'Server rejected' })
  })

  it('stopFlying without startFlying keeps gravity', () => {
    const { bot } = createCreativeBot()
    bot.physics = { gravity: 0.08 }
    bot.creative.stopFlying()
    assert.strictEqual(bot.physics.gravity, 0.08)
    bot.creative.startFlying()
    assert.strictEqual(bot.physics.gravity, 0)
    bot.creative.stopFlying()
    assert.strictEqual(bot.physics.gravity, 0.08)
  })

  it('resolves when the server keeps the item', async () => {
    const { bot, Item, registry } = createCreativeBot()
    const stone = new Item(registry.itemsByName['stone']!.id, 1)
    const set = bot.creative.setInventorySlot(36, stone, 50)
    bot.inventory.emit('updateSlot:36', null, new Item(registry.itemsByName['stone']!.id, 1))
    await set
  })
})

describe('place_entity plugin', () => {
  it('placeEntity ignores unrelated entities spawning first', async () => {
    const registry = prismarineRegistry('1.20.4')
    const bot: any = new EventEmitter()
    bot.registry = registry
    bot.supportFeature = registry.supportFeature.bind(registry)
    bot._client = new EventEmitter()
    bot.heldItem = { name: 'armor_stand' }
    bot._genericPlace = async (referenceBlock: any) => {
      setImmediate(() => {
        bot.emit('entitySpawn', { name: 'zombie', position: new Vec3(0.5, 65, 0.5) })
        bot.emit('entitySpawn', { name: 'armor_stand', position: new Vec3(0.5, 65, 0.5) })
      })
      return referenceBlock.position
    }
    placeEntityPlugin(bot)
    const entity = await bot.placeEntity({ position: new Vec3(0, 64, 0) }, new Vec3(0, 1, 0))
    assert.strictEqual(entity.name, 'armor_stand')
  })

  // [version, held item, the entity vanilla spawns]
  for (const [version, item, entityName] of [['1.12.2', 'boat', 'boat'], ['1.20.4', 'oak_boat', 'boat'], ['1.20.4', 'oak_chest_boat', 'chest_boat'], ['1.21.4', 'oak_boat', 'oak_boat'], ['1.21.11', 'spruce_chest_boat', 'spruce_chest_boat']] as const) {
    it(`placeEntity with ${item} finds the ${entityName} entity (${version})`, async () => {
      const registry = prismarineRegistry(version)
      const bot: any = new EventEmitter()
      bot.registry = registry
      bot.supportFeature = registry.supportFeature.bind(registry)
      bot._client = new EventEmitter()
      bot._client.write = () => {}
      bot._nextSequence = () => 0
      bot.entity = { yaw: 0, pitch: 0 }
      bot.heldItem = { name: item, type: registry.itemsByName[item]!.id, count: 1 }
      bot._genericPlace = async (referenceBlock: any) => {
        setImmediate(() => bot.emit('entitySpawn', { name: entityName, position: new Vec3(0.5, 64, 0.5) }))
        return referenceBlock.position
      }
      placeEntityPlugin(bot)
      const entity = await bot.placeEntity({ position: new Vec3(0, 64, 0) }, new Vec3(0, 1, 0))
      assert.strictEqual(entity.name, entityName)
    })
  }
})

describe('bed plugin', () => {
  it('sleep on a foot half whose neighbours are not loaded reports a half bed', async () => {
    const registry = prismarineRegistry('1.20.4')
    const bot: any = new EventEmitter()
    bot.registry = registry
    bot.supportFeature = registry.supportFeature.bind(registry)
    bot._client = new EventEmitter()
    bot.isRaining = false
    bot.thunderState = 0
    bot.time = { timeOfDay: 13000 }
    bot.entity = { position: new Vec3(0, 64, 0) }
    bot.blockAt = () => null // neighbouring chunk not loaded
    bedPlugin(bot)
    const redBed = registry.blocksByName['red_bed']!
    // state offset 3: facing north, not occupied, foot
    const bedBlock = { name: 'red_bed', stateId: redBed.minStateId! + 3, position: new Vec3(0, 64, 1) }
    await assert.rejects(bot.sleep(bedBlock), { message: "there's only half bed" })
  })

  it('a sleep that times out removes its sleep listener', async () => {
    const registry = prismarineRegistry('1.20.4')
    const bot: any = new EventEmitter()
    bot.registry = registry
    bot.supportFeature = registry.supportFeature.bind(registry)
    bot._client = new EventEmitter()
    bot.isRaining = false
    bot.thunderState = 0
    bot.time = { timeOfDay: 13000 }
    bot.game = { gameMode: 'survival' }
    bot.entity = { position: new Vec3(0, 64, 0) }
    bot.entities = {}
    bot.canDigBlock = () => true
    bot.activateBlock = async () => {} // the server never puts the bot to sleep
    bedPlugin(bot)
    const redBed = registry.blocksByName['red_bed']!
    // state offset 2: facing north, not occupied, head
    const bedBlock = { name: 'red_bed', stateId: redBed.minStateId! + 2, position: new Vec3(0, 64, 1) }
    const realSetTimeout = global.setTimeout
    let fireTimeout: (() => void) | undefined
    global.setTimeout = ((callback: () => void) => { fireTimeout = callback; return 1 }) as any
    let sleeping: Promise<void>
    try {
      sleeping = bot.sleep(bedBlock)
    } finally {
      global.setTimeout = realSetTimeout
    }
    assert.strictEqual(bot.listenerCount('sleep'), 1)
    fireTimeout!()
    await assert.rejects(sleeping, { message: 'bot is not sleeping' })
    assert.strictEqual(bot.listenerCount('sleep'), 0)
  })

  // a bed facing north: head at (0, 64, 1), foot at (0, 64, 2)
  function sleepBot (version: string, position: Vec3, entities: object = {}) {
    const registry = prismarineRegistry(version)
    const bot: any = new EventEmitter()
    bot.registry = registry
    bot.supportFeature = registry.supportFeature.bind(registry)
    bot._client = new EventEmitter()
    bot.isRaining = false
    bot.thunderState = 0
    bot.time = { timeOfDay: 13000 }
    bot.game = { gameMode: 'survival' }
    bot.entity = { position }
    bot.entities = entities
    bot.canDigBlock = () => true
    bot.activateBlock = async () => { bot.emit('sleep') } // the server puts the bot to sleep
    bedPlugin(bot)
    const head = registry.supportFeature('blockStateId')
      ? { name: 'red_bed', stateId: registry.blocksByName['red_bed']!.minStateId! + 2, position: new Vec3(0, 64, 1) } // facing north, not occupied, head
      : { name: 'bed', metadata: 8 | 2, position: new Vec3(0, 64, 1) } // head, facing north
    return bot.sleep(head)
  }

  // vanilla (Player / ServerPlayer.startSleepInBed): within 3 blocks horizontally and 2 vertically of the head block -
  // since 1.11 or of the foot block - measured from the block's corner before 1.15 and from its bottom centre since
  for (const [version, reach] of [
    ['1.8.8', { corner: true, foot: false }], ['1.12.2', { corner: true, foot: true }], ['1.14.4', { corner: true, foot: true }],
    ['1.15.2', { corner: false, foot: true }], ['1.20.4', { corner: false, foot: true }], ['26.1', { corner: false, foot: true }]
  ] as const) {
    it(`sleep is in reach where vanilla lets the player sleep (${version})`, async () => {
      const cases: Array<[Vec3, boolean]> = [
        [new Vec3(3.4, 64, 1), !reach.corner], // 3.4 from the corner, 2.9 from the centre
        [new Vec3(-2.8, 64, 1), reach.corner], // 2.8 from the corner, 3.3 from the centre
        [new Vec3(0, 66, 1), true], // 2 above
        [new Vec3(0, 66.5, 1), false],
        [new Vec3(0, 64, -1.9), reach.corner], // 2.9 north of the head's corner, 3.4 of its centre
        [new Vec3(0.5, 64, 4.8), reach.foot], // 2.8 south of the foot's corner, 2.3 of its centre, 3.8 / 3.3 of the head's
        [new Vec3(0.5, 64, 5.5), reach.foot && !reach.corner] // 3.5 south of the foot's corner, 3 of its centre
      ]
      for (const [position, inReach] of cases) {
        if (inReach) await sleepBot(version, position)
        else await assert.rejects(sleepBot(version, position), { message: 'the bed is too far' }, `${position}`)
      }
    })
  }

  it('monsters keep the bot awake where vanilla finds them (1.15+: box around the bed\'s bottom centre)', async () => {
    const zombie = (x: number) => ({ 1: { type: 'hostile', position: new Vec3(x, 64, 1), width: 0.6, height: 1.95 } })
    // the bed's box spans x -7.5 .. 8.5: a zombie whose box reaches into it
    await assert.rejects(sleepBot('1.20.4', new Vec3(0.5, 64, 1.5), zombie(8.7)), { message: 'there are monsters nearby' })
    await assert.rejects(sleepBot('1.20.4', new Vec3(0.5, 64, 1.5), zombie(-7.7)), { message: 'there are monsters nearby' })
    // and one just outside of it
    await sleepBot('1.20.4', new Vec3(0.5, 64, 1.5), zombie(-7.9))
    await sleepBot('1.20.4', new Vec3(0.5, 64, 1.5), zombie(8.9))
    // before 1.15 the box is around the head block's corner: x -8 .. 8
    await sleepBot('1.12.2', new Vec3(0.5, 64, 1.5), zombie(8.4))
    await assert.rejects(sleepBot('1.12.2', new Vec3(0.5, 64, 1.5), zombie(-8.2)), { message: 'there are monsters nearby' })
  })
})
