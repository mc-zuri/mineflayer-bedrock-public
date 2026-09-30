// Regression tests for the core plugins and classes (bossbar, scoreboard, team, ...).
// They drive the plugin on a fake bot with a real registry, no server.
import assert from 'assert'
import prismarineRegistry from 'prismarine-registry'
import bossbarLoader from '../lib/bossbar.ts'

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
})
