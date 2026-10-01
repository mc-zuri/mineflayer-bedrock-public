// The physics plugin on a fake bot: the real entities and physics plugins, a fake client that records
// what the bot writes, and a flat world (stone below y = 64). Ticks run on the plugin's own timer.
import EventEmitter from 'events'
import assert from 'assert'
import prismarineRegistry from 'prismarine-registry'
import prismarineBlock from 'prismarine-block'
import prismarineEntity from 'prismarine-entity'
import { Vec3 } from 'vec3'
import entitiesPlugin from '../lib/plugins/entities.ts'
import physicsPlugin from '../lib/plugins/physics.ts'
import abilitiesPlugin from '../lib/plugins/abilities.ts'
import type { Block } from 'prismarine-block'
import type { BotInternal } from '../lib/types/internal.ts'
import type { BotOptions } from '../lib/types/mineflayer.ts'

const GROUND = 64

interface Written { name: string, params: any }

interface FakeBot extends BotInternal {
  writes: Written[]
  /** the blocks the test placed, by "x,y,z" (else stone below GROUND, air above) */
  blocks: Map<string, string>
}

function createFakeBot (version: string, options: Partial<BotOptions> = {}): FakeBot {
  const registry = prismarineRegistry(version)
  const Block = prismarineBlock(registry)
  const bot = new EventEmitter() as unknown as FakeBot
  bot.version = version
  bot.registry = registry as BotInternal['registry']
  bot.supportFeature = registry.supportFeature.bind(registry) as BotInternal['supportFeature']
  bot.writes = []
  bot.blocks = new Map()
  const client = new EventEmitter() as any
  client.username = 'bot'
  client.state = 'play'
  client.write = (name: string, params: unknown) => { bot.writes.push({ name, params }) }
  bot._client = client
  bot.game = { gameMode: 'survival' } as BotInternal['game']
  bot.abilities = { invulnerable: false, flying: false, mayFly: false, instantBuild: false, flyingSpeed: 0.05, walkingSpeed: 0.1 }
  bot.isAlive = true
  bot.food = 20
  bot.health = 20
  bot.usingHeldItem = false
  bot.heldItem = null
  bot.inventory = { slots: new Array(46).fill(null) } as unknown as BotInternal['inventory']
  bot.getEquipmentDestSlot = () => 6
  bot.blockAt = (pos: Vec3) => {
    const p = pos.floored()
    const name = bot.blocks.get(`${p.x},${p.y},${p.z}`) ?? (p.y < GROUND ? 'stone' : 'air')
    const block = Block.fromStateId(registry.blocksByName[name]!.defaultState!, 0) as Block
    block.position = p
    return block
  }
  entitiesPlugin(bot)
  abilitiesPlugin(bot)
  physicsPlugin(bot, options as BotOptions)
  client.emit('login', { entityId: 1 })
  bot.emit('login')
  return bot
}

/** a teleport the bot answers on its next tick, which starts the physics */
function teleport (bot: FakeBot, pos: Vec3) {
  const bitflags = bot.supportFeature('positionPacketHasBitflags')
  bot._client.emit('position', {
    x: pos.x,
    y: pos.y,
    z: pos.z,
    dx: 0,
    dy: 0,
    dz: 0,
    yaw: 0,
    pitch: 0,
    flags: bitflags ? { x: false, y: false, z: false, yaw: false, pitch: false } : 0,
    teleportId: 1
  } as any)
}

async function ticks (bot: FakeBot, n: number) {
  for (let i = 0; i < n; i++) await new Promise<void>(resolve => bot.once('physicsTick', () => resolve()))
}

/** an entity the bot knows of, as the entities plugin would have it after its spawn packet */
function addEntity (bot: FakeBot, id: number, name: string, pos: Vec3) {
  const Entity = (prismarineEntity as unknown as (version: string) => new (id: number) => BotInternal['entity'])(bot.version)
  const entity = new Entity(id)
  entity.name = name
  entity.type = bot.registry.entitiesByName[name]!.type as BotInternal['entity']['type']
  entity.position = pos
  bot.entities[id] = entity
  return entity
}

function end (bot: FakeBot) {
  bot.emit('end', 'test')
}

/** the speed (blocks per tick) after walking forward for 40 ticks on flat ground, facing +z */
async function walkingSpeed (bot: FakeBot) {
  teleport(bot, new Vec3(0.5, GROUND, 0.5))
  await ticks(bot, 3)
  bot.entity.yaw = Math.PI // facing +z
  bot.setControlState('forward', true)
  await ticks(bot, 40)
  const start = bot.entity.position.clone()
  await ticks(bot, 1)
  bot.setControlState('forward', false)
  return bot.entity.position.distanceTo(start)
}

describe('physics plugin', function () {
  this.timeout(20000)

  describe('the server\'s movement_speed attribute', () => {
    // How each version names movement_speed in the packet: the key minecraft-protocol decodes it to
    const cases: Array<[string, string, string]> = [
      // version, the attribute's key as decoded, a movement modifier's id
      ['1.12.2', 'generic.movementSpeed', '91aeaa56-376b-4498-935b-2f7f68070635'],
      ['1.16.5', 'minecraft:generic.movement_speed', '91aeaa56-376b-4498-935b-2f7f68070635'],
      ['1.20.4', 'minecraft:generic.movement_speed', '91aeaa56-376b-4498-935b-2f7f68070635'],
      // 1.21.11's mapper is older than its registry: the registry id of movement_speed (22) decodes as generic.scale
      ['1.21.11', 'generic.scale', 'minecraft:effect.speed']
    ]
    for (const [version, key, modifierId] of cases) {
      it(`a Speed II modifier makes the bot walk 40% faster (${version})`, async () => {
        const plain = createFakeBot(version)
        const speed = await walkingSpeed(plain)
        end(plain)
        const fast = createFakeBot(version)
        const property = { key, name: key, value: 0.1, modifiers: [{ uuid: modifierId, amount: 0.4, operation: 2 }] }
        fast._client.emit('entity_update_attributes', { entityId: 1, properties: [property] } as any)
        const fastSpeed = await walkingSpeed(fast)
        end(fast)
        assert.ok(Math.abs(fastSpeed / speed - 1.4) < 0.01, `walked ${fastSpeed} with Speed II, ${speed} without`)
      })
    }
  })

  it('a changed bot.physics.gravity wins over the gravity attribute (creative.startFlying, 1.21.11)', async () => {
    const bot = createFakeBot('1.21.11')
    // 1.21.11's mapper and registry agree on gravity (id 14)
    bot._client.emit('entity_update_attributes', { entityId: 1, properties: [{ key: 'generic.gravity', value: 0.08, modifiers: [] }] } as any)
    bot.physics.gravity = 0
    teleport(bot, new Vec3(0.5, GROUND + 6, 0.5))
    await ticks(bot, 10)
    end(bot)
    assert.strictEqual(bot.entity.position.y, GROUND + 6)
  })

  describe('other entities', () => {
    for (const [version, boat] of [['1.12.2', 'boat'], ['1.20.4', 'boat'], ['1.21.11', 'oak_boat']] as const) {
      it(`walks up onto a boat, which is solid (${version})`, async () => {
        const bot = createFakeBot(version)
        addEntity(bot, 7, boat, new Vec3(0.5, GROUND, 2.5))
        teleport(bot, new Vec3(0.5, GROUND, 0.5))
        await ticks(bot, 3)
        bot.entity.yaw = Math.PI // facing +z
        bot.setControlState('forward', true)
        await ticks(bot, 12)
        bot.setControlState('forward', false)
        await ticks(bot, 3)
        end(bot)
        // the boat is 0.5625 high, under the player's 0.6 step
        assert.ok(Math.abs(bot.entity.position.y - (GROUND + 0.5625)) < 1e-6, `y ${bot.entity.position.y}`)
        assert.ok(bot.entity.position.z > 1.5, `z ${bot.entity.position.z}`)
      })

      it(`a mob it overlaps pushes it away (${version})`, async () => {
        const bot = createFakeBot(version)
        addEntity(bot, 8, 'zombie', new Vec3(0.5, GROUND, 0.8))
        teleport(bot, new Vec3(0.5, GROUND, 0.5))
        await ticks(bot, 10)
        end(bot)
        assert.ok(bot.entity.position.z < 0.4, `z ${bot.entity.position.z}`)
      })
    }
  })

  describe('flying (abilities)', () => {
    for (const version of ['1.12.2', '1.20.4', '1.21.11']) {
      it(`hovers while the server says it flies (${version})`, async () => {
        const bot = createFakeBot(version)
        teleport(bot, new Vec3(0.5, GROUND + 6, 0.5))
        bot._client.emit('abilities', { flags: 2 | 4, flyingSpeed: 0.05, walkingSpeed: 0.1 } as any)
        await ticks(bot, 20)
        end(bot)
        assert.strictEqual(bot.entity.position.y, GROUND + 6)
        assert.strictEqual(bot.entity.flying, true)
      })

      it(`landing ends the flight and tells the server (${version})`, async () => {
        const bot = createFakeBot(version)
        teleport(bot, new Vec3(0.5, GROUND + 0.5, 0.5))
        bot._client.emit('abilities', { flags: 2 | 4, flyingSpeed: 0.05, walkingSpeed: 0.1 } as any)
        bot.setControlState('sneak', true) // flies down
        await ticks(bot, 20)
        end(bot)
        assert.strictEqual(bot.entity.position.y, GROUND)
        assert.strictEqual(bot.entity.flying, false)
        assert.strictEqual(bot.abilities.flying, false)
        const sent = bot.writes.filter(w => w.name === 'abilities').map(w => w.params)
        const expected = version === '1.12.2' ? { flags: 4, flyingSpeed: 0.05, walkingSpeed: 0.1 } : { flags: 0 }
        assert.deepStrictEqual(sent, [expected])
      })
    }
  })
})
