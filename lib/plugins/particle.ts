import particleModule from '../particle.ts'

import type { BotOptions } from '../types/mineflayer.ts'
import type { BotInternal } from '../types/internal.ts'

export default inject

function inject (bot: BotInternal, _options: BotOptions): void {
  const Particle = particleModule(bot.registry)

  bot._client.on('world_particles', (packet) => {
    bot.emit('particle', Particle.fromNetwork(packet))
  })
}
