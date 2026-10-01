// Line-of-sight helpers (ray_trace.ts, blocks.ts canSeeBlock) on a fake bot with a real world
import EventEmitter from 'events'
import assert from 'assert'
import prismarineRegistry from 'prismarine-registry'
import prismarineChunk from 'prismarine-chunk'
import { Vec3 } from 'vec3'
import injectBlocks from '../lib/plugins/blocks.ts'
import injectRayTrace from '../lib/plugins/ray_trace.ts'
import type { BotInternal } from '../lib/types/internal.ts'

describe('line of sight', () => {
  for (const version of ['1.8.8', '1.12.2', '1.20.4', '26.1']) {
    // a bot standing at (4.5, 64, 4.5) in a world of air with the given stone blocks
    function createBot (stones: Vec3[]): BotInternal {
      const bot = new EventEmitter() as unknown as BotInternal
      const registry = prismarineRegistry(version) as BotInternal['registry']
      bot.registry = registry
      bot.supportFeature = registry.supportFeature
      bot._client = new EventEmitter() as unknown as BotInternal['_client']
      const tall = registry.supportFeature('tallWorld')
      bot.game = { minY: tall ? -64 : 0, height: tall ? 384 : 256 } as BotInternal['game']
      injectBlocks(bot, {} as Parameters<typeof injectBlocks>[1])
      injectRayTrace(bot)
      // the login creates the world (each version reads its own field)
      bot._client.emit('login', { dimension: 0, worldName: 'minecraft:overworld', worldState: { dimension: 0, name: 'minecraft:overworld' } } as never)
      const Chunk = (prismarineChunk as unknown as (registry: unknown) => new (options: unknown) => { setBlockStateId: (pos: Vec3, id: number) => void })(registry)
      const chunk = new Chunk(tall ? { minY: -64, worldHeight: 384 } : {})
      const stone = registry.blocksByName['stone']!
      for (const pos of stones) chunk.setBlockStateId(pos, stone.defaultState ?? stone.minStateId ?? (stone.id << 4))
      bot.world.setColumn(0, 0, chunk as never)
      bot.entity = {
        position: new Vec3(4.5, 64, 4.5),
        height: 1.8,
        eyeHeight: 1.62,
        yaw: 0,
        pitch: 0
      } as BotInternal['entity']
      return bot
    }

    // The ray started at the top of the head (1.8) instead of the eyes (1.62), so a block
    // the bot looks at near the top edge of a face was missed.
    it(`${version}: blockAtCursor casts from the eyes`, () => {
      const bot = createBot([new Vec3(4, 65, 2)])
      // looking north (yaw 0) at the stone's south face (z = 3), 1.5 blocks away, 0.05 below its top edge
      bot.entity.pitch = Math.atan2(65.95 - 65.62, 1.5)
      assert.strictEqual(bot.blockAtCursor()?.position.toString(), new Vec3(4, 65, 2).toString())
      assert.strictEqual(bot.blockAtEntityCursor(bot.entity)?.position.toString(), new Vec3(4, 65, 2).toString())
    })

    // The ray only went as far as the block's minimum corner, which can be nearer than
    // the face the ray enters through.
    it(`${version}: canSeeBlock sees a block whose minimum corner is nearer than its face`, () => {
      const floating = new Vec3(7, 66, 5)
      const bot = createBot([floating])
      assert.strictEqual(bot.canSeeBlock(bot.blockAt(floating)!), true)
      // and still not through another block
      const hidden = createBot([floating, new Vec3(6, 66, 5), new Vec3(6, 65, 5)])
      assert(!hidden.canSeeBlock(hidden.blockAt(floating)!))
    })
  }
})
