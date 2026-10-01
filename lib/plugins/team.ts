import teamModule from '../team.ts'
import type { Team as TeamInstance } from '../types/mineflayer.ts'
import type { BotInternal } from '../types/internal.ts'
import type { ClientboundPackets } from '../types/protocol.ts'

export default inject

// TODO: apply this to all versions and rename scoreboard_team -> teams in minecraft-data
const TEAM_MODES = ['add', 'remove', 'change', 'join', 'leave']
// 1.21.5 sends the rules as ids, 1.21.6+ as these names
const NAME_TAG_VISIBILITIES = ['always', 'never', 'hide_for_other_teams', 'hide_for_own_team']
const COLLISION_RULES = ['always', 'never', 'push_other_teams', 'push_own_team']

// 1.21.6+ replaces the friendlyFire byte with bit flags
function friendlyFireOf (packet: ClientboundPackets['teams']): number {
  if (packet.friendlyFire !== undefined) return packet.friendlyFire
  return (packet.flags?.friendly_fire ? 0x1 : 0) | (packet.flags?.see_friendly_invisible ? 0x2 : 0)
}

function ruleName (rule: string | number | undefined, names: string[]): string {
  return typeof rule === 'number' ? names[rule]! : rule!
}

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
          friendlyFireOf(packet),
          ruleName(packet.nameTagVisibility, NAME_TAG_VISIBILITIES),
          ruleName(packet.collisionRule, COLLISION_RULES),
          packet.formatting ?? packet.color, // color before 1.13
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
        bot.emit('teamRemoved', team)
        break

      case 'change':
        if (!team) break
        team.update(
          packet.name!,
          friendlyFireOf(packet),
          ruleName(packet.nameTagVisibility, NAME_TAG_VISIBILITIES),
          ruleName(packet.collisionRule, COLLISION_RULES),
          packet.formatting ?? packet.color, // color before 1.13
          packet.prefix!,
          packet.suffix!
        )
        bot.emit('teamUpdated', teams[teamName]!)
        break

      case 'join':
        if (!team) break
        for (const player of players) {
          team.add(player)
          bot.teamMap[player] = team
        }
        bot.emit('teamMemberAdded', teams[teamName]!)
        break

      case 'leave':
        if (!team) break
        for (const player of players) {
          team.remove(player)
          delete bot.teamMap[player]
        }
        bot.emit('teamMemberRemoved', teams[teamName]!)
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
