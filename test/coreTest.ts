// Regression tests for the core plugins and classes (bossbar, scoreboard, team, ...).
// They drive the plugin on a fake bot with a real registry, no server.
import EventEmitter from 'events'
import assert from 'assert'
import prismarineRegistry from 'prismarine-registry'
import bossbarLoader from '../lib/bossbar.ts'
import teamPlugin from '../lib/plugins/team.ts'

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
  })
})
