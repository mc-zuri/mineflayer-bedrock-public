// The blocks plugin with the storageBuilder option, on a fake bot: what happens to the world's saving when
// the bot ends.
import EventEmitter from 'events'
import assert from 'assert'
import prismarineRegistry from 'prismarine-registry'
import blocksPlugin from '../lib/plugins/blocks.ts'
import type { BotInternal } from '../lib/types/internal.ts'
import type { BotOptions } from '../lib/types/mineflayer.ts'

describe('blocks plugin storageBuilder', () => {
  it('stops saving the world once the bot ended, after a last save', async () => {
    const registry = prismarineRegistry('1.8.8')
    const bot = new EventEmitter() as unknown as BotInternal
    bot.version = '1.8.8'
    bot.registry = registry as BotInternal['registry']
    bot.supportFeature = registry.supportFeature.bind(registry) as BotInternal['supportFeature']
    bot._client = Object.assign(new EventEmitter(), { write: () => {} }) as unknown as BotInternal['_client']
    const saved: string[] = []
    const provider = {
      load: async () => null,
      save: async (x: number, z: number) => { saved.push(`${x},${z}`) }
    }
    blocksPlugin(bot, { storageBuilder: () => provider, hideErrors: true } as unknown as BotOptions)
    ;(bot._client as unknown as EventEmitter).emit('login', { dimension: 0 })
    await new Promise(resolve => setImmediate(resolve))
    const world = bot.world.async as unknown as { savingInt: NodeJS.Timeout, queueSaving: (x: number, z: number) => void }
    world.queueSaving(3, 4) // a column changed since the last save

    bot.emit('end', 'test')
    await new Promise(resolve => setImmediate(resolve))
    // a pending interval keeps the process running after the bot is gone
    assert.ok((world.savingInt as unknown as { _destroyed: boolean })._destroyed, 'the saving interval still runs')
    assert.deepStrictEqual(saved, ['3,4'])
  })
})
