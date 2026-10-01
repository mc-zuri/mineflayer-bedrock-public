import scoreboardModule from '../scoreboard.ts'
import type { ScoreBoard as ScoreBoardInstance } from '../types/mineflayer.ts'
import type { BotInternal } from '../types/internal.ts'

export default inject

function inject (bot: BotInternal): void {
  const ScoreBoard = scoreboardModule(bot)
  const scoreboards: { [name: string]: ScoreBoardInstance } = {}

  bot._client.on('scoreboard_objective', (packet) => {
    if (packet.action === 0) {
      const { name } = packet
      const scoreboard = new ScoreBoard(packet)
      scoreboards[name] = scoreboard

      bot.emit('scoreboardCreated', scoreboard)
    }

    if (packet.action === 1) {
      if (!Object.hasOwn(scoreboards, packet.name)) return // nothing to remove
      bot.emit('scoreboardDeleted', scoreboards[packet.name]!)
      delete scoreboards[packet.name]

      for (const position in ScoreBoard.positions) {
        if (!ScoreBoard.positions[position as unknown as number]) continue
        const scoreboard = ScoreBoard.positions[position as unknown as number]

        if (scoreboard && scoreboard.name === packet.name) {
          delete ScoreBoard.positions[position as unknown as number]
          break
        }
      }
    }

    if (packet.action === 2) {
      if (!Object.hasOwn(scoreboards, packet.name)) {
        bot.emit('error', new Error(`Received update for unknown objective ${packet.name}`))
        return
      }
      scoreboards[packet.name]!.setTitle(packet.displayText)
      bot.emit('scoreboardTitleChanged', scoreboards[packet.name]!)
    }
  })

  function removeScore (itemName: string, scoreboard: ScoreBoardInstance | undefined) {
    if (scoreboard !== undefined) {
      const removed = scoreboard.remove(itemName)
      return bot.emit('scoreRemoved', scoreboard, removed)
    }

    // no objective: the server reset the player's scores in every objective
    for (const sb of Object.values(scoreboards)) {
      if (itemName in sb.itemsMap) {
        const removed = sb.remove(itemName)
        bot.emit('scoreRemoved', sb, removed)
      }
    }
    return undefined
  }

  bot._client.on('scoreboard_score', (packet) => {
    const scoreboard = scoreboards[packet.scoreName]
    // 1.20.3+ has no action: every scoreboard_score is an update, removals are reset_score
    if (scoreboard !== undefined && (packet.action === 0 || packet.action === undefined)) {
      const updated = scoreboard.add(packet.itemName, packet.value!)
      bot.emit('scoreUpdated', scoreboard, updated)
    }

    if (packet.action === 1) {
      removeScore(packet.itemName, scoreboard)
    }
  })

  bot._client.on('reset_score', (packet) => {
    if (packet.objective_name === undefined) return removeScore(packet.entity_name, undefined)
    const scoreboard = scoreboards[packet.objective_name]
    if (scoreboard !== undefined) removeScore(packet.entity_name, scoreboard)
    return undefined
  })

  bot._client.on('scoreboard_display_objective', (packet) => {
    const { name, position } = packet
    const scoreboard = scoreboards[name]

    if (scoreboard !== undefined) {
      bot.emit('scoreboardPosition', position, scoreboard, ScoreBoard.positions[position])
      ScoreBoard.positions[position] = scoreboard
    }
  })

  bot.scoreboards = scoreboards
  bot.scoreboard = ScoreBoard.positions

  // No objective or display slot survives a login; the dropped objectives emit no scoreboardDeleted and the objects stay the same.
  bot._client.on('login', () => {
    for (const name of Object.keys(scoreboards)) delete scoreboards[name]
    for (const position of Object.keys(ScoreBoard.positions)) {
      // The named slots are accessors over the numeric slots and must stay.
      if (Object.getOwnPropertyDescriptor(ScoreBoard.positions, position)!.get) continue
      delete ScoreBoard.positions[position as unknown as number]
    }
  })
}
