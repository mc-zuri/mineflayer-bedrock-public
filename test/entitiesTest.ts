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
