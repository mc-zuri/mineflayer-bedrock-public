// Riding on a real server: mounting, driving (the client moves the boat and the server takes it where the bot
// drove it), minecarts, useOn, dismounting. (The test servers discard animals, spawn-animals=false: horses and pigs
// are covered by test/physicsTest.ts.)
import assert from 'assert'
import { Vec3 } from 'vec3'
import { once, onceWithCleanup } from '../../lib/promise_utils.ts'
import type { Entity } from 'prismarine-entity'
import type { TestBot, TestFunction } from './plugins/testCommon.ts'

/** the entity name minecraft-data gives the version, of the first of the names it knows */
function entityName (bot: TestBot, ...names: string[]): string {
  const name = names.find(name => bot.registry.entitiesByName[name])
  assert.ok(name, `no entity ${names.join(' / ')}`)
  return name
}

/** summons an entity and waits for the bot to see it */
async function summon (bot: TestBot, name: string, at: Vec3, nbt = '') {
  const spawned = onceWithCleanup(bot, 'entitySpawn', { timeout: 10000, checkCondition: (entity: Entity) => entity.name === name && entity.position.distanceTo(at) < 2 })
  bot.chat(`/summon ${name} ${at.x} ${at.y} ${at.z}${nbt ? ' ' + nbt : ''}`)
  const [entity] = await spawned
  return entity
}

async function mount (bot: TestBot, vehicle: Entity) {
  const mounted = onceWithCleanup(bot, 'mount', { timeout: 5000 })
  bot.mount(vehicle)
  await mounted
  assert.strictEqual(bot.vehicle, vehicle)
}

async function dismount (bot: TestBot) {
  const dismounted = onceWithCleanup(bot, 'dismount', { timeout: 5000 })
  bot.dismount()
  await dismounted
  assert.strictEqual(bot.vehicle, null)
}

/** the rider sits on its vehicle */
function assertSeated (bot: TestBot, vehicle: Entity) {
  const pos = bot.entity.position
  const at = vehicle.position
  assert.ok(Math.hypot(pos.x - at.x, pos.z - at.z) < 1 && Math.abs(pos.y - at.y) < 2.5, `the rider is at ${pos}, its vehicle at ${at}`)
}

/** drives forward for some ticks; then the server, which the bot told where the vehicle went, has it there */
async function driveForward (bot: TestBot, vehicle: Entity, ticks: number, minDistance: number) {
  const start = vehicle.position.clone()
  bot.setControlState('forward', true)
  await bot.waitForTicks(ticks)
  bot.setControlState('forward', false)
  await bot.waitForTicks(10)
  assertSeated(bot, vehicle)
  const driven = vehicle.position.clone()
  assert.ok(driven.distanceTo(start) > minDistance, `the vehicle went from ${start} to ${driven}`)
  return driven
}

async function cleanUp (bot: TestBot, vehicle: Entity) {
  bot.clearControlStates()
  bot.moveVehicle(0, 0)
  if (bot.vehicle) await dismount(bot)
  if (vehicle.isValid) await bot.test.killEntity(vehicle)
}

export default (): Record<string, TestFunction> => ({
  async boat (bot) {
    const ground = bot.test.groundY
    // a pool one block deep north of the origin, the boat on it facing south (+z)
    bot.chat(`/fill -3 ${ground - 1} 2 3 ${ground - 1} 30 water`)
    await bot.test.awaitCommandsProcessed('pool-filled')
    const boat = await summon(bot, entityName(bot, 'oak_boat', 'boat', 'Boat'), new Vec3(0.5, ground - 0.5, 3.5))
    try {
      await bot.waitForTicks(10) // it floats
      await mount(bot, boat)
      // looking south too (before 1.9 the server paddles the boat where its rider looks)
      await bot.look(Math.PI, 0, true)
      await bot.waitForTicks(2)
      assertSeated(bot, boat)
      const driven = await driveForward(bot, boat, 30, 2)
      // moveVehicle holds the keys too
      bot.moveVehicle(0, 1)
      await bot.waitForTicks(15)
      bot.moveVehicle(0, 0)
      await bot.waitForTicks(10)
      assert.ok(boat.position.z > driven.z + 0.5, `moveVehicle left the boat at ${boat.position}`)
      const end = boat.position.clone()
      await dismount(bot)
      if (bot.registry.version['>=']('1.9')) {
        // the server took the boat where the bot drove it (it stops by itself in the water)
        await bot.waitForTicks(20)
        assert.ok(boat.position.distanceTo(end) < 1, `the server has the boat at ${boat.position}, the bot left it at ${end}`)
      }
    } finally {
      await cleanUp(bot, boat)
    }
  },

  async minecart (bot) {
    const ground = bot.test.groundY
    const cart = await summon(bot, entityName(bot, 'minecart', 'MinecartRideable'), new Vec3(2.5, ground, 0.5))
    try {
      await mount(bot, cart)
      await bot.waitForTicks(5)
      assertSeated(bot, cart)
      // the bot looks around while sitting
      await bot.look(Math.PI / 2, 0)
      assertSeated(bot, cart)
      await dismount(bot)
    } finally {
      await cleanUp(bot, cart)
    }
  },

  async useOn (bot) {
    // using (right-clicking) a boat gets into it, like mount
    const ground = bot.test.groundY
    const boat = await summon(bot, entityName(bot, 'oak_boat', 'boat', 'Boat'), new Vec3(2.5, ground, 0.5))
    try {
      const mounted = onceWithCleanup(bot, 'mount', { timeout: 5000 })
      bot.useOn(boat)
      await mounted
      assert.strictEqual(bot.vehicle, boat)
      await bot.waitForTicks(2)
      assertSeated(bot, boat)
      await dismount(bot)
    } finally {
      await cleanUp(bot, boat)
    }
  },

  async dismountNotMounted (bot) {
    assert.strictEqual(bot.vehicle, null)
    const error = once(bot, 'error')
    bot.dismount()
    const [err] = await error
    assert.strictEqual((err as Error).message, 'dismount: not mounted')
  }
})
