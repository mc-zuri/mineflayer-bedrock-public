import EventEmitter from 'events'
import assert from 'assert'
import prismarineRegistry from 'prismarine-registry'
import prismarineBlock from 'prismarine-block'
import inject from '../lib/plugins/digging.ts'
import { testedVersions } from '../lib/version.ts'
import type { BotInternal } from '../lib/types/internal.ts'

describe('digTime of unbreakable blocks', () => {
  for (const version of testedVersions) {
    function createMockBot (gameMode: string): BotInternal {
      const bot = new EventEmitter() as unknown as BotInternal
      bot.registry = prismarineRegistry(version) as BotInternal['registry']
      bot._client = { write: () => {} } as unknown as BotInternal['_client']
      bot.entity = {
        position: { offset: () => null },
        onGround: true,
        eyeHeight: 1.62,
        effects: {}
      } as unknown as BotInternal['entity']
      bot.blockAt = () => null // no water at eye level
      bot.heldItem = null
      bot.game = { gameMode } as BotInternal['game']
      bot.inventory = { slots: [] } as unknown as BotInternal['inventory']
      bot.getEquipmentDestSlot = () => 5
      inject(bot)
      return bot
    }

    function block (bot: BotInternal, name: string) {
      const Block = prismarineBlock(bot.registry)
      return Block.fromStateId(bot.registry.blocksByName[name]!.defaultState!, 0)
    }

    // minecraft-data has bedrock's hardness null (1.8 - 1.15, 1.18) or 0 (1.16, 1.17), which
    // prismarine-block turns into an instant break: dig() then "broke" bedrock client side only
    it(`${version}: bedrock and barrier take forever in survival, none in creative`, () => {
      const survival = createMockBot('survival')
      assert.strictEqual(survival.digTime(block(survival, 'bedrock')), Infinity)
      assert.strictEqual(survival.digTime(block(survival, 'barrier')), Infinity)
      assert.strictEqual(survival.digTime(block(survival, 'dirt')), 750)
      // instant breaks stay instant
      assert.strictEqual(survival.digTime(block(survival, 'air')), 0)
      const creative = createMockBot('creative')
      assert.strictEqual(creative.digTime(block(creative, 'bedrock')), 0)
    })
  }
})
