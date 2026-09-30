import type { BotInternal } from '../types/internal.ts'

export default inject

function inject (bot: BotInternal): void {
  bot._client.on('kick_disconnect', (packet) => {
    bot.emit('kicked', packet.reason, true)
  })
  bot._client.on('disconnect', (packet) => {
    bot.emit('kicked', packet.reason, false)
  })
  bot.quit = (reason) => {
    reason = reason ?? 'disconnect.quitting'
    bot.end(reason)
  }
}
