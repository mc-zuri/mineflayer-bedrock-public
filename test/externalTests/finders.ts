import assert from 'assert'
import { Vec3 } from 'vec3'
import { onceWithCleanup } from '../../lib/promise_utils.ts'
import type { Entity } from 'prismarine-entity'
import type { TestBot, TestFunction } from './plugins/testCommon.ts'

export default (): Record<string, TestFunction> => {
  const tests: Record<string, TestFunction> = {}

  function addTest (name: string, f: (bot: TestBot) => Promise<void>) {
    tests[name] = f
  }

  // relative to the bot's spawn point (0.5, groundY, 0.5), which every test starts from
  const at = (bot: TestBot, x: number, y: number, z: number) => new Vec3(x, bot.test.groundY + y, z)
  const eyes = (bot: TestBot) => bot.entity.position.offset(0, bot.entity.eyeHeight, 0)

  async function setBlock (bot: TestBot, pos: Vec3, blockName: string) {
    await bot.test.setBlock({ x: pos.x, y: pos.y, z: pos.z, blockName })
  }

  // a villager without AI stays where it is summoned (spawn-animals=false makes 1.8 - 1.21.1 servers
  // remove animals on their first tick, spawn-npcs=true keeps villagers)
  async function summonVillager (bot: TestBot, pos: Vec3): Promise<Entity> {
    const name = bot.supportFeature('entityNameUpperCaseNoUnderscore') ? 'Villager' : 'villager'
    const spawned = onceWithCleanup(bot, 'entitySpawn', { timeout: 5000, checkCondition: entity => entity.name === name && entity.position.distanceTo(pos) < 1 })
    bot.chat(`/summon ${name} ${pos.x} ${pos.y} ${pos.z} {NoAI:1}`)
    const [villager] = await spawned
    return villager
  }

  // runs the test with a villager, which is killed afterwards; a failed kill doesn't hide the test's error
  async function withVillager (bot: TestBot, pos: Vec3, test: (villager: Entity) => Promise<void>) {
    const villager = await summonVillager(bot, pos)
    let failed = true
    try {
      await test(villager)
      failed = false
    } finally {
      await bot.test.killEntity(villager).catch((err: unknown) => { if (!failed) throw err })
    }
  }

  addTest('entityAtCursor', async (bot) => {
    await withVillager(bot, at(bot, 0.5, 0, 2.5), async (villager) => {
      const villagerCentre = villager.position.offset(0, villager.height / 2, 0)

      await bot.lookAt(villagerCentre, true)
      assert.strictEqual(bot.entityAtCursor(), villager)
      // out of the default 3.5 reach only with a shorter one
      assert.strictEqual(bot.entityAtCursor(1), null)

      // the villager is behind the bot
      await bot.lookAt(eyes(bot).plus(eyes(bot).minus(villagerCentre)), true)
      assert.strictEqual(bot.entityAtCursor(), null)

      // a block between the bot and the villager hides it
      const wall = at(bot, 0, 1, 1)
      await setBlock(bot, wall, 'stone')
      await bot.lookAt(villagerCentre, true)
      assert.strictEqual(bot.blockAtCursor(5)?.position.toString(), wall.toString())
      assert.strictEqual(bot.entityAtCursor(), null)
    })
  })

  addTest('findPlayer and findPlayers', async (bot) => {
    await withVillager(bot, at(bot, 0.5, 0, 2.5), async (villager) => {
      // a string matches one username, ignoring case: one entity or null
      assert.strictEqual(bot.findPlayer(bot.username), bot.entity)
      assert.strictEqual(bot.findPlayer(bot.username.toUpperCase()), bot.entity)
      assert.strictEqual(bot.findPlayer('nobody_here'), null)
      // a regex, a function or null give an array
      assert.deepStrictEqual(bot.findPlayers(/^flat/), [bot.entity])
      assert.deepStrictEqual(bot.findPlayers(/^nobody/), [])
      assert.deepStrictEqual(bot.findPlayers((entity) => entity.username === bot.username), [bot.entity])
      const everyone = bot.findPlayers(null)
      assert(everyone.includes(bot.entity), 'findPlayers(null) lists the bot')
      assert(!everyone.includes(villager), 'findPlayers(null) lists only players')
      assert(everyone.every(entity => entity.type === 'player'))
    })
  })

  addTest('blockAtCursor and blockAtEntityCursor', async (bot) => {
    const stone = at(bot, 0, 1, -2)
    const gold = at(bot, 0, 1, -4)
    await setBlock(bot, stone, 'stone')
    await setBlock(bot, gold, 'gold_block')

    // straight at the stone's south face
    await bot.lookAt(new Vec3(0.5, stone.y + 0.5, stone.z + 1), true)
    const hit = bot.blockAtCursor()
    assert.strictEqual(hit?.position.toString(), stone.toString())
    assert.strictEqual(hit.face, 3) // south
    assert.strictEqual(bot.blockAtEntityCursor(bot.entity)?.position.toString(), stone.toString())
    assert.strictEqual(bot.blockAtEntityCursor()?.position.toString(), stone.toString())
    assert.strictEqual(bot.blockAtCursor(1), null, 'the stone is 1.5 blocks away')
    // a matcher looks through the blocks it rejects
    assert.strictEqual(bot.blockAtCursor(256, (block) => block.name === 'gold_block')?.position.toString(), gold.toString())

    // near the top edge of the stone's face: the ray must start at the eyes
    // (1.62 above the feet), not at the top of the head (1.8), to hit it
    await bot.lookAt(new Vec3(0.5, stone.y + 0.95, stone.z + 1), true)
    assert.strictEqual(bot.blockAtCursor()?.position.toString(), stone.toString())
    assert.strictEqual(bot.blockInSight()?.position.toString(), stone.toString())
  })

  addTest('canSeeBlock', async (bot) => {
    const below = bot.blockAt(at(bot, 0, -1, 0))!
    assert.strictEqual(bot.canSeeBlock(below), true)

    // in plain sight, up and to the side of the eyes
    const floating = at(bot, 3, 2, 1)
    await setBlock(bot, floating, 'stone')
    assert.strictEqual(bot.canSeeBlock(bot.blockAt(floating)!), true)

    // behind a wall
    const hidden = at(bot, 3, 0, 0)
    await setBlock(bot, hidden, 'stone')
    assert.strictEqual(bot.canSeeBlock(bot.blockAt(hidden)!), true)
    await setBlock(bot, at(bot, 2, 0, 0), 'stone')
    await setBlock(bot, at(bot, 2, 1, 0), 'stone')
    assert(!bot.canSeeBlock(bot.blockAt(hidden)!), 'a wall hides the block')
  })

  addTest('findBlock and findBlocks', async (bot) => {
    const goldId = bot.registry.blocksByName['gold_block']!.id
    const emeraldId = bot.registry.blocksByName['emerald_block']!.id
    // 2, 3 and 4 blocks from the bot's block
    const golds = [at(bot, 2, 0, 0), at(bot, 0, 0, 3), at(bot, -4, 0, 0)]
    for (const pos of golds) await setBlock(bot, pos, 'gold_block')
    const str = (positions: Vec3[]) => positions.map(pos => pos.toString())
    const maxDistance = 6 // other tests may have left gold blocks further away

    assert.deepStrictEqual(str(bot.findBlocks({ matching: goldId, maxDistance, count: 2 })), str(golds.slice(0, 2)))
    assert.deepStrictEqual(str(bot.findBlocks({ matching: [emeraldId, goldId], maxDistance, count: 10 })), str(golds))
    assert.deepStrictEqual(str(bot.findBlocks({ matching: goldId, maxDistance: 3.5, count: 10 })), str(golds.slice(0, 2)))
    // a function matcher, alone and with a function or full extra info filter
    assert.deepStrictEqual(str(bot.findBlocks({ matching: block => block.name === 'gold_block', maxDistance, count: 10 })), str(golds))
    assert.deepStrictEqual(str(bot.findBlocks({ matching: goldId, maxDistance, count: 10, useExtraInfo: block => block.position.x < 0 })), str(golds.slice(2)))
    assert.deepStrictEqual(str(bot.findBlocks({ matching: block => block.name === 'gold_block' && block.position.z === 3, maxDistance, count: 10, useExtraInfo: true })), str(golds.slice(1, 2)))
    // from another point
    assert.strictEqual(bot.findBlock({ matching: goldId, maxDistance, point: golds[2]!.offset(0, 1, 0) })?.position.toString(), golds[2]!.toString())

    // nothing to find
    assert.deepStrictEqual(bot.findBlocks({ matching: emeraldId, maxDistance, count: 5 }), [])
    assert.strictEqual(bot.findBlock({ matching: emeraldId, maxDistance }), null)
  })

  return tests
}
