import { processNbtMessage } from 'prismarine-chat'
import type { BotInternal } from '../types/internal.ts'
import type { TextComponent } from '../types/protocol.ts'

export default inject
function inject (bot: BotInternal): void {
  function parseTitle (text: TextComponent | undefined): string {
    try {
      const parsed = JSON.parse(text as string)
      return typeof parsed === 'string' ? parsed : (parsed.text || text)
    } catch {
      return typeof text === 'string' ? text.replace(/^"|"$/g, '') : text as unknown as string
    }
  }

  if (bot.supportFeature('titleUsesLegacyPackets')) {
    bot._client.on('title', (packet) => {
      if (packet.action === 0) bot.emit('title', parseTitle(packet.text), 'title')
      else if (packet.action === 1) bot.emit('title', parseTitle(packet.text), 'subtitle')
      // 1.8 – 1.10: 2 times, 3 clear, 4 reset; 1.11+: 2 action bar text, 3 times, 4 clear, 5 reset
      else if (packet.action === 2) {
        if (packet.text === undefined) bot.emit('title_times', packet.fadeIn!, packet.stay!, packet.fadeOut!)
      } else if (packet.action === 3) {
        if (packet.fadeIn !== undefined) bot.emit('title_times', packet.fadeIn, packet.stay!, packet.fadeOut!)
        else bot.emit('title_clear')
      } else if (packet.action === 4 || packet.action === 5) bot.emit('title_clear')
    })
  } else if (bot.supportFeature('titleUsesNewPackets')) {
    function getText (packet: { text: TextComponent }) {
      let text = packet.text
      // 1.20.3+: NBT, as the JSON string older versions send (a plain text is a bare string tag)
      if (typeof text === 'object') text = processNbtMessage(text)
      return parseTitle(text)
    }
    bot._client.on('set_title_text', (packet) => bot.emit('title', getText(packet), 'title'))
    bot._client.on('set_title_subtitle', (packet) => bot.emit('title', getText(packet), 'subtitle'))
    bot._client.on('set_title_time', (packet) => {
      if (typeof packet.fadeIn === 'number' && typeof packet.stay === 'number' && typeof packet.fadeOut === 'number') {
        bot.emit('title_times', packet.fadeIn, packet.stay, packet.fadeOut)
      }
    })
    bot._client.on('clear_titles', () => bot.emit('title_clear'))
  }
}
