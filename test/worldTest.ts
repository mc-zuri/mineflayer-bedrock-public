import EventEmitter from 'events'
import assert from 'assert'
import prismarineRegistry from 'prismarine-registry'
import prismarineItem from 'prismarine-item'
import prismarineChunk from 'prismarine-chunk'
import prismarineBlock from 'prismarine-block'
import injectBlocks from '../lib/plugins/blocks.ts'
import anvilPlugin from '../lib/plugins/anvil.ts'
import diggingPlugin from '../lib/plugins/digging.ts'
import placeBlockPlugin from '../lib/plugins/place_block.ts'
import { Vec3 } from 'vec3'
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

  // 1.16+: the vanilla client starts a new world when the world (level) name changes, whatever the
  // dimension type and copyMetadata say
  for (const version of ['1.16.5', '1.19.4', '1.20.4', '1.21.4']) {
    it(`a respawn unloads the chunks only when the world name changes (${version})`, () => {
      const bot = createFakeBot(version)
      const Chunk = prismarineChunk(bot.registry)
      const worldData = bot.supportFeature('spawnRespawnWorldDataField')
      // the packets as each version has them; the 1.16 dimension NBT is a new object in every packet
      const dimension = (type: string) => version === '1.16.5' ? { type: 'compound', name: '', value: { type } } : worldData ? 0 : `minecraft:${type}`
      const login = (name: string) => worldData
        ? { worldState: { dimension: dimension('overworld'), name } }
        : version === '1.16.5' ? { dimension: dimension('overworld'), worldName: name } : { worldType: 'minecraft:overworld', worldName: name }
      const respawn = (name: string, type: string, copyMetadata: boolean) => worldData
        ? { worldState: { dimension: dimension(type), name }, copyMetadata }
        : { dimension: dimension(type), worldName: name, copyMetadata }
      const loaded = () => {
        const had = bot.world.getColumn(0, 0) !== null && bot.world.getColumn(0, 0) !== undefined
        bot.world.setColumn(0, 0, new Chunk({ minY: -64, worldHeight: 384 } as never))
        return had
      }

      bot._client.emit('login', login('minecraft:overworld') as never)
      loaded()
      // death respawns in the same world (copyMetadata false) keep the chunks, the first one too
      bot._client.emit('respawn', respawn('minecraft:overworld', 'overworld', false) as never)
      assert.strictEqual(loaded(), true, 'first death respawn')
      bot._client.emit('respawn', respawn('minecraft:overworld', 'overworld', false) as never)
      assert.strictEqual(loaded(), true, 'second death respawn')
      // another world of the same dimension type (Multiverse, proxies) is a new world
      bot._client.emit('respawn', respawn('minecraft:other', 'overworld', true) as never)
      assert.strictEqual(loaded(), false, 'other world, same dimension type')
      bot._client.emit('respawn', respawn('minecraft:the_nether', 'the_nether', true) as never)
      assert.strictEqual(loaded(), false, 'nether')
      bot._client.emit('respawn', respawn('minecraft:the_nether', 'the_nether', true) as never)
      assert.strictEqual(loaded(), true, 'same world')
    })
  }
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

  it('rename in creative does not wait for an xp change', async () => {
    const { bot, anvil } = await openFakeAnvil('creative', 0)
    const Item = prismarineItem(bot.registry)
    const sword = new Item(bot.registry.itemsByName.diamond_sword.id, 1)
    await anvil.rename(sword, 'Sting')
  })
})

describe('place_block plugin', () => {
  it('a placement whose destination chunk was not loaded settles on the update after it loads', async () => {
    const bot: any = new EventEmitter()
    bot.blockAt = () => null // dest is in an unloaded chunk
    bot._genericPlace = async () => {}
    placeBlockPlugin(bot)
    const reference = { name: 'stone', type: 1, position: new Vec3(15, 64, 0) }
    const dest = reference.position.offset(1, 0, 0)
    const air = { name: 'air', type: 0, position: dest }
    const dirt = { name: 'dirt', type: 3, position: dest }
    const placed: unknown[][] = []
    bot.on('blockPlaced', (oldBlock: unknown, newBlock: unknown) => placed.push([oldBlock, newBlock]))
    const placing = bot.placeBlock(reference, new Vec3(1, 0, 0))
    await new Promise(resolve => setImmediate(resolve))
    // the server's answer: the reference block, then dest (its chunk has loaded since)
    bot.emit(`blockUpdate:${reference.position}`, reference, reference)
    bot.emit(`blockUpdate:${dest}`, air, dirt)
    await placing
    assert.deepStrictEqual(placed, [[air, dirt]])
  })
})

describe('digging plugin', () => {
  for (const version of ['1.20.6', '1.21.4', '1.21.11', '26.1']) {
    it(`digTime counts Efficiency and Aqua Affinity of 1.20.5+ component items (${version})`, () => {
      const registry = prismarineRegistry(version)
      const Item = prismarineItem(registry)
      const Block = prismarineBlock(registry)
      const bot: any = new EventEmitter()
      bot.registry = registry
      bot.game = { gameMode: 'survival' }
      bot.entity = { position: new Vec3(0, 64, 0), eyeHeight: 1.62, onGround: true, effects: {} }
      bot.getEquipmentDestSlot = () => 5
      bot.inventory = { slots: [] }
      const water = Block.fromStateId(registry.blocksByName['water']!.defaultState, 0)
      let eyeBlock: unknown = null
      bot.blockAt = () => eyeBlock
      diggingPlugin(bot)
      // items as the server sends them (set_slot), enchantments as a component
      const enchanted = (name: string, enchantment: string, level: number) => Item.fromNotch({
        itemId: registry.itemsByName[name]!.id,
        itemCount: 1,
        components: [{ type: 'enchantments', data: { enchantments: [{ id: registry.enchantmentsByName[enchantment]!.id, level }] } }],
        removeComponents: []
      } as any)
      const stone = Block.fromStateId(registry.blocksByName['stone']!.defaultState, 0)
      const pickaxe = registry.itemsByName['diamond_pickaxe']!.id

      bot.heldItem = enchanted('diamond_pickaxe', 'efficiency', 5)
      assert.strictEqual(bot.digTime(stone), stone.digTime(pickaxe, false, false, false, [{ name: 'efficiency', lvl: 5 }], []))
      assert.ok(bot.digTime(stone) < stone.digTime(pickaxe, false, false, false, [], []))

      bot.heldItem = null
      bot.inventory.slots[5] = enchanted('diamond_helmet', 'aqua_affinity', 1)
      eyeBlock = water
      assert.strictEqual(bot.digTime(stone), stone.digTime(null, false, true, false, [{ name: 'aqua_affinity', lvl: 1 }], []))
      assert.ok(bot.digTime(stone) < stone.digTime(null, false, true, false, [], []))
    })
  }

  for (const [version, finish, abort] of [['26.1', 2, 1], ['26.3', 3, 2]] as const) {
    it(`uses the player action ids of ${version} (26.3 inserted CHANGE_DESTROY_DIRECTION at 1)`, async () => {
      const digBot = () => {
        const bot: any = new EventEmitter()
        const statuses: number[] = []
        bot._client = { write: (name: string, params: any) => { if (name === 'block_dig') statuses.push(params.status) } }
        bot._nextSequence = () => 0
        bot._updateBlockState = () => {}
        bot.swingArm = () => {}
        bot.heldItem = null
        bot.inventory = { slots: [] }
        bot.getEquipmentDestSlot = () => 5
        bot.game = { gameMode: 'survival' }
        bot.entity = { position: new Vec3(0, 64, 0), eyeHeight: 1.62, onGround: true, effects: {} }
        bot.blockAt = () => null
        bot.lookAt = async () => {}
        bot.registry = prismarineRegistry(version)
        diggingPlugin(bot)
        return { bot, statuses }
      }
      const block = (digTime: number) => ({ name: 'dirt', position: new Vec3(1, 64, 0), shapes: [[0, 0, 0, 1, 1, 1]], digTime: () => digTime })
      // a dig that runs its time: start, finish (the fake world never confirms the break)
      const finished = digBot()
      finished.bot.dig(block(10), true).catch(() => {})
      await new Promise(resolve => setTimeout(resolve, 50))
      assert.deepStrictEqual(finished.statuses, [0, finish])
      // a dig that is stopped: start, abort
      const stopped = digBot()
      const dig = stopped.bot.dig(block(1000), true).catch(() => {})
      await new Promise(resolve => setImmediate(resolve))
      stopped.bot.stopDigging()
      await dig
      assert.deepStrictEqual(stopped.statuses, [0, abort])
    })
  }

  it('a dig started while the previous one finishes during its look keeps both faces', async () => {
    const bot: any = new EventEmitter()
    const writes: Array<{ status: number, location: Vec3, face: number | null }> = []
    bot._client = { write: (name: string, params: any) => { if (name === 'block_dig') writes.push({ status: params.status, location: params.location, face: params.face }) } }
    bot._nextSequence = () => 0
    bot._updateBlockState = () => {}
    bot.swingArm = () => {}
    bot.heldItem = null
    bot.inventory = { slots: [] }
    bot.getEquipmentDestSlot = () => 5
    bot.game = { gameMode: 'survival' }
    bot.entity = { position: new Vec3(0, 64, 0), eyeHeight: 1.62, onGround: true, effects: {} }
    bot.blockAt = () => null
    let lookDelay = 0
    bot.lookAt = () => new Promise(resolve => setTimeout(resolve, lookDelay))
    bot.registry = prismarineRegistry('1.20.4') // a real bot always has its registry when the plugins are injected
    diggingPlugin(bot)
    const blockA = { name: 'dirt', position: new Vec3(1, 64, 0), shapes: [[0, 0, 0, 1, 1, 1]], digTime: () => 20 }
    const blockB = { name: 'dirt', position: new Vec3(0, 64, 1), shapes: [[0, 0, 0, 1, 1, 1]], digTime: () => 1000 }

    bot.dig(blockA, true, new Vec3(1, 0, 0)).catch(() => {}) // east face (5)
    await new Promise(resolve => setTimeout(resolve, 5))
    // B's look outlasts A's 20 ms dig: A finishes while B is still turning
    lookDelay = 50
    const digB = bot.dig(blockB, true, new Vec3(0, 0, 1)).catch(() => {}) // south face (3)
    await new Promise(resolve => setTimeout(resolve, 100))
    bot.stopDigging()
    await digB

    assert.deepStrictEqual(writes.slice(0, 3).map(({ status, location, face }) => [status, location.toString(), face]), [
      [0, blockA.position.toString(), 5], // start A
      [2, blockA.position.toString(), 5], // finish A, with A's face
      [0, blockB.position.toString(), 3] // start B, with B's face
    ])
  })

  it('the cancel face is the new dig\'s face for a new dig request and 0 (down) for stopDigging, like vanilla', async () => {
    const bot: any = new EventEmitter()
    const writes: Array<{ status: number, location: Vec3, face: number | null }> = []
    bot._client = { write: (name: string, params: any) => { if (name === 'block_dig') writes.push({ status: params.status, location: params.location, face: params.face }) } }
    bot._nextSequence = () => 0
    bot._updateBlockState = () => {}
    bot.swingArm = () => {}
    bot.heldItem = null
    bot.inventory = { slots: [] }
    bot.getEquipmentDestSlot = () => 5
    bot.game = { gameMode: 'survival' }
    bot.entity = { position: new Vec3(0, 64, 0), eyeHeight: 1.62, onGround: true, effects: {} }
    bot.blockAt = () => null
    bot.lookAt = async () => {}
    bot.registry = prismarineRegistry('1.20.4') // a real bot always has its registry when the plugins are injected
    diggingPlugin(bot)
    const blockA = { name: 'dirt', position: new Vec3(1, 64, 0), shapes: [[0, 0, 0, 1, 1, 1]], digTime: () => 1000 }
    const blockB = { name: 'dirt', position: new Vec3(0, 64, 1), shapes: [[0, 0, 0, 1, 1, 1]], digTime: () => 1000 }

    const digA = bot.dig(blockA, true, new Vec3(1, 0, 0)).catch(() => {}) // east face (5)
    await new Promise(resolve => setImmediate(resolve))
    const digB = bot.dig(blockB, true, new Vec3(0, 0, 1)).catch(() => {}) // south face (3)
    await digA
    bot.stopDigging()
    await digB

    const aborts = writes.filter(({ status }) => status === 1)
    assert.deepStrictEqual(aborts.map(({ location, face }) => [location.toString(), face]), [
      [blockA.position.toString(), 3], // abort A for the new dig: the new dig's face
      [blockB.position.toString(), 0] // stopDigging: face down (0)
    ])
  })

  it('a dig that interrupts another starts with its own face', async () => {
    const bot: any = new EventEmitter()
    const writes: Array<{ status: number, location: Vec3, face: number | null }> = []
    bot._client = { write: (name: string, params: any) => { if (name === 'block_dig') writes.push({ status: params.status, location: params.location, face: params.face }) } }
    bot._nextSequence = () => 0
    bot._updateBlockState = () => {}
    bot.swingArm = () => {}
    bot.heldItem = null
    bot.inventory = { slots: [] }
    bot.getEquipmentDestSlot = () => 5
    bot.game = { gameMode: 'survival' }
    bot.entity = { position: new Vec3(0, 64, 0), eyeHeight: 1.62, onGround: true, effects: {} }
    bot.blockAt = () => null
    bot.lookAt = async () => {}
    bot.registry = prismarineRegistry('1.20.4') // a real bot always has its registry when the plugins are injected
    diggingPlugin(bot)
    const blockA = { name: 'dirt', position: new Vec3(1, 64, 0), shapes: [[0, 0, 0, 1, 1, 1]], digTime: () => 1000 }
    const blockB = { name: 'dirt', position: new Vec3(0, 64, 1), shapes: [[0, 0, 0, 1, 1, 1]], digTime: () => 20 }

    const digA = bot.dig(blockA, true, new Vec3(1, 0, 0)).catch(() => {}) // east face (5)
    await new Promise(resolve => setImmediate(resolve))
    const digB = bot.dig(blockB, true, new Vec3(0, 0, 1)) // south face (3)
    await digA
    assert.strictEqual(bot.targetDigFace, 3)
    await new Promise(resolve => setTimeout(resolve, 40))
    bot.emit(`blockUpdate:${blockB.position}`, blockB, { name: 'air', type: 0, position: blockB.position })
    await digB

    assert.deepStrictEqual(writes.map(({ status, location, face }) => [status, location.toString(), face]), [
      [0, blockA.position.toString(), 5], // start A
      [1, blockA.position.toString(), 3], // abort A for the new dig
      [0, blockB.position.toString(), 3], // start B, with B's face
      [2, blockB.position.toString(), 3] // finish B, with B's face
    ])
  })
})
