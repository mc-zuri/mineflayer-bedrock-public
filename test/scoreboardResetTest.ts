// Resetting a player's scores, on a fake bot fed scoreboard packets
import EventEmitter from 'events'
import assert from 'assert'
import prismarineRegistry from 'prismarine-registry'
import inject from '../lib/plugins/scoreboard.ts'
import type { BotInternal } from '../lib/types/internal.ts'
import type { ScoreBoard, ScoreBoardItem } from '../lib/types/mineflayer.ts'

describe('scoreboard resets and display slots', () => {
  // 1.20.3 replaced the remove action of scoreboard_score with reset_score
  for (const version of ['1.8.8', '1.12.2', '1.20.2', '1.20.4', '26.1']) {
    const usesResetScore = prismarineRegistry(version).version['>=']('1.20.3')

    function createBot () {
      const bot = new EventEmitter() as unknown as BotInternal
      bot.registry = prismarineRegistry(version) as BotInternal['registry']
      bot.teamMap = {}
      bot._client = new EventEmitter() as unknown as BotInternal['_client']
      inject(bot)
      const client = bot._client as unknown as EventEmitter
      for (const name of ['kills', 'deaths']) {
        client.emit('scoreboard_objective', { name, action: 0, displayText: usesResetScore ? { type: 'string', value: name } : name, type: 'integer' })
        client.emit('scoreboard_score', { itemName: 'alice', scoreName: name, action: usesResetScore ? undefined : 0, value: 1 })
        client.emit('scoreboard_score', { itemName: 'bob', scoreName: name, action: usesResetScore ? undefined : 0, value: 2 })
      }
      return { bot, client }
    }

    function reset (client: EventEmitter, player: string, objective?: string) {
      if (usesResetScore) {
        client.emit('reset_score', { entity_name: player, objective_name: objective })
      } else {
        // an empty objective name means every objective
        client.emit('scoreboard_score', { itemName: player, scoreName: objective ?? '', action: 1 })
      }
    }

    // Only the first objective holding the player used to lose the score.
    it(`${version}: resetting all of a player's scores removes them from every objective`, () => {
      const { bot, client } = createBot()
      const removed: Array<[string, string | undefined]> = []
      bot.on('scoreRemoved', (scoreboard: ScoreBoard, item: ScoreBoardItem | undefined) => { removed.push([scoreboard.name, item?.name]) })
      reset(client, 'alice')
      assert.deepStrictEqual(removed, [['kills', 'alice'], ['deaths', 'alice']])
      assert.deepStrictEqual(Object.keys(bot.scoreboards['kills']!.itemsMap), ['bob'])
      assert.deepStrictEqual(Object.keys(bot.scoreboards['deaths']!.itemsMap), ['bob'])

      reset(client, 'bob', 'deaths')
      assert.deepStrictEqual(Object.keys(bot.scoreboards['kills']!.itemsMap), ['bob'])
      assert.deepStrictEqual(Object.keys(bot.scoreboards['deaths']!.itemsMap), [])
    })
  }
})
