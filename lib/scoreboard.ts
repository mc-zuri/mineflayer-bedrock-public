import prismarineChat from 'prismarine-chat'
import nbt from 'prismarine-nbt'
import type { BotInternal } from './types/internal.ts'
import type { ScoreBoard as ScoreBoardInstance, ScoreBoardItem, ScoreBoardPositions } from './types/mineflayer.ts'
import type { TextComponent } from './types/protocol.ts'
import type { ChatLoader } from './types/vendor/prismarine-chat.ts'

// the vanilla sidebar order: higher score first, then the owner name ignoring case
const sortItems = (a: ScoreBoardItem, b: ScoreBoardItem) => {
  if (a.value > b.value) return -1
  if (a.value < b.value) return 1
  const aName = a.name.toLowerCase()
  const bName = b.name.toLowerCase()
  if (aName < bName) return -1
  if (aName > bName) return 1
  return 0
}

export default (bot: BotInternal) => {
  const ChatMessage = (prismarineChat as unknown as ChatLoader)(bot.registry)

  class ScoreBoard implements ScoreBoardInstance {
    declare name: string
    declare title: string
    declare itemsMap: { [name: string]: ScoreBoardItem }
    declare static positions: ScoreBoardPositions

    constructor (packet: { name: string, displayText?: TextComponent }) {
      this.name = packet.name
      this.setTitle(packet.displayText)
      this.itemsMap = {}
    }

    setTitle (title: TextComponent | undefined) {
      // 1.20.3+: an NBT component, a plain text title being a bare string tag
      if (title !== null && typeof title === 'object') {
        const simplified = nbt.simplify(title)
        this.title = typeof simplified === 'string' ? simplified : simplified.text
        return
      }
      try {
        this.title = JSON.parse(title as string).text // version>1.13
      } catch {
        this.title = title as string
      }
    }

    add (name: string, value: number) {
      this.itemsMap[name] = { name, value } as ScoreBoardItem
      this.itemsMap[name] = {
        name,
        value,
        get displayName () {
          if (name in bot.teamMap) {
            return bot.teamMap[name]!.displayName(name)
          }
          return new ChatMessage(name)
        }
      }
      return this.itemsMap[name]
    }

    remove (name: string) {
      const removed: ScoreBoardItem | undefined = this.itemsMap[name]
      delete this.itemsMap[name]
      return removed
    }

    get items () {
      return Object.values(this.itemsMap).sort(sortItems)
    }
  }

  // The named slots alias the numeric ones and stay non-enumerable, so
  // Object.keys/values(bot.scoreboard) only ever yield displayed objectives.
  ScoreBoard.positions = Object.defineProperties({}, {
    list: { get (this: ScoreBoardPositions) { return this[0] } },
    sidebar: { get (this: ScoreBoardPositions) { return this[1] } },
    belowName: { get (this: ScoreBoardPositions) { return this[2] } }
  }) as ScoreBoardPositions
  return ScoreBoard
}
