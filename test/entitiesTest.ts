// Regression tests for the entities plugin on a fake bot: packets are emitted straight on a
// fake client, no server involved.
import EventEmitter from 'events'
import assert from 'assert'
import prismarineRegistry from 'prismarine-registry'
import { Vec3 } from 'vec3'
import entitiesPlugin from '../lib/plugins/entities.ts'
import rayTracePlugin from '../lib/plugins/ray_trace.ts'

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
