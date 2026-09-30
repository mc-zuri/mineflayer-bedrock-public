// Regression tests for the entities plugin on a fake bot: packets are emitted straight on a
// fake client, no server involved.
import EventEmitter from 'events'
import assert from 'assert'
import prismarineRegistry from 'prismarine-registry'
import entitiesPlugin from '../lib/plugins/entities.ts'

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
})
