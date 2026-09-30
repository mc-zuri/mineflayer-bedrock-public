import teamModule from '../team.ts'
import type { Team as TeamInstance } from '../types/mineflayer.ts'
import type { BotInternal } from '../types/internal.ts'
import type { ClientboundPackets } from '../types/protocol.ts'

export default inject

// TODO: apply this to all versions and rename scoreboard_team -> teams in minecraft-data
const TEAM_MODES = ['add', 'remove', 'change', 'join', 'leave']

function inject (bot: BotInternal): void {
  const Team = teamModule(bot.registry)
  const teams: { [name: string]: TeamInstance } = {}

  // scoreboard_team (1.8) carries a subset of the teams fields
  function teamHandler (packet: ClientboundPackets['teams']) {
    const { team: teamName, players = [] } = packet
    const mode = typeof packet.mode === 'number' ? TEAM_MODES[packet.mode] : packet.mode

    let team = teams[teamName]

    switch (mode) {
      case 'add':
        team = new Team(
          teamName,
          packet.name!,
          packet.friendlyFire as number,
          packet.nameTagVisibility as string,
          packet.collisionRule as string,
          packet.formatting,
          packet.prefix!,
          packet.suffix!
        )
        for (const player of players) {
          team.add(player)
          bot.teamMap[player] = team
        }
        teams[teamName] = team
        bot.emit('teamCreated', teams[teamName])
        break

      case 'remove':
        if (!team) break
        team.members.forEach((member) => {
          delete bot.teamMap[member]
        })
        delete teams[teamName]
        bot.emit('teamRemoved', teams[teamName])
        break

      case 'change':
        if (!team) break
        team.update(
          packet.name!,
          packet.friendlyFire as number,
          packet.nameTagVisibility as string,
          packet.collisionRule as string,
          packet.formatting,
          packet.prefix!,
          packet.suffix!
        )
        bot.emit('teamUpdated', teams[teamName])
        break

      case 'join':
        if (!team) break
        for (const player of players) {
          team.add(player)
          bot.teamMap[player] = team
        }
        bot.emit('teamMemberAdded', teams[teamName])
        break

      case 'leave':
        if (!team) break
        for (const player of players) {
          team.remove(player)
          delete bot.teamMap[player]
        }
        bot.emit('teamMemberRemoved', teams[teamName])
        break

      default:
        bot._warn(`Unknown team mode handling team update: ${mode}`)
    }
  }

  if (bot.supportFeature('teamUsesScoreboard')) {
    bot._client.on('scoreboard_team', teamHandler)
  } else {
    bot._client.on('teams', teamHandler)
  }

  bot.teams = teams
  bot.teamMap = {}

  // No team survives a login; the dropped teams emit no teamRemoved and the objects stay the same.
  bot._client.on('login', () => {
    for (const teamName of Object.keys(teams)) delete teams[teamName]
    for (const member of Object.keys(bot.teamMap)) delete bot.teamMap[member]
  })
}
