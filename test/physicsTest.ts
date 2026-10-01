// The physics plugin on a fake bot: the real entities and physics plugins, a fake client that records
// what the bot writes, and a flat world (stone below y = 64). Ticks run on the plugin's own timer.
import EventEmitter from 'events'
import assert from 'assert'
import prismarineRegistry from 'prismarine-registry'
import prismarineBlock from 'prismarine-block'
import prismarineEntity from 'prismarine-entity'
import prismarineItem from 'prismarine-item'
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
  entity.height = bot.registry.entitiesByName[name]!.height!
  entity.width = bot.registry.entitiesByName[name]!.width!
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

  describe('the keys the server hears', () => {
    const actions = (bot: FakeBot) => bot.writes.filter(w => w.name === 'entity_action').map(w => w.params.actionId)
    for (const version of ['1.8.8', '1.12.2', '1.20.4', '1.21.11']) {
      it(`start / stop sprinting follow the bot's sprint, not the key (${version})`, async () => {
        const bot = createFakeBot(version)
        teleport(bot, new Vec3(0.5, GROUND, 0.5))
        await ticks(bot, 2)
        const [start, stop] = bot.supportFeature('entityActionUsesStringMapper') ? ['start_sprinting', 'stop_sprinting'] : [3, 4]
        bot.setControlState('sprint', true)
        await ticks(bot, 3)
        assert.deepStrictEqual(actions(bot), [], 'no sprint without moving forward')
        bot.setControlState('forward', true)
        await ticks(bot, 3)
        assert.ok(bot.entity.sprinting)
        assert.deepStrictEqual(actions(bot), [start])
        bot.setControlState('forward', false)
        await ticks(bot, 3)
        assert.deepStrictEqual(actions(bot), [start, stop])
        bot.clearControlStates()
        await ticks(bot, 2)
        end(bot)
        assert.deepStrictEqual(actions(bot), [start, stop])
      })
    }

    for (const version of ['1.8.8', '1.20.4']) {
      it(`sneaking is start / stop sneaking before player_input (${version})`, async () => {
        const bot = createFakeBot(version)
        teleport(bot, new Vec3(0.5, GROUND, 0.5))
        await ticks(bot, 2)
        bot.setControlState('sneak', true)
        await ticks(bot, 2)
        bot.setControlState('sneak', false)
        await ticks(bot, 2)
        end(bot)
        assert.deepStrictEqual(actions(bot), [0, 1])
        assert.ok(!bot.writes.some(w => w.name === 'player_input'))
      })
    }

    for (const version of ['1.21.4', '1.21.11']) {
      it(`player_input carries every key, once per change (${version})`, async () => {
        const bot = createFakeBot(version)
        teleport(bot, new Vec3(0.5, GROUND, 0.5))
        await ticks(bot, 2)
        bot.setControlState('forward', true)
        bot.setControlState('sneak', true)
        await ticks(bot, 3)
        bot.setControlState('sneak', false)
        await ticks(bot, 2)
        bot.clearControlStates()
        await ticks(bot, 2)
        end(bot)
        const none = { forward: false, backward: false, left: false, right: false, jump: false, shift: false, sprint: false }
        assert.deepStrictEqual(bot.writes.filter(w => w.name === 'player_input').map(w => w.params.inputs), [
          { ...none, forward: true, shift: true },
          { ...none, forward: true },
          none
        ])
        // the shift key is no entity_action any more
        assert.ok(!bot.writes.some(w => w.name === 'entity_action' && (w.params.actionId === 0 || w.params.actionId === 1)))
      })
    }
  })

  describe('riding', () => {
    const versions: Array<[string, string]> = [['1.12.2', 'boat'], ['1.20.4', 'boat'], ['1.21.11', 'oak_boat']]
    /** the bot mounted on a vehicle the test adds at pos */
    async function mounted (version: string, name: string, pos: Vec3) {
      const bot = createFakeBot(version)
      teleport(bot, pos.offset(2, 0, 0))
      await ticks(bot, 2)
      const vehicle = addEntity(bot, 7, name, pos)
      vehicle.yaw = Math.PI // facing +z
      bot._client.emit('set_passengers', { entityId: 7, passengers: [1] } as any)
      assert.strictEqual(bot.vehicle, vehicle)
      bot.entity.yaw = Math.PI
      return { bot, vehicle }
    }

    for (const [version, boat] of versions) {
      it(`drives a boat with the keys and tells the server where it went (${version})`, async () => {
        const { bot, vehicle } = await mounted(version, boat, new Vec3(0.5, GROUND, 0.5))
        bot.writes.length = 0
        bot.setControlState('forward', true)
        await ticks(bot, 20)
        end(bot)
        assert.ok(vehicle.position.z > 0.6, `the boat moved to ${vehicle.position}`)
        // the rider sits in the boat
        assert.ok(Math.abs(bot.entity.position.x - vehicle.position.x) < 1e-9 && Math.abs(bot.entity.position.z - vehicle.position.z) < 1e-9)
        assert.ok(bot.entity.position.y < vehicle.position.y + 0.6 && bot.entity.position.y > vehicle.position.y - 0.6)
        const moves = bot.writes.filter(w => w.name === 'vehicle_move')
        assert.ok(moves.length >= 20)
        assert.strictEqual(moves[moves.length - 1]!.params.z, vehicle.position.z)
        const paddles = bot.writes.filter(w => w.name === 'steer_boat').map(w => w.params)
        assert.deepStrictEqual(paddles[0], { leftPaddle: false, rightPaddle: false }) // the keys of the tick before
        assert.deepStrictEqual(paddles[19], { leftPaddle: true, rightPaddle: true })
        // no walking packets while riding
        assert.ok(!bot.writes.some(w => w.name === 'position' || w.name === 'position_look'))
        if (bot.supportFeature('newPlayerInputPacket')) {
          assert.ok(bot.writes.some(w => w.name === 'player_input' && w.params.inputs.forward))
        } else {
          const steer = bot.writes.filter(w => w.name === 'steer_vehicle')
          assert.strictEqual(steer.length, moves.length)
          assert.deepStrictEqual(steer[steer.length - 1]!.params, { sideways: 0, forward: Math.fround(0.98), jump: 0 })
        }
      })

      it(`moveVehicle holds the vehicle's keys until changed (${version})`, async () => {
        const { bot, vehicle } = await mounted(version, boat, new Vec3(0.5, GROUND, 0.5))
        bot.moveVehicle(0, 1)
        await ticks(bot, 15)
        const moved = vehicle.position.z
        assert.ok(moved > 0.6, `the boat moved to ${vehicle.position}`)
        bot.moveVehicle(0, 0)
        await ticks(bot, 40)
        const stopped = vehicle.position.z
        await ticks(bot, 5)
        end(bot)
        assert.ok(Math.abs(vehicle.position.z - stopped) < 1e-3, 'released, the boat stops')
      })
    }

    for (const version of ['1.12.2', '1.20.4', '1.21.11']) {
      it(`a saddled horse moves on the keys and jumps when the charged jump is let go (${version})`, async () => {
        const { bot, vehicle } = await mounted(version, 'horse', new Vec3(0.5, GROUND, 0.5))
        const keys = bot.registry.entitiesByName['horse']!.metadataKeys
        if (keys) (vehicle.metadata as unknown[])[keys.indexOf('flags')] = 2 | 4 // tame, saddled
        bot.setControlState('forward', true)
        await ticks(bot, 20)
        assert.ok(vehicle.position.z > 2, `the horse moved to ${vehicle.position}`)
        assert.ok(bot.writes.some(w => w.name === 'vehicle_move'))
        bot.setControlState('jump', true)
        await ticks(bot, 5)
        bot.setControlState('jump', false)
        await ticks(bot, 3)
        end(bot)
        const jumps = bot.writes.filter(w => w.name === 'entity_action' && (w.params.actionId === 5 || w.params.actionId === 'start_horse_jump'))
        assert.strictEqual(jumps.length, 1)
        assert.ok(jumps[0]!.params.jumpBoost > 0)
      })
    }

    it('an unsaddled horse is not driven: the rider sits on it (1.20.4)', async () => {
      const { bot, vehicle } = await mounted('1.20.4', 'horse', new Vec3(0.5, GROUND, 0.5))
      const metadata = vehicle.metadata as unknown[]
      metadata[bot.registry.entitiesByName['horse']!.metadataKeys!.indexOf('flags')] = 2 // tame only
      bot.setControlState('forward', true)
      await ticks(bot, 10)
      end(bot)
      assert.deepStrictEqual(vehicle.position, new Vec3(0.5, GROUND, 0.5))
      assert.ok(!bot.writes.some(w => w.name === 'vehicle_move'))
      assert.strictEqual(bot.entity.position.x, 0.5)
      assert.ok(bot.entity.position.y > GROUND + 0.5)
    })

    it('a pig is driven only with a carrot on a stick in hand (1.20.4)', async () => {
      const { bot, vehicle } = await mounted('1.20.4', 'pig', new Vec3(0.5, GROUND, 0.5))
      await ticks(bot, 10)
      assert.deepStrictEqual(vehicle.position, new Vec3(0.5, GROUND, 0.5))
      bot.heldItem = { name: 'carrot_on_a_stick' } as BotInternal['heldItem']
      await ticks(bot, 20)
      end(bot)
      // the steered pig always goes forward, where the rider looks
      assert.ok(vehicle.position.z > 1, `the pig moved to ${vehicle.position}`)
    })

    it('the rider follows a minecart the server moves (1.21.11)', async () => {
      const { bot, vehicle } = await mounted('1.21.11', 'minecart', new Vec3(0.5, GROUND, 0.5))
      bot.writes.length = 0
      await ticks(bot, 2)
      vehicle.position = new Vec3(0.5, GROUND, 3.5)
      await ticks(bot, 2)
      end(bot)
      assert.strictEqual(bot.entity.position.z, 3.5)
      assert.ok(Math.abs(bot.entity.position.y - (GROUND + 0.1875 - 0.6)) < 1e-6, `y ${bot.entity.position.y}`)
      assert.ok(!bot.writes.some(w => w.name === 'vehicle_move'), 'the server drives a minecart')
      assert.ok(bot.writes.some(w => w.name === 'look'))
    })

    it('dismounting stops riding: the bot walks again (1.20.4)', async () => {
      const { bot } = await mounted('1.20.4', 'boat', new Vec3(0.5, GROUND, 0.5))
      await ticks(bot, 3)
      bot._client.emit('set_passengers', { entityId: 7, passengers: [] } as any)
      assert.strictEqual(bot.vehicle, null)
      teleport(bot, new Vec3(3.5, GROUND, 0.5))
      bot.writes.length = 0
      bot.setControlState('forward', true)
      await ticks(bot, 5)
      end(bot)
      assert.ok(bot.writes.some(w => w.name === 'position' || w.name === 'position_look'))
      assert.ok(!bot.writes.some(w => w.name === 'vehicle_move'))
    })

    for (const version of ['1.20.4', '1.21.4', '1.21.11']) {
      it(`dismount presses the sneak key, not jump (${version})`, async () => {
        const { bot } = await mounted(version, version === '1.20.4' ? 'boat' : 'oak_boat', new Vec3(0.5, GROUND, 0.5))
        await ticks(bot, 2)
        bot.writes.length = 0
        bot.dismount()
        await ticks(bot, 2)
        end(bot)
        if (bot.supportFeature('newPlayerInputPacket')) {
          const none = { forward: false, backward: false, left: false, right: false, jump: false, shift: false, sprint: false }
          assert.deepStrictEqual(bot.writes.filter(w => w.name === 'player_input').map(w => w.params.inputs), [{ ...none, shift: true }, none])
        } else {
          assert.deepStrictEqual(bot.writes[0], { name: 'steer_vehicle', params: { sideways: 0, forward: 0, jump: 2 } })
        }
      })
    }

    it('dismount without a vehicle emits an error', () => {
      const bot = createFakeBot('1.20.4')
      let error: Error | undefined
      bot.on('error', (err) => { error = err })
      bot.dismount()
      end(bot)
      assert.strictEqual(error?.message, 'dismount: not mounted')
    })
  })

  describe('auto-jump', () => {
    for (const version of ['1.12.2', '1.20.4', '1.21.11']) {
      for (const autoJump of [false, true]) {
        it(`${autoJump ? 'jumps' : 'does not jump'} a one block step with autoJump ${autoJump} (${version})`, async () => {
          const bot = createFakeBot(version, { autoJump })
          for (let x = -2; x <= 2; x++) for (let z = 3; z <= 12; z++) bot.blocks.set(`${x},${GROUND},${z}`, 'stone')
          teleport(bot, new Vec3(0.5, GROUND, 0.5))
          await ticks(bot, 3)
          bot.entity.yaw = Math.PI // facing +z
          bot.setControlState('forward', true)
          await ticks(bot, 30)
          end(bot)
          assert.strictEqual(bot.autoJump, autoJump)
          if (autoJump) assert.strictEqual(bot.entity.position.y, GROUND + 1, 'on the step')
          else assert.strictEqual(bot.entity.position.y, GROUND, 'against the step')
        })
      }
    }
  })

  describe('gliding', () => {
    const elytra = (bot: FakeBot) => {
      const Item = prismarineItem(bot.registry)
      bot.inventory.slots[6] = new Item(bot.registry.itemsByName['elytra']!.id, 1)
    }
    for (const version of ['1.12.2', '1.20.4', '1.21.11']) {
      it(`pressing jump while falling with an elytra starts gliding (${version})`, async () => {
        const bot = createFakeBot(version)
        elytra(bot)
        teleport(bot, new Vec3(0.5, GROUND + 30, 0.5))
        await ticks(bot, 5)
        bot.setControlState('jump', true)
        await ticks(bot, 2)
        end(bot)
        const glide = bot.writes.filter(w => w.name === 'entity_action' && (w.params.actionId === 8 || w.params.actionId === 'start_elytra_flying'))
        assert.strictEqual(glide.length, 1)
        // since 1.15 the client starts gliding itself, before it waits for the server
        assert.strictEqual(!!bot.entity.elytraFlying, version !== '1.12.2')
      })

      it(`an attached firework rocket boosts the glide until it explodes (${version})`, async () => {
        const bot = createFakeBot(version)
        elytra(bot)
        teleport(bot, new Vec3(0.5, GROUND + 60, 0.5))
        await ticks(bot, 3)
        bot.entity.elytraFlying = true
        bot.entity.yaw = Math.PI // facing +z, level
        bot.entity.pitch = 0
        const rocket = addEntity(bot, 9, bot.registry.entitiesByName['firework_rocket'] ? 'firework_rocket' : 'fireworks_rocket', bot.entity.position.clone())
        bot._fireworkRockets.add(rocket.id)
        bot.fireworkRocketDuration = 2 // shorter than the rocket's flight
        await ticks(bot, 10)
        assert.ok(bot.entity.velocity.z > 1, `boosted to ${bot.entity.velocity}`)
        // the server removes the rocket: no more boost
        bot._client.emit('entity_destroy', { entityIds: [rocket.id] } as any)
        assert.strictEqual(bot.fireworkRocketDuration, 0)
        const before = bot.entity.velocity.z
        await ticks(bot, 3)
        end(bot)
        assert.ok(bot.entity.velocity.z < before, 'the glide slows down')
      })
    }
  })

  for (const version of ['1.16.5', '1.20.4', '1.21.11']) {
    it(`a Riptide trident let go after 10 ticks of use launches the bot in water (${version})`, async () => {
      const bot = createFakeBot(version)
      for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) for (let y = GROUND; y < GROUND + 3; y++) bot.blocks.set(`${x},${y},${z}`, 'water')
      teleport(bot, new Vec3(0.5, GROUND, 0.5))
      await ticks(bot, 3)
      const Item = prismarineItem(bot.registry)
      const trident = new Item(bot.registry.itemsByName['trident']!.id, 1)
      trident.enchants = [{ name: 'riptide', lvl: 3 }]
      bot.heldItem = trident
      bot.entity.yaw = Math.PI // facing +z
      bot.entity.pitch = 0
      bot.usingHeldItem = true
      await ticks(bot, 12)
      assert.ok(bot.entity.velocity.z < 0.2)
      bot.usingHeldItem = false
      await ticks(bot, 1)
      end(bot)
      // 3 * (1 + 3) / 4 = 3 blocks a tick along the look, less the water's drag
      assert.ok(bot.entity.velocity.z > 1.5, `launched at ${bot.entity.velocity}`)
    })
  }

  it('a piston head pushes the bot (1.20.4)', async () => {
    const bot = createFakeBot('1.20.4')
    teleport(bot, new Vec3(0.5, GROUND, 1.75))
    await ticks(bot, 3)
    // a piston at z = 3 extends north into the cell z = 2, which the bot's box reaches into
    bot.emit('pistonMove', { position: new Vec3(0, GROUND, 3) } as Block, 0, 2)
    await ticks(bot, 3)
    end(bot)
    assert.ok(bot.entity.position.z < 1.7, `pushed to ${bot.entity.position.z}`)
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
