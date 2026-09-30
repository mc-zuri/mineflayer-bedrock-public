import prismarineChat from 'prismarine-chat'
import type { BotInternal } from '../types/internal.ts'
import type { ChatLoader } from '../types/vendor/prismarine-chat.ts'

export default inject

const escapeValueNewlines = (str: string) => {
  return str.replace(/(": *"(?:\\"|[^"])+")/g, (_, match) => match.replace(/\n/g, '\\n'))
}

function inject (bot: BotInternal): void {
  const ChatMessage = (prismarineChat as unknown as ChatLoader)(bot.registry)

  bot.tablist = {
    header: new ChatMessage(''),
    footer: new ChatMessage('')
  }

  bot._client.on('playerlist_header', (packet) => {
    if (bot.supportFeature('chatPacketsUseNbtComponents')) { // 1.20.3+
      bot.tablist.header = ChatMessage.fromNotch(packet.header)
      bot.tablist.footer = ChatMessage.fromNotch(packet.footer)
    } else {
      if (packet.header) {
        const header = escapeValueNewlines(packet.header as string)
        bot.tablist.header = ChatMessage.fromNotch(header)
      }

      if (packet.footer) {
        const footer = escapeValueNewlines(packet.footer as string)
        bot.tablist.footer = ChatMessage.fromNotch(footer)
      }
    }
  })
}
