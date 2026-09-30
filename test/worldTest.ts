import EventEmitter from 'events'
import assert from 'assert'
import prismarineRegistry from 'prismarine-registry'
import prismarineItem from 'prismarine-item'
import injectBlocks from '../lib/plugins/blocks.ts'
import anvilPlugin from '../lib/plugins/anvil.ts'
import type { BotInternal } from '../lib/types/internal.ts'

describe('blocks plugin', () => {
  // just what blocks.ts touches: registry, _client and the game height
  function createFakeBot (version: string): BotInternal {
    const bot = new EventEmitter() as unknown as BotInternal
    const registry = prismarineRegistry(version) as BotInternal['registry']
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

describe('anvil plugin', () => {
  // an anvil window whose transfers and putAway succeed at once; the server
  // part (xp change) is up to the test
  async function openFakeAnvil (gameMode: string, level: number): Promise<{ bot: any, anvil: any }> {
    const bot: any = new EventEmitter()
    bot.registry = prismarineRegistry('1.20.4')
    bot.supportFeature = bot.registry.supportFeature
    bot._client = { write: () => {}, writeChannel: () => {}, registerChannel: () => {} }
    bot.game = { gameMode }
    bot.experience = { level, points: 0, progress: 0 }
    const window: any = new EventEmitter()
    window.type = 'minecraft:anvil'
    window.inventoryStart = 3
    window.inventoryEnd = 39
    window.close = () => {}
    bot.openBlock = async () => window
    bot.transfer = async () => {}
    bot.putAway = async () => {}
    anvilPlugin(bot)
    const anvil = await bot.openAnvil({})
    return { bot, anvil }
  }

  it('combine checks the xp cost of the order it uses', async () => {
    const { bot, anvil } = await openFakeAnvil('survival', 0)
    const Item = prismarineItem(bot.registry)
    const sword = new Item(bot.registry.itemsByName.diamond_sword.id, 1)
    sword.durabilityUsed = 1000
    const diamond = new Item(bot.registry.itemsByName.diamond.id, 1)
    // sword + diamond costs 1 level, diamond + sword is not possible (cost 0)
    assert.strictEqual(Item.anvil(sword, diamond, false, undefined).xpCost, 1)
    assert.strictEqual(Item.anvil(diamond, sword, false, undefined).xpCost, 0)
    await assert.rejects(anvil.combine(sword, diamond), /not have enough xp/)
    await assert.rejects(anvil.combine(diamond, sword), /not have enough xp/)
  })
})
