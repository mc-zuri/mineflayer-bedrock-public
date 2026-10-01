import assert from 'assert'
import { onceWithCleanup } from '../../lib/promise_utils.ts'
import type { TestFunction } from './plugins/testCommon.ts'
import type { BotEvents, ScoreBoard } from '../../lib/types/mineflayer.ts'

// Positions of the display slots in scoreboard_display_objective, the same in every version.
const LIST = 0
const SIDEBAR = 1
const BELOW_NAME = 2

export default (): TestFunction => async (bot) => {
  const json = bot.supportFeature('teamUsesChatComponents') // 1.13+: titles and prefixes are text components
  // 1.20.2 renamed the display slot belowName to below_name
  const belowName = bot.registry.version['>=']('1.20.2') ? 'below_name' : 'belowName'

  // Each step arms its wait before sending the commands, and every wait only
  // matches this test's objectives: other tests' leftovers can't satisfy it.
  function waitFor<K extends keyof BotEvents> (event: K, checkCondition: (...args: Parameters<BotEvents[K]>) => boolean) {
    return onceWithCleanup(bot, event, { timeout: 5000, checkCondition: (...args) => checkCondition(...args) })
  }
  const is = (scoreboard: ScoreBoard | undefined, name: string) => scoreboard?.name === name

  // a previous attempt may have left them behind
  for (const name of ['sbA', 'sbB']) bot.chat(`/scoreboard objectives remove ${name}`)
  bot.chat(json ? '/team remove sbteam' : '/scoreboard teams remove sbteam')
  await bot.test.awaitCommandsProcessed('scoreboard-cleanup')
  assert.strictEqual(bot.scoreboards['sbA'], undefined)

  // --- objectives reach the clients only once they are displayed
  // (vanilla's ServerScoreboard tracks only the objectives in a display slot)
  bot.chat(`/scoreboard objectives add sbA dummy ${json ? '{"text":"Title A"}' : 'TitleA'}`)
  bot.chat('/scoreboard objectives add sbB dummy')
  await bot.test.awaitCommandsProcessed('scoreboard-added')
  assert.strictEqual(bot.scoreboards['sbA'], undefined)

  const createdA = waitFor('scoreboardCreated', sb => is(sb, 'sbA'))
  const createdB = waitFor('scoreboardCreated', sb => is(sb, 'sbB'))
  const sidebar = waitFor('scoreboardPosition', (position, sb) => position === SIDEBAR && is(sb, 'sbA'))
  const list = waitFor('scoreboardPosition', (position, sb) => position === LIST && is(sb, 'sbB'))
  const below = waitFor('scoreboardPosition', (position, sb) => position === BELOW_NAME && is(sb, 'sbA'))
  bot.chat('/scoreboard objectives setdisplay sidebar sbA')
  bot.chat('/scoreboard objectives setdisplay list sbB')
  bot.chat(`/scoreboard objectives setdisplay ${belowName} sbA`)
  const [sbA] = await createdA
  const [sbB] = await createdB
  assert.strictEqual(bot.scoreboards['sbA'], sbA)
  assert.strictEqual(bot.scoreboards['sbB'], sbB)
  assert.strictEqual(sbA.title, json ? 'Title A' : 'TitleA')
  // without a display name the server uses the objective's name
  assert.strictEqual(sbB.title, 'sbB')
  assert.strictEqual(sbA.items.length, 0)

  // --- display slots
  await Promise.all([sidebar, list, below])
  assert.strictEqual(bot.scoreboard.sidebar, sbA)
  assert.strictEqual(bot.scoreboard.list, sbB)
  assert.strictEqual(bot.scoreboard.belowName, sbA)
  assert.strictEqual(bot.scoreboard[SIDEBAR], sbA)

  // moving sbB to the sidebar reports the objective it replaces
  const moved = waitFor('scoreboardPosition', (position, sb) => position === SIDEBAR && is(sb, 'sbB'))
  bot.chat('/scoreboard objectives setdisplay sidebar sbB')
  const [, , previous] = await moved
  assert.strictEqual(previous, sbA)
  assert.strictEqual(bot.scoreboard.sidebar, sbB)

  // --- scores, in vanilla sidebar order (highest first)
  // some servers (1.16) first send a new player's score as 0, then the value set
  const scored = waitFor('scoreUpdated', (sb, item) => sb === sbA && item.name === 'carl' && item.value === 1)
  bot.chat('/scoreboard players set alice sbA 5')
  bot.chat('/scoreboard players set bob sbA 10')
  bot.chat('/scoreboard players set carl sbA 1')
  const [, carl] = await scored
  assert.strictEqual(carl.value, 1)
  assert.strictEqual(sbA.itemsMap['carl'], carl)
  assert.deepStrictEqual(sbA.items.map(item => [item.name, item.value]), [['bob', 10], ['alice', 5], ['carl', 1]])

  const added = waitFor('scoreUpdated', (sb, item) => sb === sbA && item.name === 'alice')
  bot.chat('/scoreboard players add alice sbA 10')
  const [, alice] = await added
  assert.strictEqual(alice.value, 15)
  assert.deepStrictEqual(sbA.items.map(item => item.name), ['alice', 'bob', 'carl'])

  // --- an item's displayName carries its team's prefix
  const joined = waitFor('teamMemberAdded', team => team.team === 'sbteam')
  if (json) {
    bot.chat('/team add sbteam')
    bot.chat('/team modify sbteam prefix {"text":"[P] "}')
    bot.chat('/team join sbteam alice')
  } else {
    // before 1.13 the color is the only prefix a command can set
    bot.chat('/scoreboard teams add sbteam')
    bot.chat('/scoreboard teams option sbteam color green')
    bot.chat('/scoreboard teams join sbteam alice')
  }
  await joined
  if (json) {
    assert.strictEqual(sbA.itemsMap['alice']!.displayName.toString(), '[P] alice')
  } else {
    assert.strictEqual(sbA.itemsMap['alice']!.displayName.toString(), 'alice')
    assert(sbA.itemsMap['alice']!.displayName.toMotd().startsWith('§a'), `green prefix expected: ${sbA.itemsMap['alice']!.displayName.toMotd()}`)
  }
  assert.strictEqual(sbA.itemsMap['bob']!.displayName.toString(), 'bob')

  // --- the title can be changed since 1.13
  if (json) {
    const renamed = waitFor('scoreboardTitleChanged', sb => sb === sbA)
    bot.chat('/scoreboard objectives modify sbA displayname {"text":"Renamed"}')
    await renamed
    assert.strictEqual(sbA.title, 'Renamed')
  }

  // --- resetting one objective's score
  const resetCarl = waitFor('scoreRemoved', (sb, item) => sb === sbA && item?.name === 'carl')
  bot.chat('/scoreboard players reset carl sbA')
  await resetCarl
  assert.strictEqual(sbA.itemsMap['carl'], undefined)

  // --- resetting all of a player's scores drops them from every objective
  const scoredB = waitFor('scoreUpdated', (sb, item) => sb === sbB && item.name === 'bob')
  bot.chat('/scoreboard players set bob sbB 3')
  await scoredB
  const removedFromA = waitFor('scoreRemoved', (sb, item) => sb === sbA && item?.name === 'bob')
  const removedFromB = waitFor('scoreRemoved', (sb, item) => sb === sbB && item?.name === 'bob')
  bot.chat('/scoreboard players reset bob')
  await Promise.all([removedFromA, removedFromB])
  assert.strictEqual(sbA.itemsMap['bob'], undefined)
  assert.strictEqual(sbB.itemsMap['bob'], undefined)
  assert.deepStrictEqual(sbA.items.map(item => item.name), ['alice'])

  // --- clearing a display slot (sbB stays in the sidebar, so the server keeps sending it)
  bot.chat('/scoreboard objectives setdisplay list')
  await bot.test.awaitCommandsProcessed('scoreboard-slot-cleared')
  assert.strictEqual(bot.scoreboard.list, undefined)
  assert.strictEqual(bot.scoreboards['sbB'], sbB)

  // --- removing objectives empties their slots
  const deletedA = waitFor('scoreboardDeleted', sb => sb === sbA)
  const deletedB = waitFor('scoreboardDeleted', sb => sb === sbB)
  bot.chat('/scoreboard objectives remove sbA')
  bot.chat('/scoreboard objectives remove sbB')
  await Promise.all([deletedA, deletedB])
  assert.strictEqual(bot.scoreboards['sbA'], undefined)
  assert.strictEqual(bot.scoreboards['sbB'], undefined)
  assert.strictEqual(bot.scoreboard.sidebar, undefined)
  assert.strictEqual(bot.scoreboard.belowName, undefined)
  bot.chat(json ? '/team remove sbteam' : '/scoreboard teams remove sbteam')
  await bot.test.awaitCommandsProcessed('scoreboard-done')
}
