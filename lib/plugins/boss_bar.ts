import bossbarModule from '../bossbar.ts'
import type { BossBar as BossBarInstance } from '../types/mineflayer.ts'
import type { BotInternal } from '../types/internal.ts'
import type { ClientboundPackets, TextComponent } from '../types/protocol.ts'

export default inject

function inject (bot: BotInternal): void {
  const BossBar = bossbarModule(bot.registry)
  const bars: { [uuid: string]: BossBarInstance } = {}

  function extractTitle (title: TextComponent | undefined): TextComponent {
    if (!title) return ''
    if (typeof title === 'string') return title
    // Return the original object for BossBar to handle
    return title
  }

  function handleBossBarPacket (packet: ClientboundPackets['boss_bar']) {
    if (packet.action === 0) {
      bars[packet.entityUUID] = new BossBar(
        packet.entityUUID,
        extractTitle(packet.title),
        // action 0 (add) carries every field
        packet.health!,
        packet.dividers!,
        packet.color!,
        packet.flags!
      )
      bot.emit('bossBarCreated', bars[packet.entityUUID]!)
    } else if (packet.action === 1) {
      if (!(packet.entityUUID in bars)) return // nothing to remove
      bot.emit('bossBarDeleted', bars[packet.entityUUID]!)
      delete bars[packet.entityUUID]
    } else {
      if (!(packet.entityUUID in bars)) {
        return
      }
      if (packet.action === 2 && packet.health !== undefined) {
        bars[packet.entityUUID]!.health = packet.health
      }
      if (packet.action === 3 && packet.title !== undefined) {
        bars[packet.entityUUID]!.title = extractTitle(packet.title)
      }
      if (packet.action === 4) {
        if (packet.dividers !== undefined) {
          bars[packet.entityUUID]!.dividers = packet.dividers
        }
        if (packet.color !== undefined) {
          bars[packet.entityUUID]!.color = packet.color
        }
      }
      if (packet.action === 5 && packet.flags !== undefined) {
        bars[packet.entityUUID]!.flags = packet.flags
      }
      bot.emit('bossBarUpdated', bars[packet.entityUUID]!)
    }
  }

  bot._client.on('boss_bar', handleBossBarPacket)

  Object.defineProperty(bot, 'bossBars', {
    get () {
      return Object.values(bars)
    }
  })
}
