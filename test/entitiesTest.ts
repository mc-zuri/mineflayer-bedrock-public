// Regression tests for the entities plugin on a fake bot: packets are emitted straight on a
// fake client, no server involved.
import EventEmitter from 'events'
import assert from 'assert'
import prismarineRegistry from 'prismarine-registry'
import { Vec3 } from 'vec3'
import * as conv from '../lib/conversions.ts'
import entitiesPlugin from '../lib/plugins/entities.ts'
import rayTracePlugin from '../lib/plugins/ray_trace.ts'
import bedPlugin from '../lib/plugins/bed.ts'
import creativePlugin from '../lib/plugins/creative.ts'
import placeEntityPlugin from '../lib/plugins/place_entity.ts'
import prismarineItem from 'prismarine-item'

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

  describe('set_passengers (1.9+ riding)', () => {
    for (const version of ['1.12.2', '1.20.4', '1.21.11']) {
      it(`a passenger missing from the new list has dismounted (${version})`, () => {
        const bot = createFakeBot(version)
        const events: string[] = []
        bot.on('mount', () => events.push('mount'))
        bot.on('dismount', (vehicle: any) => events.push(`dismount ${vehicle?.id}`))
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
        assert.deepStrictEqual(events, ['mount', 'dismount 7'])
      })
    }
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
    const stone = new Item(registry.itemsByName.stone.id, 1)
    const dirt = new Item(registry.itemsByName.dirt.id, 1)
    const set = bot.creative.setInventorySlot(36, stone, 300)
    bot.inventory.emit('updateSlot:36', stone, dirt)
    await assert.rejects(set, { message: 'Server rejected' })
  })

  it('clearSlot rejects when the server puts an item back', async () => {
    const { bot, Item, registry } = createCreativeBot()
    const stone = new Item(registry.itemsByName.stone.id, 1)
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
    const stone = new Item(registry.itemsByName.stone.id, 1)
    const set = bot.creative.setInventorySlot(36, stone, 50)
    bot.inventory.emit('updateSlot:36', null, new Item(registry.itemsByName.stone.id, 1))
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
    bot._genericPlace = async (referenceBlock: any, faceVector: any) => {
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
    const redBed = registry.blocksByName.red_bed
    // state offset 3: facing north, not occupied, foot
    const bedBlock = { name: 'red_bed', stateId: redBed.minStateId! + 3, position: new Vec3(0, 64, 1) }
    await assert.rejects(bot.sleep(bedBlock), { message: "there's only half bed" })
  })
})
