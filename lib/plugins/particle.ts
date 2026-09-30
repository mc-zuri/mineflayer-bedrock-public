import particleModule from '../particle.ts'

export default inject

function inject (bot, { version }) {
  const Particle = particleModule(bot.registry)

  bot._client.on('world_particles', (packet) => {
    bot.emit('particle', Particle.fromNetwork(packet))
  })
}
