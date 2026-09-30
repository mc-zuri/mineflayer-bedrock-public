import EventEmitter from 'events'
import assert from 'assert'
import prismarineRegistry from 'prismarine-registry'
import injectBlocks from '../lib/plugins/blocks.ts'
import type { BotInternal } from '../lib/types/internal.ts'

describe('blocks plugin', () => {
  // just what blocks.ts touches: registry, _client and the game height
  function createFakeBot (version: string): BotInternal {
    const bot = new EventEmitter() as unknown as BotInternal
    const registry = prismarineRegistry(version)
    bot.registry = registry
    bot.supportFeature = registry.supportFeature
    bot._client = new EventEmitter() as unknown as BotInternal['_client']
    bot.game = { minY: -64, height: 384 } as BotInternal['game']
    injectBlocks(bot, {} as Parameters<typeof injectBlocks>[1])
    return bot
  }

  it('a world switch notifies and removes every blockUpdate:(x, y, z) listener, also several on one position', () => {
    const bot = createFakeBot('1.20.4')
    bot._client.emit('login', { worldName: 'minecraft:overworld' } as never)

    const event = 'blockUpdate:(1, 2, 3)'
    const calls: unknown[][] = []
    bot.on(event, (oldBlock, newBlock) => { calls.push(['a', oldBlock, newBlock]) })
    bot.on(event, (oldBlock, newBlock) => { calls.push(['b', oldBlock, newBlock]) })
    bot.on('blockUpdate:(4, 5, 6)', (oldBlock, newBlock) => { calls.push(['c', oldBlock, newBlock]) })

    // a login into another world switches the world synchronously when there is no storage
    bot._client.emit('login', { worldName: 'minecraft:the_nether' } as never)

    assert.deepStrictEqual(calls, [['a', null, null], ['b', null, null], ['c', null, null]])
    assert.strictEqual(bot.listenerCount(event), 0)
    assert.strictEqual(bot.world.listenerCount(event), 0)
    assert.strictEqual(bot.listenerCount('blockUpdate:(4, 5, 6)'), 0)
  })
})
