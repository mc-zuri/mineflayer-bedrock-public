import assert from 'assert'
import mineflayer from 'mineflayer'
import { Vec3 } from 'vec3'
import { once, onceWithCleanup } from '../../lib/promise_utils.ts'
import type { Bot } from '../../lib/types/mineflayer.ts'
import type { Entity } from 'prismarine-entity'
import type { TestFunction } from './plugins/testCommon.ts'

const OTHER = 'observed'
// The second bot of the attempt in progress: a retry (or a test mocha gave up on) must not leave it connected.
let other: Bot | null = null

// What the test bot sees of another player: it sneaks, swings, digs a block and sleeps in a bed.
export default (): TestFunction => async (bot) => {
  if (other) {
    other.end()
    other = null
  }
  await bot.waitForChunksToLoad()
  const ground = bot.test.groundY
  const isOther = (entity: Entity) => entity.username === OTHER

  const joined = onceWithCleanup(bot, 'playerJoined', { timeout: 20000, checkCondition: (player) => player.username === OTHER })
  const spawned = onceWithCleanup(bot, 'entitySpawn', { timeout: 60000, checkCondition: isOther })
  other = mineflayer.createBot({
    username: OTHER,
    viewDistance: 'tiny',
    port: bot.test.port!,
    host: '127.0.0.1',
    version: bot.version
  })
  const otherBot = other
  let passed = false
  try {
    await once(otherBot, 'spawn')
    await joined
    // 1.8 servers decide whether to track a teleported player before its chunk position is updated (that
    // waits for the client's confirmation), so they may never spawn it after a far teleport: teleport it
    // again within the chunk, once the client confirmed, until the test bot sees it
    const otherAt = new Vec3(3.5, ground, 0.5)
    let seen = false
    spawned.then(() => { seen = true }, () => {})
    for (let attempt = 0; ; attempt++) {
      if (seen) break
      if (attempt === 6) throw new Error(`the test bot never saw ${OTHER} spawn`)
      const target = attempt % 2 === 0 ? otherAt.offset(8, 0, 0) : otherAt
      const arrived = onceWithCleanup(otherBot, 'move', { timeout: 5000, checkCondition: () => otherBot.entity.position.distanceTo(target) < 0.1 })
      bot.chat(`/tp ${OTHER} ${target.x} ${target.y} ${target.z}`)
      await arrived
      await otherBot.waitForTicks(4) // the client's position confirmation reaches the server
      if (attempt % 2 === 1) await Promise.race([spawned, bot.waitForTicks(20)])
    }
    await spawned
    // the last teleport may have gone to the far spot
    if (otherBot.entity.position.distanceTo(otherAt) > 0.1) {
      const arrived = onceWithCleanup(otherBot, 'move', { timeout: 5000, checkCondition: () => otherBot.entity.position.distanceTo(otherAt) < 0.1 })
      bot.chat(`/tp ${OTHER} ${otherAt.x} ${otherAt.y} ${otherAt.z}`)
      await arrived
    }
    const otherEntity = () => bot.players[OTHER]!.entity!
    while (otherEntity().position.distanceTo(otherAt) > 0.1) {
      await onceWithCleanup(bot, 'entityMoved', { timeout: 5000, checkCondition: isOther })
    }

    // sneaking
    const crouch = onceWithCleanup(bot, 'entityCrouch', { timeout: 5000, checkCondition: isOther })
    otherBot.setControlState('sneak', true)
    await crouch
    assert.ok(otherEntity().crouching)
    const uncrouch = onceWithCleanup(bot, 'entityUncrouch', { timeout: 5000, checkCondition: isOther })
    otherBot.setControlState('sneak', false)
    await uncrouch
    assert.ok(!otherEntity().crouching)

    // arm swing
    const swing = onceWithCleanup(bot, 'entitySwingArm', { timeout: 5000, checkCondition: isOther })
    otherBot.swingArm('right')
    await swing

    // digging: the break stages are only sent for a survival player's slow dig. The world spawn can be
    // next to the origin, where spawn protection stops a player that is not an operator from digging.
    bot.chat(`/op ${OTHER}`)
    const gameModeSet = onceWithCleanup(otherBot, 'game', { timeout: 5000, checkCondition: () => otherBot.game.gameMode === 'survival' })
    bot.chat(`/gamemode ${bot.registry.isNewerOrEqualTo('1.13') ? 'survival' : '0'} ${OTHER}`)
    await gameModeSet
    const digPos = new Vec3(4, ground, 2)
    const otherSawDirt = onceWithCleanup(otherBot.world, `blockUpdate:${digPos}`, { timeout: 5000, checkCondition: (_old, block) => block?.name === 'dirt' })
    await bot.test.setBlock({ ...digPos, blockName: 'dirt' })
    if (otherBot.blockAt(digPos)?.name !== 'dirt') await otherSawDirt
    else otherSawDirt.catch(() => {})
    const stages: number[] = []
    const onProgress = (block: { position: Vec3 } | null, stage: number, entity: Entity | undefined) => {
      if (block?.position.equals(digPos) && entity && isOther(entity)) stages.push(stage)
    }
    bot.on('blockBreakProgressObserved', onProgress)
    const progressEnd = onceWithCleanup(bot, 'blockBreakProgressEnd', {
      timeout: 10000,
      checkCondition: (block, entity) => block?.position.equals(digPos) === true && entity !== undefined && isOther(entity)
    })
    try {
      await otherBot.dig(otherBot.blockAt(digPos)!)
      await progressEnd
    } finally {
      bot.off('blockBreakProgressObserved', onProgress)
    }
    assert.ok(stages.length > 0, 'no break progress was observed')
    assert.ok(stages.every(stage => stage >= 0 && stage <= 9), `stages out of range: ${stages}`)

    // sleeping: the test bot cannot use the bed the other bot is in
    const bedItem = bot.registry.itemsArray.find(item => item.name.endsWith('bed'))!
    const foot = new Vec3(3, ground, 2)
    const head = foot.offset(0, 0, 1)
    const bedPlaced = [foot, head].map(pos => onceWithCleanup(bot.world, `blockUpdate:(${pos.x}, ${pos.y}, ${pos.z})`, { timeout: 5000 }))
    if (bot.supportFeature('setBlockUsesMetadataNumber')) {
      bot.chat(`/setblock ${foot.toArray().join(' ')} ${bedItem.name} 0`)
      bot.chat(`/setblock ${head.toArray().join(' ')} ${bedItem.name} 8`)
    } else {
      bot.chat(`/setblock ${foot.toArray().join(' ')} ${bedItem.name}[part=foot,facing=south]`)
      bot.chat(`/setblock ${head.toArray().join(' ')} ${bedItem.name}[part=head,facing=south]`)
    }
    bot.chat('/time set 18000')
    await Promise.all([
      ...bedPlaced,
      onceWithCleanup(bot, 'time', { timeout: 5000, checkCondition: () => bot.time.timeOfDay! >= 18000 }),
      onceWithCleanup(otherBot, 'time', { timeout: 5000, checkCondition: () => otherBot.time.timeOfDay! >= 18000 })
    ])
    while (![foot, head].every(pos => otherBot.blockAt(pos)?.name.endsWith('bed'))) {
      await onceWithCleanup(otherBot.world, 'blockUpdate', { timeout: 5000 })
    }
    const sawSleep = onceWithCleanup(bot, 'entitySleep', { timeout: 5000, checkCondition: isOther })
    // Before 1.14 the server marks the bed occupied without telling the clients (the bed state is set
    // with flag 4, no block update; 1.13.2 sends none either), so only 1.14+ clients can know the bed is taken.
    const occupiedVisible = bot.registry.version['>=']('1.14')
    const occupied = occupiedVisible
      ? onceWithCleanup(bot.world, `blockUpdate:${head}`, { timeout: 5000, checkCondition: (_old, block) => block !== null && bot.parseBedMetadata(block).occupied === true })
      : Promise.resolve()
    await otherBot.sleep(otherBot.blockAt(foot)!)
    await Promise.all([sawSleep, occupied])
    if (occupiedVisible) await assert.rejects(bot.sleep(bot.blockAt(head)!), /the bed is occupied/)
    const otherWoke = once(otherBot, 'wake')
    await otherBot.wake()
    await otherWoke
    bot.chat('/time set 1000')
    passed = true
  } finally {
    // leaving: the player and its entity go away
    const gone = onceWithCleanup(bot, 'entityGone', { timeout: 10000, checkCondition: isOther })
    const left = onceWithCleanup(bot, 'playerLeft', { timeout: 10000, checkCondition: (player) => player.username === OTHER })
    bot.chat(`/deop ${OTHER}`)
    otherBot.end()
    if (other === otherBot) other = null
    if (passed) {
      await Promise.all([gone, left])
      assert.strictEqual(bot.players[OTHER], undefined)
    } else {
      gone.catch(() => {})
      left.catch(() => {})
    }
  }
}
