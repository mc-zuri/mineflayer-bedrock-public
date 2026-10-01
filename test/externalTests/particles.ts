import assert from 'assert'
import type { TestFunction } from './plugins/testCommon.ts'
import type { Particle } from '../../lib/types/mineflayer.ts'

export default (): TestFunction => async (bot) => {
  const particleData = bot.registry.particles[0]!

  return new Promise<void>((resolve, reject) => {
    function onParticleEvent (particle: Particle) {
      if (typeof particle.id === 'number') {
        assert.strictEqual(particle.id, particleData.id)
      } else {
        assert.strictEqual(particle.id, particleData.name)
      }
      assert.strictEqual(particle.name, particleData.name)
      assert.strictEqual(particle.position.x, bot.entity.position.x)
      assert.strictEqual(particle.position.y, bot.entity.position.y)
      assert.strictEqual(particle.position.z, bot.entity.position.z)
      assert.strictEqual(particle.offset.x, 5)
      assert.strictEqual(particle.offset.y, 5)
      assert.strictEqual(particle.offset.z, 5)
      assert.strictEqual(particle.count, 100)
      assert.strictEqual(particle.movementSpeed, 0.5)
      assert.strictEqual(particle.longDistanceRender, true)
    }

    // once: a listener left behind asserts on every later particle, and its throw
    // inside the packet handler breaks the connection in whatever test runs next
    bot.once('particle', (particle) => {
      try {
        onParticleEvent(particle)
        resolve()
      } catch (err) {
        reject(err)
      }
    })

    bot.chat(`/particle ${particleData.name} ~ ~ ~ 5 5 5 0.5 100 force`)
  })
}
