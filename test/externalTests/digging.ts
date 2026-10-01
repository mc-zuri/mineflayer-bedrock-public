import assert from 'assert'
import { Vec3 } from 'vec3'
import prismarineItem from 'prismarine-item'
import prismarineWorld from 'prismarine-world'
import { once, onceWithCleanup, sleep } from '../../lib/promise_utils.ts'
import type { Block } from 'prismarine-block'
import type { TestBot, TestFunction } from './plugins/testCommon.ts'
import type { ServerboundPackets, TypedClient } from '../../lib/types/protocol.ts'
import type { ItemClass } from '../../lib/types/vendor/prismarine-item.ts'
import type { PrismarineWorldDefault } from '../../lib/types/vendor/prismarine-world.ts'

const { BlockFace } = (prismarineWorld as PrismarineWorldDefault).iterators

export default (): Record<string, TestFunction> => {
  const tests: Record<string, TestFunction> = {}

  function addTest (name: string, f: (bot: TestBot) => Promise<void>) {
    tests[name] = f
  }

  // Records the block_dig packets the bot sends until restored.
  function captureDigs (bot: TestBot) {
    const sent: Array<ServerboundPackets['block_dig']> = []
    const write = bot._client.write
    bot._client.write = function (this: TypedClient, name: string, params: unknown) {
      if (name === 'block_dig') sent.push(params as ServerboundPackets['block_dig'])
      write.apply(this, arguments as unknown as Parameters<TypedClient['write']>)
    } as TypedClient['write']
    return { sent, restore: () => { bot._client.write = write } }
  }

  // relative to the bot's spawn point (0.5, groundY, 0.5)
  const at = (bot: TestBot, x: number, y: number, z: number) => new Vec3(x, bot.test.groundY + y, z)

  async function setBlock (bot: TestBot, pos: Vec3, blockName: string) {
    await bot.test.setBlock({ x: pos.x, y: pos.y, z: pos.z, blockName })
  }

  function blockAt (bot: TestBot, pos: Vec3): Block {
    const block = bot.blockAt(pos)
    assert(block, `block at ${pos} is not loaded`)
    return block
  }

  // A dug block can be put back by the server when it refuses the break: the
  // block is still air once the server answered a later chat message.
  async function assertStaysAir (bot: TestBot, pos: Vec3, names = ['air']) {
    await bot.test.awaitCommandsProcessed(`dig-check-${pos.x}-${pos.y}-${pos.z}`)
    await sleep(300)
    assert(names.includes(blockAt(bot, pos).name), `the server put back the block at ${pos}: ${blockAt(bot, pos).name}`)
  }

  // resetState leaves the bot flying (gravity 0): it has to fall back on its feet,
  // a dig in the air is 5 times slower
  async function survival (bot: TestBot) {
    bot.creative.stopFlying()
    await bot.test.becomeSurvival()
  }

  async function waitOnGround (bot: TestBot) {
    const deadline = Date.now() + 5000
    while (!bot.entity.onGround) {
      if (Date.now() > deadline) throw new Error('the bot never landed')
      await sleep(50)
    }
  }

  addTest('raycast digs the closest visible face', async (bot) => {
    const pos = at(bot, 2, 0, 0)
    await setBlock(bot, pos, 'dirt')
    const digs = captureDigs(bot)
    try {
      await bot.dig(blockAt(bot, pos), true, 'raycast')
    } finally {
      digs.restore()
    }
    // From the eyes at (0.5, 1.62, 0.5) the west face's centre is closer than the top's.
    assert.strictEqual(digs.sent[0]?.status, 0)
    assert.strictEqual(digs.sent[0]?.face, BlockFace.WEST)
    assert.strictEqual(blockAt(bot, pos).name, 'air')
  })

  addTest('raycast refuses a block whose visible faces are covered', async (bot) => {
    const pos = at(bot, 3, 0, 0)
    await setBlock(bot, pos, 'dirt')
    await setBlock(bot, at(bot, 2, 0, 0), 'stone') // in front of the west face
    await setBlock(bot, at(bot, 3, 1, 0), 'stone') // on top
    const digs = captureDigs(bot)
    try {
      await assert.rejects(bot.dig(blockAt(bot, pos), true, 'raycast'), /Block not in view/)
    } finally {
      digs.restore()
    }
    assert.deepStrictEqual(digs.sent, [])
    assert.strictEqual(bot.targetDigBlock, null)
    assert.strictEqual(blockAt(bot, pos).name, 'dirt')
  })

  addTest('raycast digs a replaceable block without a face to hit', async (bot) => {
    // tallgrass before 1.13, grass until 1.20.3 renamed it short_grass
    const name = bot.registry.blocksByName['short_grass']
      ? 'short_grass'
      : bot.supportFeature('itemsAreNotBlocks') ? 'grass' : 'tallgrass'
    const pos = at(bot, 2, 0, 0)
    await setBlock(bot, pos, name)
    const block = blockAt(bot, pos)
    assert.strictEqual(block.name, name)
    assert.deepStrictEqual(block.shapes, [])
    await bot.dig(block, true, 'raycast')
    assert.strictEqual(blockAt(bot, pos).name, 'air')
    await assertStaysAir(bot, pos)
  })

  addTest('a vector face picks the dig face', async (bot) => {
    const below = at(bot, 1, 0, 0)
    const above = at(bot, 1, 3, 0)
    const side = at(bot, 2, 1, 0)
    await setBlock(bot, below, 'dirt')
    await setBlock(bot, above, 'dirt')
    await setBlock(bot, side, 'dirt')
    const digs = captureDigs(bot)
    try {
      await bot.dig(blockAt(bot, below), true, new Vec3(0, 1, 0))
      await bot.dig(blockAt(bot, above), true, new Vec3(0, -1, 0))
      await bot.dig(blockAt(bot, side), true, new Vec3(-1, 0, 0))
    } finally {
      digs.restore()
    }
    const starts = digs.sent.filter(packet => packet.status === 0)
    assert.deepStrictEqual(starts.map(packet => packet.face), [BlockFace.TOP, BlockFace.BOTTOM, BlockFace.WEST])
    assert.deepStrictEqual(starts.map(packet => new Vec3(packet.location.x, packet.location.y, packet.location.z)), [below, above, side])
    for (const pos of [below, above, side]) assert.strictEqual(blockAt(bot, pos).name, 'air')
  })

  addTest('a held pickaxe digs stone fast and the server accepts it', async (bot) => {
    const Item = prismarineItem(bot.registry) as ItemClass
    await bot.test.setInventorySlot(36, new Item(bot.registry.itemsByName['diamond_pickaxe']!.id, 1, 0))
    const pos = at(bot, 1, 0, 0)
    await setBlock(bot, pos, 'stone')
    await survival(bot)
    await waitOnGround(bot)
    const stone = blockAt(bot, pos)

    bot.setQuickBarSlot(1) // empty hand
    assert.strictEqual(bot.heldItem?.name, undefined)
    const bareHanded = bot.digTime(stone)
    bot.setQuickBarSlot(0)
    assert.strictEqual(bot.heldItem?.name, 'diamond_pickaxe')
    const withPickaxe = bot.digTime(stone)
    // stone: 1.5 hardness, x5 without the right tool (7.5 s), diamond speed 8 (0.3 s)
    assert(bareHanded > 5000, `bare-handed stone dig time ${bareHanded}ms`)
    assert(withPickaxe > 0 && withPickaxe < 1000, `diamond pickaxe stone dig time ${withPickaxe}ms`)

    const start = performance.now()
    await bot.dig(stone, true)
    assert(performance.now() - start < 2000, 'the dig waited for the bare-handed time')
    await assertStaysAir(bot, pos)
  })

  addTest('an aqua affinity helmet keeps the dry dig time under water', async (bot) => {
    const g = bot.test.groundY
    if (bot.supportFeature('itemsWithComponents')) {
      // Component-era servers strip enchantments from creative slot writes
      const enchantments = bot.supportFeature('enchantmentsComponentIsFlat')
        ? '{"minecraft:aqua_affinity":1}'
        : '{levels:{"minecraft:aqua_affinity":1}}'
      await bot.test.awaitItemReceived(`/give @a minecraft:diamond_helmet[minecraft:enchantments=${enchantments}] 1`)
      await survival(bot)
      await bot.equip(bot.inventory.items().find(item => item.name === 'diamond_helmet')!, 'head')
    } else {
      const Item = prismarineItem(bot.registry) as ItemClass
      const helmet = new Item(bot.registry.itemsByName['diamond_helmet']!.id, 1, 0)
      helmet.enchants = [{ name: 'aqua_affinity', lvl: 1 }]
      await bot.test.setInventorySlot(5, helmet)
      await survival(bot)
    }
    assert.strictEqual(bot.inventory.slots[bot.getEquipmentDestSlot('head')]?.name, 'diamond_helmet')

    // the bot stands in a 1x2 water column inside a dirt shell
    const eye = at(bot, 0, 1, 0)
    const isWater = () => ['water', 'flowing_water'].includes(bot.blockAt(eye)?.name as string)
    bot.chat(`/fill -1 ${g} -1 1 ${g + 2} 1 dirt`)
    bot.chat(`/fill 0 ${g} 0 0 ${g + 1} 0 water`)
    if (!isWater()) await onceWithCleanup(bot.world, 'blockUpdate', { timeout: 5000, checkCondition: isWater })
    await waitOnGround(bot)

    const pos = at(bot, 1, 1, 0)
    const wall = blockAt(bot, pos)
    assert.strictEqual(wall.name, 'dirt')
    const dry = wall.digTime(null, false, false, false, [], bot.entity.effects)
    const wet = wall.digTime(null, false, true, false, [], bot.entity.effects)
    assert(wet > dry, `under water without aqua affinity the dig is slower (${wet}ms vs ${dry}ms)`)
    assert.strictEqual(bot.digTime(wall), dry)

    await bot.dig(wall, true)
    await assertStaysAir(bot, pos, ['air', 'water', 'flowing_water']) // the column's water flows in
  })

  addTest('bedrock cannot be dug in survival', async (bot) => {
    const pos = at(bot, 1, 0, 0)
    await setBlock(bot, pos, 'bedrock')
    await survival(bot)
    const digs = captureDigs(bot)
    try {
      assert.strictEqual(bot.digTime(blockAt(bot, pos)), Infinity)
      await assert.rejects(bot.dig(blockAt(bot, pos)), /dig time for bedrock is Infinity/)
    } finally {
      digs.restore()
    }
    assert.deepStrictEqual(digs.sent, [])
    assert.strictEqual(blockAt(bot, pos).name, 'bedrock')
  })

  addTest('stopDigging aborts the dig and a new dig completes', async (bot) => {
    const pos = at(bot, 1, 0, 0)
    await setBlock(bot, pos, 'dirt')
    await survival(bot)
    await waitOnGround(bot)
    await assert.rejects(bot.dig(null as unknown as Block), /dig was called with an undefined or null block/)

    const dirt = blockAt(bot, pos)
    assert(bot.canDigBlock(dirt))
    assert(!bot.canDigBlock(blockAt(bot, at(bot, 5, 0, 5))), 'a block 7 blocks away is out of reach')
    assert(bot.digTime(dirt) >= 500, `bare-handed dirt takes 750ms, got ${bot.digTime(dirt)}`)

    const aborted = once(bot, 'diggingAborted')
    const dig = bot.dig(dirt, true)
    const digResult = dig.then(() => null, (err: unknown) => err)
    await sleep(100)
    assert(bot.targetDigBlock?.position.equals(pos), 'the dig should be running')
    bot.stopDigging()
    const [abortedBlock] = await aborted
    assert(abortedBlock.position.equals(pos))
    const err = await digResult
    assert(err instanceof Error && err.message === 'Digging aborted', `dig should reject with Digging aborted, got ${err}`)
    assert.strictEqual(bot.targetDigBlock, null)
    await bot.test.awaitCommandsProcessed('dig-aborted')
    await sleep(300)
    assert.strictEqual(blockAt(bot, pos).name, 'dirt', 'an aborted dig must not break the block')

    const completed = once(bot, 'diggingCompleted')
    await bot.dig(blockAt(bot, pos), true)
    const [completedBlock] = await completed
    assert(completedBlock.position.equals(pos))
    assert.strictEqual(completedBlock.name, 'air')
    assert.strictEqual(bot.targetDigBlock, null)
    await assertStaysAir(bot, pos)
  })

  return tests
}
