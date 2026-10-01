// Edge cases of the core plugins a vanilla server rarely or never sends, driven on a
// fake bot with a real registry (no server); see coreTest.ts for the regular cases.
import EventEmitter from 'events'
import assert from 'assert'
import prismarineRegistry from 'prismarine-registry'
import minecraftData from 'minecraft-data'
import bossBarPlugin from '../lib/plugins/boss_bar.ts'
import teamPlugin from '../lib/plugins/team.ts'
import scoreboardPlugin from '../lib/plugins/scoreboard.ts'
import titlePlugin from '../lib/plugins/title.ts'
import gamePlugin from '../lib/plugins/game.ts'
import resourcePackPlugin from '../lib/plugins/resource_pack.ts'
import { onceWithCleanup } from '../lib/promise_utils.ts'
import { createBot } from '../lib/loader.ts'
import { latestSupportedVersion } from '../lib/version.ts'

interface Write { name: string, params: any }

// a bot with just what the core plugins read: registry, supportFeature and a client that records writes
function fakeBot (version: string): any {
  const registry = prismarineRegistry(version)
  const bot: any = new EventEmitter()
  bot.registry = registry
  bot.version = version
  bot.supportFeature = registry.supportFeature
  bot.warnings = []
  bot._warn = (...message: unknown[]) => bot.warnings.push(message.join(' '))
  const client: any = new EventEmitter()
  const writes: Write[] = []
  client.writes = writes
  client.write = (name: string, params: any) => { writes.push({ name, params }) }
  client.registerChannel = () => {}
  client.writeChannel = (channel: string, params: any) => { writes.push({ name: channel, params }) }
  bot._client = client
  return bot
}

const uuid = '00112233-4455-6677-8899-aabbccddeeff'

describe('edge cases', () => {
  describe('boss bar', () => {
    it('applies every update action and ignores updates of an unknown bar', () => {
      const bot = fakeBot('1.16.5')
      bossBarPlugin(bot, {} as any)
      const updated: unknown[] = []
      bot.on('bossBarUpdated', (bar: any) => updated.push(bar.entityUUID))
      bot._client.emit('boss_bar', { entityUUID: uuid, action: 0, title: '{"text":"Boss"}', health: 1, color: 0, dividers: 0, flags: 0 })
      const [bar] = bot.bossBars
      assert.strictEqual(bar.entityUUID, uuid)
      assert.strictEqual(bar.title.toString(), 'Boss')
      bot._client.emit('boss_bar', { entityUUID: uuid, action: 2, health: 0.5 })
      bot._client.emit('boss_bar', { entityUUID: uuid, action: 3, title: '{"text":"Renamed"}' })
      bot._client.emit('boss_bar', { entityUUID: uuid, action: 4, color: 2, dividers: 1 })
      bot._client.emit('boss_bar', { entityUUID: uuid, action: 5, flags: 0b111 })
      assert.strictEqual(bar.health, 0.5)
      assert.strictEqual(bar.title.toString(), 'Renamed')
      assert.strictEqual(bar.color, 'red')
      assert.strictEqual(bar.dividers, 6)
      assert.deepStrictEqual([bar.shouldDarkenSky, bar.isDragonBar, bar.shouldCreateFog], [true, true, true])
      assert.deepStrictEqual(updated, [uuid, uuid, uuid, uuid])

      // a bar the bot never saw created (e.g. sent before a proxy switch)
      bot._client.emit('boss_bar', { entityUUID: '99999999-4455-6677-8899-aabbccddeeff', action: 2, health: 0.1 })
      assert.deepStrictEqual(updated, [uuid, uuid, uuid, uuid])
      assert.strictEqual(bot.bossBars.length, 1)
    })

    it('a BossBar can be changed through its setters', () => {
      const bot = fakeBot('1.16.5')
      bossBarPlugin(bot, {} as any)
      bot._client.emit('boss_bar', { entityUUID: uuid, action: 0, title: '{"text":"Boss"}', health: 1, color: 0, dividers: 0, flags: 0 })
      const [bar] = bot.bossBars
      bar.entityUUID = 'other'
      bar.shouldDarkenSky = true
      bar.isDragonBar = true
      bar.createFog = true
      assert.strictEqual(bar.entityUUID, 'other')
      assert.strictEqual(bar.flags, 0b111)
    })
  })

  describe('team', () => {
    const addRed = { team: 'red', mode: 0, name: '{"text":"red"}', friendlyFire: 1, nameTagVisibility: 'always', collisionRule: 'always', formatting: 12, prefix: '""', suffix: '""', players: ['alice'] }

    it('join and leave update the members and the team map', () => {
      const bot = fakeBot('1.16.5')
      teamPlugin(bot)
      const events: unknown[] = []
      bot.on('teamMemberAdded', (team: any) => events.push(['added', team.team, team.members]))
      bot.on('teamMemberRemoved', (team: any) => events.push(['removed', team.team, team.members]))
      bot._client.emit('teams', addRed)
      bot._client.emit('teams', { team: 'red', mode: 3, players: ['bob'] })
      assert.strictEqual(bot.teamMap.bob, bot.teams.red)
      bot._client.emit('teams', { team: 'red', mode: 4, players: ['alice'] })
      assert.strictEqual(bot.teamMap.alice, undefined)
      assert.deepStrictEqual(events, [['added', 'red', ['alice', 'bob']], ['removed', 'red', ['bob']]])
      // join / leave of an unknown team change nothing
      bot._client.emit('teams', { team: 'blue', mode: 3, players: ['carol'] })
      bot._client.emit('teams', { team: 'blue', mode: 4, players: ['bob'] })
      assert.strictEqual(events.length, 2)
      assert.strictEqual(bot.teamMap.carol, undefined)
    })

    it('an unknown mode is reported with _warn', () => {
      const bot = fakeBot('1.16.5')
      teamPlugin(bot)
      bot._client.emit('teams', addRed)
      bot._client.emit('teams', { team: 'red', mode: 7 })
      assert.deepStrictEqual(bot.warnings, ['Unknown team mode handling team update: undefined'])
      assert.deepStrictEqual(bot.teams.red.members, ['alice'])
    })
  })

  describe('scoreboard', () => {
    it('a title update of an unknown objective emits an error', () => {
      const bot = fakeBot('1.16.5')
      scoreboardPlugin(bot)
      const errors: Error[] = []
      bot.on('error', (err: Error) => errors.push(err))
      bot._client.emit('scoreboard_objective', { name: 'ghost', action: 2, displayText: '{"text":"Ghost"}', type: 'integer' })
      assert.deepStrictEqual(errors.map(e => e.message), ['Received update for unknown objective ghost'])
    })

    it('scoreboard_score action 1 removes the score (before 1.20.3)', () => {
      const bot = fakeBot('1.12.2')
      scoreboardPlugin(bot)
      bot._client.emit('scoreboard_objective', { name: 'kills', action: 0, displayText: 'Kills', type: 'integer' })
      bot._client.emit('scoreboard_score', { itemName: 'alice', scoreName: 'kills', action: 0, value: 3 })
      const removed: unknown[] = []
      bot.on('scoreRemoved', (sb: any, item: any) => removed.push([sb.name, item?.name]))
      bot._client.emit('scoreboard_score', { itemName: 'alice', scoreName: 'kills', action: 1 })
      assert.deepStrictEqual(removed, [['kills', 'alice']])
      assert.deepStrictEqual(bot.scoreboards.kills.items, [])
    })
  })

  describe('title', () => {
    it('a title that is not JSON is used as the text, without surrounding quotes', () => {
      const bot = fakeBot('1.18.2')
      titlePlugin(bot)
      const titles: unknown[] = []
      bot.on('title', (text: string, type: string) => titles.push([text, type]))
      bot._client.emit('set_title_text', { text: 'plain {text' })
      bot._client.emit('set_title_subtitle', { text: '"quoted' })
      bot._client.emit('set_title_text', { text: '"hi"' })
      assert.deepStrictEqual(titles, [['plain {text', 'title'], ['quoted', 'subtitle'], ['hi', 'title']])
    })

    it('1.17 (protocol 755, already without the title packet) reads the set_title_* packets', () => {
      const bot = fakeBot('1.17')
      titlePlugin(bot)
      const events: unknown[] = []
      bot.on('title', (text: string, type: string) => events.push([type, text]))
      bot.on('title_clear', () => events.push(['clear']))
      bot._client.emit('set_title_text', { text: '{"text":"hi"}' })
      bot._client.emit('set_title_subtitle', { text: '{"text":"there"}' })
      bot._client.emit('clear_titles', { reset: false })
      assert.deepStrictEqual(events, [['title', 'hi'], ['subtitle', 'there'], ['clear']])
    })

    it('set_title_time emits title_times', () => {
      const bot = fakeBot('1.18.2')
      titlePlugin(bot)
      const times: unknown[] = []
      bot.on('title_times', (...args: number[]) => times.push(args))
      bot._client.emit('set_title_time', { fadeIn: 10, stay: 70, fadeOut: 20 })
      assert.deepStrictEqual(times, [[10, 70, 20]])
    })
  })

  describe('game', () => {
    it('a game mode outside 0 - 3 reads as survival', () => {
      const bot = fakeBot('1.16.5')
      gamePlugin(bot, { brand: 'vanilla' } as any)
      bot.game.gameMode = 'creative'
      bot._client.emit('game_state_change', { reason: 3, gameMode: 7 })
      assert.strictEqual(bot.game.gameMode, 'survival')
      bot._client.emit('game_state_change', { reason: 3, gameMode: 2 })
      assert.strictEqual(bot.game.gameMode, 'adventure')
    })

    it('winning the game (end credits) answers with a respawn client_command', () => {
      for (const [version, params] of [['1.8.8', { payload: 0 }], ['1.21.11', { actionId: 0 }]] as const) {
        const bot = fakeBot(version)
        gamePlugin(bot, { brand: 'vanilla' } as any)
        bot._client.emit('game_state_change', { reason: 4, gameMode: 0 }) // credits seen before: nothing to do
        bot._client.emit('game_state_change', { reason: 4, gameMode: 1 })
        assert.deepStrictEqual(bot._client.writes, [{ name: 'client_command', params }], version)
      }
    })

    it('reads the difficulty packet and the server brand', () => {
      const bot = fakeBot('1.12.2')
      gamePlugin(bot, { brand: 'vanilla' } as any)
      bot._client.emit('difficulty', { difficulty: 3, difficultyLocked: false })
      assert.strictEqual(bot.game.difficulty, 'hard')
      bot._client.emit('MC|Brand', 'paper')
      assert.strictEqual(bot.game.serverBrand, 'paper')
    })

    it('reads the dimension name of a 1.16 / 1.16.1 login (dimensionIsAString)', () => {
      const bot = fakeBot('1.16.1')
      gamePlugin(bot, { brand: 'vanilla' } as any)
      bot._client.emit('login', { entityId: 1, gameMode: 0, previousGameMode: 255, worldNames: ['minecraft:the_nether'], dimension: 'minecraft:the_nether', worldName: 'minecraft:the_nether', maxPlayers: 20, viewDistance: 8, isFlat: false })
      assert.strictEqual(bot.game.dimension, 'the_nether')
      assert.strictEqual(bot.game.height, 256)
    })
  })

  describe('resource pack', () => {
    it('1.20.3+: remove_resource_pack with a uuid removes that pack, without one every pack', () => {
      const bot = fakeBot('1.20.4')
      resourcePackPlugin(bot)
      const packs: unknown[] = []
      bot.on('resourcePack', (url: string, id: string) => packs.push([url, id]))
      bot._client.emit('add_resource_pack', { uuid, url: 'http://a', hash: '', forced: false })
      bot._client.emit('add_resource_pack', { uuid: 'ffffffff-4455-6677-8899-aabbccddeeff', url: 'http://b', hash: '', forced: false })
      assert.deepStrictEqual(packs, [['http://a', uuid], ['http://b', 'ffffffff-4455-6677-8899-aabbccddeeff']])
      bot._client.emit('remove_resource_pack', { uuid })
      bot._client.emit('remove_resource_pack', { uuid: '12345678-4455-6677-8899-aabbccddeeff' }) // never added
      bot._client.emit('remove_resource_pack', {})
      bot.acceptResourcePack()
      bot.denyResourcePack()
      // the answers name the latest offered pack
      const answered = { uuid: 'ffffffff-4455-6677-8899-aabbccddeeff' }
      assert.deepStrictEqual(bot._client.writes, [
        { name: 'resource_pack_receive', params: { ...answered, result: 3 } },
        { name: 'resource_pack_receive', params: { ...answered, result: 0 } },
        { name: 'resource_pack_receive', params: { ...answered, result: 1 } }
      ])
    })

    it('answers with the hash on 1.8 - 1.9.4 and without one on 1.10 - 1.20.2', () => {
      for (const [version, hash] of [['1.8.8', { hash: 'abc' }], ['1.12.2', {}]] as const) {
        const bot = fakeBot(version)
        resourcePackPlugin(bot)
        const packs: unknown[] = []
        bot.on('resourcePack', (url: string, h: string) => packs.push([url, h]))
        bot.acceptResourcePack() // nothing offered yet
        bot.denyResourcePack()
        bot._client.emit('resource_pack_send', { url: 'http://a', hash: 'abc' })
        bot.acceptResourcePack()
        bot.denyResourcePack()
        assert.deepStrictEqual(packs, [['http://a', 'abc']], version)
        assert.deepStrictEqual(bot._client.writes, [
          { name: 'resource_pack_receive', params: { result: 3, ...hash } },
          { name: 'resource_pack_receive', params: { result: 0, ...hash } },
          { name: 'resource_pack_receive', params: { result: 1 } }
        ], version)
      }
    })
  })

  describe('onceWithCleanup', () => {
    it('rejects at once for an already aborted signal', async () => {
      const emitter = new EventEmitter()
      const abort = new AbortController()
      const reason = new Error('gave up')
      abort.abort(reason)
      await assert.rejects(onceWithCleanup(emitter, 'thing', { signal: abort.signal }), err => err === reason)
      assert.strictEqual(emitter.listenerCount('thing'), 0)
    })

    it('a reason that is not an Error rejects with a generic abort error', async () => {
      const emitter = new EventEmitter()
      const abort = new AbortController()
      const promise = onceWithCleanup(emitter, 'thing', { signal: abort.signal })
      abort.abort('not needed any more')
      await assert.rejects(promise, /Waiting for event thing was aborted/)
    })
  })

  describe('loader', () => {
    function versionClient (version: string) {
      const client: any = new EventEmitter()
      client.wait_connect = true
      client.version = version
      client.ended = []
      client.end = (reason: string) => client.ended.push(reason)
      return client
    }

    it('a server newer than the latest supported version emits error and ends the client', () => {
      // minecraft-data has no version newer than the latest supported one, so make the
      // latest supported version compare older than the version before it
      // (minecraft-data's version comparisons read this index)
      const versions = minecraftData.versionsByMinecraftVersion.pc
      const latest = versions[latestSupportedVersion]!
      versions[latestSupportedVersion] = { ...latest, dataVersion: versions['1.20.4']!.dataVersion! - 1 }
      try {
        const client = versionClient('1.20.4')
        const bot = createBot({ client, loadInternalPlugins: false, logErrors: false })
        const errors: Error[] = []
        bot.on('error', (err) => { errors.push(err) })
        client.emit('connect_allowed')
        assert.deepStrictEqual(errors.map(e => e.message), [`Server version '1.20.4' is not supported. Latest supported version is '${latestSupportedVersion}'.`])
        assert.strictEqual(client.ended.length, 1)
      } finally {
        versions[latestSupportedVersion] = latest
      }
    })

    it('a version without minecraft-data emits the prismarine-registry error', () => {
      const client = versionClient('1.99.99')
      const bot = createBot({ client, loadInternalPlugins: false, logErrors: false })
      const errors: Error[] = []
      bot.on('error', (err) => { errors.push(err) })
      client.emit('connect_allowed')
      assert.deepStrictEqual(errors.map(e => e.message), ['Do not have data for 1.99.99'])
    })

    it('loads function plugins of the options and _warn honours hideErrors', () => {
      const client = versionClient('1.20.4')
      client.wait_connect = false
      const injected: unknown[] = []
      const warn = console.warn
      const warned: unknown[] = []
      console.warn = (...args: unknown[]) => { warned.push(args) }
      try {
        const bot: any = createBot({ client, loadInternalPlugins: false, logErrors: false, plugins: { mine: (b: unknown) => { injected.push(b) }, chat: false } })
        bot._warn('shown')
        const quiet: any = createBot({ client: versionClient('1.20.4'), loadInternalPlugins: false, logErrors: false, hideErrors: true })
        quiet._warn('hidden')
        assert.deepStrictEqual(warned, [['[mineflayer]', 'shown']])
        return new Promise<void>(resolve => bot.once('inject_allowed', () => setImmediate(() => {
          assert.deepStrictEqual(injected, [bot])
          resolve()
        })))
      } finally {
        console.warn = warn
      }
    })
  })
})
