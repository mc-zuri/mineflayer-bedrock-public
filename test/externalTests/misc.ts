import assert from 'assert'
import { Vec3 } from 'vec3'
import mineflayer from 'mineflayer'
import prismarineItem from 'prismarine-item'
import { once, onceWithCleanup } from '../../lib/promise_utils.ts'
import type { Entity } from 'prismarine-entity'
import type { Bot, Plugin } from '../../lib/types/mineflayer.ts'
import type { TestBot, TestFunction } from './plugins/testCommon.ts'
import type { world } from 'prismarine-world'
import type EventEmitter from 'events'

// Smaller APIs: villager trade checks, team leave, boss bar names, Location, settings, plugin loading, chat
// patterns, paintings, lightning, pistons and the storageBuilder option.
export default (): Record<string, TestFunction> => {
  const itemOf = (bot: TestBot, name: string, count = 1) => {
    const Item = prismarineItem(bot.registry)
    return new Item(bot.registry.itemsByName[name]!.id, count, 0)
  }

  return {
    async villagerNotEnoughItems (bot) {
      const villagerType = bot.registry.entitiesByName['villager'] ? 'villager' : 'Villager'
      const countKey = bot.registry.version['>=']('1.20.5') ? 'count' : 'Count'
      const buy = (count: number) => `{id:"minecraft:emerald",${countKey}:${count}}`
      const buyB = `{id:"minecraft:book",${countKey}:1}`
      const sell = `{id:"minecraft:glass",${countKey}:1}`
      const recipes = [`{maxUses:9,buy:${buy(5)},sell:${sell}}`, `{maxUses:9,buy:${buy(1)},buyB:${buyB},sell:${sell}}`]
      const list = bot.supportFeature('indexesVillagerRecipes') ? recipes.map((recipe, i) => `${i}:${recipe}`) : recipes
      const summon = `/summon ${villagerType} ~ ~1 ~ {NoAI:1,Offers:{Recipes:[${list.join(',')}]}}`

      // 2 emeralds: neither enough for the first trade's 5 nor, without a book, for the second's book
      await bot.test.setInventorySlot(36, itemOf(bot, 'emerald', 2))
      // through a command block: the summon is longer than a chat message may be on old versions
      const commandBlockPos = bot.entity.position.offset(0.5, 0, 0.5)
      await bot.test.setBlock({ ...commandBlockPos, blockName: 'command_block' })
      const commandSet = once(bot.world, `blockUpdate:${commandBlockPos}`)
      bot.setCommandBlock(commandBlockPos, summon)
      await commandSet
      const spawned = onceWithCleanup(bot, 'entitySpawn', { timeout: 5000, checkCondition: (e: Entity) => e.name === villagerType })
      bot.chat(`/setblock ${commandBlockPos.offset(1, 0, 0).toArray().join(' ')} redstone_block`)
      const [entity] = await spawned

      const villager = await bot.openVillager(entity)
      try {
        assert.strictEqual(villager.trades.length, 2)
        await assert.rejects(villager.trade(0, 1), /Not enough item 1 to trade/)
        await assert.rejects(bot.trade(villager, '1', 1), /Not enough item 2 to trade/)
      } finally {
        await villager.close()
      }
      await bot.test.killEntity(entity)
    },

    async teamLeave (bot) {
      const name = 'leaving'
      const added = onceWithCleanup(bot, 'teamMemberAdded', { timeout: 5000, checkCondition: (team) => team.team === name })
      if (bot.supportFeature('teamUsesChatComponents')) {
        bot.chat(`/team add ${name}`)
        bot.chat(`/team join ${name} ${bot.username}`)
      } else {
        bot.chat(`/scoreboard teams add ${name}`)
        bot.chat(`/scoreboard teams join ${name}`)
      }
      const [team] = await added
      assert.strictEqual(bot.teamMap[bot.username], team)
      assert.ok(team.displayName(bot.username).toString().includes(bot.username))

      const removed = onceWithCleanup(bot, 'teamMemberRemoved', { timeout: 5000, checkCondition: (t) => t.team === name })
      bot.chat(bot.supportFeature('teamUsesChatComponents') ? `/team leave ${bot.username}` : '/scoreboard teams leave')
      await removed
      assert.strictEqual(bot.teamMap[bot.username], undefined)
      assert.ok(!team.members.includes(bot.username))

      const gone = onceWithCleanup(bot, 'teamRemoved', { timeout: 5000, checkCondition: (t) => t.team === name })
      bot.chat(bot.supportFeature('teamUsesChatComponents') ? `/team remove ${name}` : `/scoreboard teams remove ${name}`)
      await gone
      assert.strictEqual(bot.teams[name], undefined)
    },

    async bossBarName (bot) {
      if (bot.registry.isOlderThan('1.13')) return // no /bossbar
      const id = 'test:renamed'
      const created = onceWithCleanup(bot, 'bossBarCreated', { timeout: 5000 })
      bot.chat(`/bossbar add ${id} "Before"`)
      bot.chat(`/bossbar set ${id} players ${bot.username}`)
      const [bar] = await created
      assert.strictEqual(bar.title.toString(), 'Before')
      assert.strictEqual(typeof bar.entityUUID, 'string')
      assert.strictEqual(bar.shouldDarkenSky, false)
      assert.strictEqual(bar.isDragonBar, false)
      assert.strictEqual(bar.createFog, false)

      const renamed = onceWithCleanup(bot, 'bossBarUpdated', { timeout: 5000, checkCondition: (b) => b.title.toString() === 'After' })
      bot.chat(`/bossbar set ${id} name "After"`)
      await renamed
      const deleted = onceWithCleanup(bot, 'bossBarDeleted', { timeout: 5000 })
      bot.chat(`/bossbar remove ${id}`)
      await deleted
    },

    async location (bot) {
      // Location splits a position into its chunk and the block inside it, below 0 too
      const at = new mineflayer.Location(new Vec3(-17.5, bot.test.groundY - 0.5, 33.2))
      const y = bot.test.groundY - 1
      assert.ok(at.floored.equals(new Vec3(-18, y, 33)))
      assert.ok(at.blockPoint.equals(new Vec3(14, ((y % 16) + 16) % 16, 1)))
      assert.ok(at.chunkCorner.equals(new Vec3(-32, y - at.blockPoint.y, 32)))
      assert.strictEqual(at.blockIndex, 14 + 16 * 1 + 256 * at.blockPoint.y)
      assert.strictEqual(at.biomeBlockIndex, 14 + 16 * 1)
      assert.strictEqual(at.chunkYIndex, Math.floor((bot.test.groundY - 0.5) / 16))
    },

    async viewDistanceNumber (bot) {
      const sent: unknown[] = []
      const onWrite = (name: string, params: { viewDistance?: number }) => { if (name === 'settings') sent.push(params.viewDistance) }
      const write = bot._client.write
      bot._client.write = function (this: typeof bot._client, ...args: Parameters<typeof write>) {
        onWrite(args[0], args[1] as { viewDistance?: number })
        return write.apply(this, args)
      } as typeof write
      try {
        bot.setSettings({ viewDistance: 5 })
        assert.strictEqual(bot.settings.viewDistance, 5)
        assert.throws(() => bot.setSettings({ viewDistance: 0 }), /invalid view distance/)
        bot.setSettings({ viewDistance: 'tiny' })
      } finally {
        bot._client.write = write
      }
      assert.deepStrictEqual(sent, [5, 6])
      assert.strictEqual(bot.settings.viewDistance, 'tiny')
    },

    async loadPluginAfterSpawn (bot) {
      let calls = 0
      const plugin: Plugin = (b: Bot) => { calls++; assert.strictEqual(b, bot) }
      const other: Plugin = () => { calls += 10 }
      assert.ok(!bot.hasPlugin(plugin))
      bot.loadPlugin(plugin) // injected right away once the bot is running
      assert.strictEqual(calls, 1)
      bot.loadPlugin(plugin) // the second time is a no-op
      bot.loadPlugins([plugin, other])
      assert.strictEqual(calls, 11)
      assert.ok(bot.hasPlugin(plugin) && bot.hasPlugin(other))
      assert.throws(() => bot.loadPlugins([plugin, 'nope' as unknown as Plugin]), /plugins need to be an array of functions/)
    },

    async chatPatterns (bot) {
      const id = bot.chatAddPattern(/e2e-pattern (\w+) (\d+)/, 'e2ePattern')
      try {
        // deprecated patterns emit an event of their own name with the capture groups
        const matched = new Promise<unknown[]>(resolve => (bot as unknown as EventEmitter).once('e2ePattern', (...args: unknown[]) => resolve(args)))
        bot.chat('e2e-pattern apples 42')
        const [word, number] = await matched
        assert.strictEqual(word, 'apples')
        assert.strictEqual(number, '42')
      } finally {
        bot.removeChatPattern(id)
      }
      // a number is sent as its text, anything else is refused
      const echoed = bot.awaitMessage(/ 31337$/, 'unused', 5000)
      bot.chat(31337 as unknown as string)
      await echoed
      assert.throws(() => bot.chat({} as unknown as string), /must be a string or number/)
      await assert.rejects(bot.awaitMessage(['never said'], /nor this/, 300), /Timeout waiting for message after 300ms/)
    },

    async painting (bot) {
      // 1.19+ sends paintings as plain spawn_entity, which block.painting does not track
      if (!bot.registry.version['<']('1.19')) return
      const ground = bot.test.groundY
      const wall = new Vec3(2, ground + 1, -1)
      const spot = wall.offset(0, 0, 1)
      await bot.test.setBlock({ ...wall, blockName: 'stone' })
      await bot.test.setInventorySlot(36, itemOf(bot, 'painting'))
      bot.setQuickBarSlot(0)
      await bot.lookAt(spot, true)
      // one wall block only leaves room for a 1x1 motive
      const hung = onceWithCleanup(bot._client, 'spawn_entity_painting', { timeout: 5000 })
      await bot.activateBlock(bot.blockAt(wall)!, new Vec3(0, 0, 1))
      const [packet] = await hung
      const painting = bot.blockAt(spot)!.painting!
      assert.ok(painting, 'the block holds the painting')
      assert.strictEqual(painting.id, packet.entityId)
      assert.ok(painting.position.equals(spot))
      assert.ok(painting.direction.equals(new Vec3(0, 0, -1)), `faces ${painting.direction}`)
      // the motive: its name before 1.13, its registry id since
      assert.strictEqual(typeof painting.name, bot.registry.version['>=']('1.13') ? 'number' : 'string')

      const destroyed = onceWithCleanup(bot._client, 'entity_destroy', { timeout: 5000, checkCondition: (p) => p.entityIds.includes(painting.id) })
      bot.chat(`/kill @e[type=${bot.registry.version['>=']('1.11') ? 'painting' : 'Painting'}]`)
      await destroyed
      assert.strictEqual(bot.blockAt(spot)!.painting, undefined)
    },

    async lightning (bot) {
      const ground = bot.test.groundY
      const name = bot.registry.version['>=']('1.11') ? 'lightning_bolt' : 'LightningBolt'
      const at = new Vec3(3.5, ground, 3.5)
      // before 1.16 lightning is a global entity of its own packet, then a plain entity
      const global = bot.registry.version['<']('1.16')
      const struck = onceWithCleanup(bot, 'entitySpawn', {
        timeout: 5000,
        checkCondition: (e: Entity) => global ? e.type === 'global' : e.name === 'lightning_bolt'
      })
      bot.chat(`/summon ${name} ${at.x} ${at.y} ${at.z}`)
      const [bolt] = await struck
      if (global) assert.strictEqual(bolt.globalType, 'thunderbolt')
      assert.ok(bolt.position.distanceTo(at) < 0.1, `the bolt is at ${bolt.position}, struck at ${at}`)
    },

    async pistonMove (bot) {
      const ground = bot.test.groundY
      const pistonPos = new Vec3(2, ground, 2)
      const placed = onceWithCleanup(bot.world, `blockUpdate:${pistonPos}`, { timeout: 5000, checkCondition: (_old, b) => b?.name === 'piston' })
      bot.chat(`/setblock ${pistonPos.x} ${pistonPos.y} ${pistonPos.z} ${bot.supportFeature('setBlockUsesMetadataNumber') ? 'piston 1' : 'piston[facing=up]'}`)
      await placed
      const moved = onceWithCleanup(bot, 'pistonMove', { timeout: 5000, checkCondition: (block) => block.position.equals(pistonPos) })
      bot.chat(`/setblock ${pistonPos.x + 1} ${pistonPos.y} ${pistonPos.z} redstone_block`)
      const [block, isPulling, direction] = await moved
      assert.strictEqual(block.name, 'piston')
      assert.strictEqual(isPulling, 0) // extending
      assert.strictEqual(direction, 1) // up
    },

    async storageBuilder (bot) {
      const builds: Array<{ version: string, worldName: string | undefined }> = []
      const saved = new Set<string>()
      const storageBot = mineflayer.createBot({
        username: 'storagebot',
        viewDistance: 'tiny',
        port: bot.test.port!,
        host: '127.0.0.1',
        version: bot.version,
        storageBuilder: (options) => {
          builds.push(options)
          const provider: world.StorageProvider = {
            load: async () => null as unknown as Awaited<ReturnType<world.StorageProvider['load']>>, // nothing stored: the world takes the server's columns
            save: async (x: number, z: number) => { saved.add(`${x},${z}`) }
          }
          return provider
        }
      })
      try {
        await once(storageBot, 'spawn')
        await storageBot.waitForChunksToLoad()
        await storageBot.world.async.waitSaving()
        assert.deepStrictEqual(builds, [{ version: storageBot.version, worldName: 'minecraft:overworld' }])
        const { x, z } = storageBot.entity.position
        assert.ok(saved.has(`${Math.floor(x / 16)},${Math.floor(z / 16)}`), `the bot's column was saved (${[...saved]})`)
      } finally {
        const left = onceWithCleanup(bot, 'playerLeft', { timeout: 10000, checkCondition: (player) => player.username === 'storagebot' })
        storageBot.end()
        await left.catch(() => {})
      }
    }
  }
}
