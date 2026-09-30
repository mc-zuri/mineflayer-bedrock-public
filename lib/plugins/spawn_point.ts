import { Vec3 } from 'vec3'

import type { BotInternal } from '../types/internal.ts'

export default inject

function inject (bot: BotInternal): void {
  bot.spawnPoint = new Vec3(0, 0, 0)
  bot._client.on('spawn_position', (packet) => {
    const pos = bot.supportFeature('spawnPositionIsGlobal') ? packet.globalPos!.location : packet.location!
    bot.spawnPoint = new Vec3(pos.x, pos.y, pos.z)
    bot.emit('game')
  })
}
