// The lightning bolt's position from spawn_entity_weather (1.8 - 1.15) on a fake bot.
import EventEmitter from 'events'
import assert from 'assert'
import prismarineRegistry from 'prismarine-registry'
import { Vec3 } from 'vec3'
import entitiesPlugin from '../lib/plugins/entities.ts'
import type { BotInternal } from '../lib/types/internal.ts'

function createFakeBot (version: string): BotInternal {
  const registry = prismarineRegistry(version)
  const bot = new EventEmitter() as unknown as BotInternal
  bot.version = version
  bot.registry = registry as BotInternal['registry']
  bot.supportFeature = registry.supportFeature.bind(registry) as BotInternal['supportFeature']
  bot.getControlState = () => false
  const client = Object.assign(new EventEmitter(), { username: 'bot', write: () => {} })
  bot._client = client as unknown as BotInternal['_client']
  entitiesPlugin(bot)
  client.emit('login', { entityId: 1 })
  return bot
}

describe('spawn_entity_weather', () => {
  // 1.8 sends fixed point (x32) coordinates, 1.9 - 1.15 doubles
  for (const [version, scale] of [['1.8.8', 32], ['1.9.4', 1], ['1.12.2', 1], ['1.15.2', 1]] as const) {
    it(`places the bolt where it struck (${version})`, () => {
      const bot = createFakeBot(version)
      const spawned: Array<{ position: Vec3, type: string, globalType?: string }> = []
      bot.on('entitySpawn', (entity) => { spawned.push(entity as never) })
      bot._client.emit('spawn_entity_weather', { entityId: 5, type: 1, x: 3.5 * scale, y: 4 * scale, z: -7.5 * scale })
      assert.strictEqual(spawned.length, 1)
      assert.strictEqual(spawned[0]!.type, 'global')
      assert.strictEqual(spawned[0]!.globalType, 'thunderbolt')
      assert.ok(spawned[0]!.position.equals(new Vec3(3.5, 4, -7.5)), `at ${spawned[0]!.position}`)
    })
  }
})
