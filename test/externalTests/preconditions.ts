import assert from 'assert'
import { Vec3 } from 'vec3'
import prismarineItem from 'prismarine-item'
import { onceWithCleanup } from '../../lib/promise_utils.ts'
import type { Entity } from 'prismarine-entity'
import type { TestBot, TestFunction } from './plugins/testCommon.ts'

// The errors elytraFly, sleep / wake, craft and fish give when their preconditions do not hold.
export default (): Record<string, TestFunction> => {
  const itemOf = (bot: TestBot, name: string, count = 1) => {
    const Item = prismarineItem(bot.registry)
    return new Item(bot.registry.itemsByName[name]!.id, count, 0)
  }

  // the time of day the bot sees, after a /time set
  async function setTime (bot: TestBot, time: number) {
    const night = time >= 12541 && time <= 23458
    const seen = onceWithCleanup(bot, 'time', {
      timeout: 5000,
      checkCondition: () => { const t = bot.time.timeOfDay ?? -1; return (t >= 12541 && t <= 23458) === night }
    })
    bot.chat(`/time set ${time}`)
    await seen
  }

  // a bed whose foot is at the given position, its head one block south
  async function placeBed (bot: TestBot, foot: Vec3) {
    const bedName = bot.registry.itemsArray.find(item => item.name.endsWith('bed'))!.name
    const head = foot.offset(0, 0, 1)
    const placed = [foot, head].map(pos => onceWithCleanup(bot.world, `blockUpdate:${pos}`, {
      timeout: 5000,
      checkCondition: (_old, block) => block?.name.endsWith('bed') === true
    }))
    if (bot.supportFeature('setBlockUsesMetadataNumber')) {
      bot.chat(`/setblock ${foot.x} ${foot.y} ${foot.z} ${bedName} 0`)
      bot.chat(`/setblock ${head.x} ${head.y} ${head.z} ${bedName} 8`)
    } else {
      bot.chat(`/setblock ${foot.x} ${foot.y} ${foot.z} ${bedName}[part=foot,facing=south]`)
      bot.chat(`/setblock ${head.x} ${head.y} ${head.z} ${bedName}[part=head,facing=south]`)
    }
    await Promise.all(placed)
    return bot.blockAt(foot)!
  }

  async function landOnGround (bot: TestBot) {
    await bot.test.becomeSurvival()
    bot.creative.stopFlying()
    while (!bot.entity.onGround) await onceWithCleanup(bot, 'physicsTick', { timeout: 5000 })
  }

  const tests: Record<string, TestFunction> = {
    async elytra (bot) {
      if (!bot.supportFeature('hasElytraFlying')) return // no elytra before 1.9
      const ground = bot.test.groundY
      // on the ground
      await landOnGround(bot)
      await assert.rejects(bot.elytraFly(), /Unable to fly from ground/)

      // in the air without an elytra
      await bot.test.teleport(new Vec3(0.5, ground + 40, 0.5))
      await bot.waitForTicks(2)
      assert.ok(!bot.entity.onGround)
      await assert.rejects(bot.elytraFly(), /Elytra must be equip/)

      // in water, sinking: a water column inside glass walls
      await bot.test.becomeCreative()
      bot.chat(`/fill 2 ${ground} -2 4 ${ground + 4} 0 glass`)
      bot.chat(`/fill 3 ${ground + 1} -1 3 ${ground + 4} -1 water`)
      await bot.test.awaitCommandsProcessed('water-column-filled')
      await bot.test.becomeSurvival()
      await bot.test.teleport(new Vec3(3.5, ground + 3, -0.5))
      while (!bot.entity.isInWater) await onceWithCleanup(bot, 'physicsTick', { timeout: 5000 })
      assert.ok(!bot.entity.onGround)
      await assert.rejects(bot.elytraFly(), /Unable to elytra fly while in water/)

      // a firework's boost ends when the flight does
      const fireworkItem = bot.registry.itemsArray.find(item => item.displayName === 'Firework Rocket')
      // mineflayer tracks rockets by their entity name, which 1.9 / 1.10 data does not have
      if (!fireworkItem || !(bot.supportFeature('fireworkNamePlural') || bot.supportFeature('fireworkNameSingular'))) return
      await bot.test.becomeCreative()
      await bot.test.setInventorySlot(6, itemOf(bot, 'elytra'))
      await bot.test.setInventorySlot(36, itemOf(bot, fireworkItem.name, 8))
      bot.setQuickBarSlot(0)
      await bot.test.teleport(new Vec3(0.5, ground + 60, 0.5))
      await bot.test.becomeSurvival()
      bot.creative.stopFlying()
      await bot.look(0, 0, true)
      await bot.waitForTicks(5)
      const flew = onceWithCleanup(bot, 'entityElytraFlew', { timeout: 5000, checkCondition: (e: Entity) => e === bot.entity })
      await bot.elytraFly()
      await flew
      await assert.rejects(bot.elytraFly(), /Already elytra flying/)
      const used = onceWithCleanup(bot, 'usedFirework', { timeout: 5000 })
      bot.activateItem()
      await used
      assert.ok(bot.fireworkRocketDuration > 0)
      // landing (a teleport to the ground) stops the flight, and with it the boost
      await bot.test.teleport(new Vec3(0.5, ground, 0.5))
      while (bot.entity.elytraFlying) await onceWithCleanup(bot, 'physicsTick', { timeout: 5000 })
      assert.strictEqual(bot.fireworkRocketDuration, 0)
    },

    async bed (bot) {
      const ground = bot.test.groundY
      await bot.waitForChunksToLoad()
      await landOnGround(bot)
      const bed = await placeBed(bot, new Vec3(2, ground, 0))
      await setTime(bot, 1000)
      await assert.rejects(bot.sleep(bed), /it's not night/)
      await assert.rejects(bot.wake(), /already awake/)

      await setTime(bot, 18000)
      await assert.rejects(bot.sleep(bot.blockAt(new Vec3(0, ground - 1, 0))!), /not a bed block/)
      // out of reach to click (and inside the area the reset restores)
      await assert.rejects(bot.sleep(await placeBed(bot, new Vec3(5, ground, 3))), /cant click the bed/)
      // in reach to click, out of the sleeping range: 4 blocks away
      await assert.rejects(bot.sleep(await placeBed(bot, new Vec3(-4, ground, 0))), /the bed is too far/)

      // a monster next to the bed (NoAI: it stays where it is summoned)
      const zombieName = bot.registry.entitiesByName['zombie'] ? 'zombie' : 'Zombie'
      const summoned = onceWithCleanup(bot, 'entitySpawn', { timeout: 5000, checkCondition: (e: Entity) => e.name === zombieName })
      bot.chat(`/summon ${zombieName} 2.5 ${ground} 4.5 {NoAI:1}`)
      const [zombie] = await summoned
      await assert.rejects(bot.sleep(bed), /there are monsters nearby/)
      await bot.test.killEntity(zombie)

      // sleeping, then sleeping again
      await bot.sleep(bed)
      assert.ok(bot.isSleeping)
      await assert.rejects(bot.sleep(bed), /already sleeping/)
      const woke = onceWithCleanup(bot, 'wake', { timeout: 5000 })
      await bot.wake()
      await woke
      await setTime(bot, 1000)
    },

    async craft (bot) {
      const ground = bot.test.groundY
      const { itemsByName } = bot.registry
      // a 3 x 3 recipe without a table
      const [chestRecipe] = bot.recipesAll(itemsByName['chest']!.id, null, true)
      assert.ok(chestRecipe?.requiresTable)
      await assert.rejects(bot.craft(chestRecipe, 1, null), /requires craftingTable/)

      // a block that does not open a crafting window
      const chestPos = new Vec3(1, ground, 0)
      await bot.test.setBlock({ ...chestPos, blockName: 'chest' })
      const planks = bot.registry.itemsArray.find(item => item.name === 'planks' || item.name === 'oak_planks')!
      const [tableRecipe] = bot.recipesAll(itemsByName['crafting_table']!.id, null, true)
      await bot.test.setInventorySlot(36, itemOf(bot, planks.name, 4))
      await bot.test.becomeSurvival()
      const closed = onceWithCleanup(bot, 'windowClose', { timeout: 5000 })
      await assert.rejects(bot.craft(tableRecipe!, 1, bot.blockAt(chestPos)), /non craftingTable used as craftingTable/)
      await closed

      // cake leaves its milk buckets behind (only <= 1.18 data has recipes with an outShape)
      const cakeRecipe = bot.registry.recipes[itemsByName['cake']!.id]?.find(recipe => 'outShape' in recipe)
      if (!cakeRecipe) return
      await bot.test.becomeCreative()
      await bot.test.setBlock({ ...chestPos, blockName: 'crafting_table' })
      await Promise.all([
        bot.test.setInventorySlot(9, itemOf(bot, 'milk_bucket')),
        bot.test.setInventorySlot(10, itemOf(bot, 'milk_bucket')),
        bot.test.setInventorySlot(11, itemOf(bot, 'milk_bucket')),
        bot.test.setInventorySlot(12, itemOf(bot, 'sugar', 2)),
        bot.test.setInventorySlot(13, itemOf(bot, 'egg')),
        bot.test.setInventorySlot(14, itemOf(bot, 'wheat', 3)),
        bot.test.setInventorySlot(36, null)
      ])
      await bot.test.becomeSurvival()
      const table = bot.blockAt(chestPos)!
      const [recipe] = bot.recipesFor(itemsByName['cake']!.id, null, 1, table)
      assert.ok(recipe?.outShape, 'the cake recipe has an outShape')
      await bot.craft(recipe, 1, table)
      const count = (name: string) => bot.inventory.count(itemsByName[name]!.id, null)
      assert.strictEqual(count('cake'), 1)
      assert.strictEqual(count('bucket'), 3)
      assert.strictEqual(count('milk_bucket'), 0)
    },

    async fishing (bot) {
      await bot.test.setInventorySlot(36, itemOf(bot, 'fishing_rod'))
      bot.setQuickBarSlot(0)
      await bot.look(0, 0, true)
      // the bot's bobber: a fishing hook's object data is its owner's entity id
      const bobberSpawn = () => onceWithCleanup(bot._client, 'spawn_entity', {
        timeout: 5000,
        checkCondition: (packet) => packet.objectData === bot.entity.id
      })

      // casting again reels the first bobber in: the first fish() is cancelled by the second call, the second
      // by its bobber going away
      let spawned = bobberSpawn()
      const first = bot.fish()
      await spawned
      const second = bot.fish()
      await assert.rejects(first, /calling bot\.fish\(\) again/)
      await assert.rejects(second, /Fishing cancelled/)

      // a bobber removed by the server cancels fishing: killed on 1.13+ (no selectable entity type before),
      // dropped when the rod leaves the hand before
      spawned = bobberSpawn()
      const third = bot.fish()
      await spawned
      if (bot.registry.version['>=']('1.13')) bot.chat('/kill @e[type=fishing_bobber]')
      else bot.setQuickBarSlot(1)
      await assert.rejects(third, /Fishing cancelled$/)
    }
  }
  // the hotbar selection survives the reset between tests, and later tests hold their items in slot 0
  return Object.fromEntries(Object.entries(tests).map(([name, test]) => [name, async (bot: TestBot, done: Mocha.Done) => {
    try {
      await test(bot, done)
    } finally {
      bot.setQuickBarSlot(0)
    }
  }]))
}
