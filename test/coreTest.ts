// Regression tests for the core plugins and classes (bossbar, scoreboard, team, ...).
// They drive the plugin on a fake bot with a real registry, no server.
import EventEmitter from 'events'
import assert from 'assert'
import prismarineRegistry from 'prismarine-registry'
import nbt from 'prismarine-nbt'
import bossbarLoader from '../lib/bossbar.ts'
import teamPlugin from '../lib/plugins/team.ts'
import scoreboardPlugin from '../lib/plugins/scoreboard.ts'
import titlePlugin from '../lib/plugins/title.ts'
import gamePlugin from '../lib/plugins/game.ts'

interface Write { name: string, params: any }

// a bot with just what the core plugins read: registry, supportFeature and a client that records writes
function fakeBot (version: string): any {
  const registry = prismarineRegistry(version)
  const bot: any = new EventEmitter()
  bot.registry = registry
  bot.version = version
  bot.supportFeature = registry.supportFeature
  bot._warn = () => {}
  const client: any = new EventEmitter()
  const writes: Write[] = []
  client.writes = writes
  client.write = (name: string, params: any) => { writes.push({ name, params }) }
  client.registerChannel = () => {}
  client.writeChannel = (channel: string, params: any) => { writes.push({ name: channel, params }) }
  bot._client = client
  return bot
}

describe('core', () => {
  describe('BossBar', () => {
    const BossBar = bossbarLoader(prismarineRegistry('1.16.5'))

    it('flags reads back the flag bits it was given', () => {
      for (let flags = 0; flags < 8; flags++) {
        const bar = new BossBar('00000000-0000-0000-0000-000000000000', '{"text":"bar"}', 1, 0, 0, flags)
        assert.strictEqual(bar.flags, flags)
        assert.strictEqual(bar.shouldDarkenSky, (flags & 0x1) !== 0)
        assert.strictEqual(bar.isDragonBar, (flags & 0x2) !== 0)
        assert.strictEqual(bar.createFog, (flags & 0x4) !== 0)
        bar.flags = 7 - flags
        assert.strictEqual(bar.flags, 7 - flags)
      }
    })
  })

  describe('team', () => {
    it('teamRemoved carries the removed team', () => {
      const bot = fakeBot('1.16.5')
      teamPlugin(bot)
      bot._client.emit('teams', { team: 'red', mode: 0, name: '{"text":"red"}', friendlyFire: 1, nameTagVisibility: 'always', collisionRule: 'always', formatting: 12, prefix: '""', suffix: '""', players: ['alice'] })
      const team = bot.teams.red
      let removed: unknown = null
      bot.on('teamRemoved', (t: unknown) => { removed = t })
      bot._client.emit('teams', { team: 'red', mode: 1 })
      assert.strictEqual(removed, team)
      assert.strictEqual(bot.teams.red, undefined)
    })

    it('reads the team color before 1.13', () => {
      for (const [version, packetName] of [['1.8.8', 'scoreboard_team'], ['1.12.2', 'teams']]) {
        const bot = fakeBot(version)
        teamPlugin(bot)
        bot._client.emit(packetName, { team: 'red', mode: 0, name: 'red', prefix: '', suffix: '', friendlyFire: 1, nameTagVisibility: 'always', collisionRule: 'always', color: 12, players: ['alice'] })
        assert.strictEqual(bot.teams.red.color, 'red', version)
        bot._client.emit(packetName, { team: 'red', mode: 2, name: 'red', prefix: '', suffix: '', friendlyFire: 1, nameTagVisibility: 'always', collisionRule: 'always', color: 9 })
        assert.strictEqual(bot.teams.red.color, 'blue', version)
      }
    })

    it('reads friendlyFire and the rules on 1.21.5+', () => {
      const text = { type: 'string', value: 'red' }
      const bot5 = fakeBot('1.21.5')
      teamPlugin(bot5)
      bot5._client.emit('teams', { team: 'red', mode: 0, name: text, prefix: text, suffix: text, friendlyFire: 3, nameTagVisibility: 2, collisionRule: 3, formatting: 12, players: [] })
      assert.strictEqual(bot5.teams.red.friendlyFire, 3)
      assert.strictEqual(bot5.teams.red.nameTagVisibility, 'hide_for_other_teams')
      assert.strictEqual(bot5.teams.red.collisionRule, 'push_own_team')

      const bot6 = fakeBot('1.21.6')
      teamPlugin(bot6)
      bot6._client.emit('teams', { team: 'red', mode: 'add', name: text, prefix: text, suffix: text, flags: { friendly_fire: true, see_friendly_invisible: false, _value: 1 }, nameTagVisibility: 'never', collisionRule: 'always', formatting: 12, players: [] })
      assert.strictEqual(bot6.teams.red.friendlyFire, 1)
      assert.strictEqual(bot6.teams.red.nameTagVisibility, 'never')
      bot6._client.emit('teams', { team: 'red', mode: 'change', name: text, prefix: text, suffix: text, flags: { friendly_fire: false, see_friendly_invisible: true, _value: 2 }, nameTagVisibility: 'always', collisionRule: 'never', formatting: 12 })
      assert.strictEqual(bot6.teams.red.friendlyFire, 2)
      assert.strictEqual(bot6.teams.red.collisionRule, 'never')
    })
  })

  describe('scoreboard', () => {
    it('tracks scores on 1.20.3+ (no action field, reset_score)', () => {
      const bot = fakeBot('1.20.4')
      scoreboardPlugin(bot)
      const text = { type: 'string', value: 'Kills' }
      bot._client.emit('scoreboard_objective', { name: 'kills', action: 0, displayText: text, type: 0 })
      bot._client.emit('scoreboard_objective', { name: 'deaths', action: 0, displayText: text, type: 0 })
      const updated: unknown[] = []
      const removed: unknown[] = []
      bot.on('scoreUpdated', (sb: any, item: any) => updated.push([sb.name, item.name, item.value]))
      bot.on('scoreRemoved', (sb: any, item: any) => removed.push([sb.name, item?.name]))
      bot._client.emit('scoreboard_score', { itemName: 'alice', scoreName: 'kills', value: 3 })
      bot._client.emit('scoreboard_score', { itemName: 'bob', scoreName: 'deaths', value: 1 })
      assert.deepStrictEqual(updated, [['kills', 'alice', 3], ['deaths', 'bob', 1]])
      assert.strictEqual(bot.scoreboards.kills.itemsMap.alice.value, 3)
      bot._client.emit('reset_score', { entity_name: 'alice', objective_name: 'deaths' })
      assert.deepStrictEqual(removed, [['deaths', undefined]])
      bot._client.emit('reset_score', { entity_name: 'alice', objective_name: 'kills' })
      assert.deepStrictEqual(removed, [['deaths', undefined], ['kills', 'alice']])
      bot._client.emit('reset_score', { entity_name: 'bob' })
      assert.deepStrictEqual(removed, [['deaths', undefined], ['kills', 'alice'], ['deaths', 'bob']])
      assert.deepStrictEqual(Object.keys(bot.scoreboards.deaths.itemsMap), [])
    })

    it('reads the objective title from NBT on 1.20.3+', () => {
      const bot = fakeBot('1.20.4')
      scoreboardPlugin(bot)
      bot._client.emit('scoreboard_objective', { name: 'kills', action: 0, displayText: { type: 'string', value: 'Kills' }, type: 0 })
      assert.strictEqual(bot.scoreboards.kills.title, 'Kills')
      bot._client.emit('scoreboard_objective', { name: 'kills', action: 2, displayText: { type: 'compound', name: '', value: { text: { type: 'string', value: 'Top kills' }, color: { type: 'string', value: 'red' } } }, type: 0 })
      assert.strictEqual(bot.scoreboards.kills.title, 'Top kills')
    })
  })

  describe('title', () => {
    function record (bot: any) {
      const events: unknown[] = []
      bot.on('title', (text: string, type: string) => events.push(['title', text, type]))
      bot.on('title_times', (...times: number[]) => events.push(['title_times', ...times]))
      bot.on('title_clear', () => events.push(['title_clear']))
      return events
    }

    it('follows the legacy title actions of each version', () => {
      const bot8 = fakeBot('1.8.8')
      titlePlugin(bot8)
      const events8 = record(bot8)
      bot8._client.emit('title', { action: 0, text: '{"text":"hi"}' })
      bot8._client.emit('title', { action: 2, fadeIn: 1, stay: 2, fadeOut: 3 })
      bot8._client.emit('title', { action: 3 })
      bot8._client.emit('title', { action: 4 })
      assert.deepStrictEqual(events8, [['title', 'hi', 'title'], ['title_times', 1, 2, 3], ['title_clear'], ['title_clear']])

      const bot12 = fakeBot('1.12.2')
      titlePlugin(bot12)
      const events12 = record(bot12)
      bot12._client.emit('title', { action: 2, text: '{"text":"action bar"}' })
      bot12._client.emit('title', { action: 3, fadeIn: 1, stay: 2, fadeOut: 3 })
      bot12._client.emit('title', { action: 4 })
      bot12._client.emit('title', { action: 5 })
      assert.deepStrictEqual(events12, [['title_times', 1, 2, 3], ['title_clear'], ['title_clear']])
    })

    it('reads NBT titles on 1.20.3+', () => {
      const bot = fakeBot('1.20.4')
      titlePlugin(bot)
      const events = record(bot)
      bot._client.emit('set_title_text', { text: { type: 'string', value: 'plain' } })
      bot._client.emit('set_title_subtitle', { text: { type: 'compound', name: '', value: { text: { type: 'string', value: 'styled' }, color: { type: 'string', value: 'red' } } } })
      assert.deepStrictEqual(events, [['title', 'plain', 'title'], ['title', 'styled', 'subtitle']])
    })
  })

  describe('game', () => {
    it('keeps the hardcore flag of the login packet', () => {
      const bot12 = fakeBot('1.12.2')
      gamePlugin(bot12, { brand: 'vanilla' } as any)
      bot12._client.emit('login', { entityId: 1, gameMode: 0b1000 | 1, dimension: 0, difficulty: 3, maxPlayers: 20, levelType: 'default', reducedDebugInfo: false })
      assert.strictEqual(bot12.game.hardcore, true)
      assert.strictEqual(bot12.game.gameMode, 'creative')
      bot12._client.emit('respawn', { dimension: -1, difficulty: 3, gamemode: 3, levelType: 'default' })
      assert.strictEqual(bot12.game.hardcore, true)
      assert.strictEqual(bot12.game.gameMode, 'spectator')

      const bot20 = fakeBot('1.20.6')
      gamePlugin(bot20, { brand: 'vanilla' } as any)
      bot20._client.emit('registry_data', { id: 'minecraft:dimension_type', entries: [{ key: 'minecraft:overworld', value: nbt.comp({ min_y: nbt.int(-64), height: nbt.int(384) }) }] })
      const worldState = { dimension: 0, name: 'minecraft:overworld', hashedSeed: [0, 0], gamemode: 'survival', previousGamemode: 255, isDebug: false, isFlat: false, portalCooldown: 0 }
      bot20._client.emit('login', { entityId: 1, isHardcore: true, worldNames: ['minecraft:overworld'], maxPlayers: 20, viewDistance: 10, simulationDistance: 10, reducedDebugInfo: false, enableRespawnScreen: true, doLimitedCrafting: false, worldState, enforcesSecureChat: false })
      assert.strictEqual(bot20.game.hardcore, true)
      assert.strictEqual(bot20.game.dimension, 'overworld')
      bot20._client.emit('respawn', { worldState, copyMetadata: 0 })
      assert.strictEqual(bot20.game.hardcore, true)
    })

    it('reads the difficulty packet of each version', () => {
      for (const [version, difficulty] of [['1.20.4', 3], ['1.21.6', 'hard']]) {
        const bot = fakeBot(version as string)
        gamePlugin(bot, { brand: 'vanilla' } as any)
        bot._client.emit('difficulty', { difficulty, difficultyLocked: false })
        assert.strictEqual(bot.game.difficulty, 'hard', version as string)
      }
    })
  })
})
