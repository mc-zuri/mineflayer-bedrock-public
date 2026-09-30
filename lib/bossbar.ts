import prismarineChat from 'prismarine-chat'
import type { ChatMessage as ChatMessageInstance } from 'prismarine-chat'
import type { Registry } from 'prismarine-registry'
import type { BossBar as BossBarInstance, BossBarColor } from './types/mineflayer.ts'
import type { TextComponent } from './types/protocol.ts'
import type { ChatLoader } from './types/vendor/prismarine-chat.ts'

const colors: BossBarColor[] = ['pink', 'blue', 'red', 'green', 'yellow', 'purple', 'white']
const divisions = [0, 6, 10, 12, 20]

function loader (registry: Registry) {
  const ChatMessage = (prismarineChat as unknown as ChatLoader)(registry)
  return class BossBar implements BossBarInstance {
    declare _entityUUID: string
    declare _title: ChatMessageInstance | string
    declare _health: number
    declare _dividers: number
    declare _color: BossBarColor
    // flag bits as stored by the constructor / flags setter; booleans when set through the setters
    declare _shouldDarkenSky: number | boolean
    declare _isDragonBar: number | boolean
    declare _createFog: number | boolean

    constructor (uuid: string, title: TextComponent, health: number, dividers: number, color: number, flags: number) {
      this._entityUUID = uuid
      this.title = title
      this._health = health
      this._dividers = divisions[dividers]
      this._color = colors[color]
      this._shouldDarkenSky = flags & 0x1
      this._isDragonBar = flags & 0x2
      this._createFog = flags & 0x4
    }

    set entityUUID (uuid: string) {
      this._entityUUID = uuid
    }

    set title (title: TextComponent) {
      if (title && typeof title === 'object' && title.type === 'string' && 'value' in title) {
        this._title = title.value
      } else {
        const chatMsg = ChatMessage.fromNotch(title)
        if (chatMsg !== undefined && chatMsg !== null) {
          this._title = chatMsg
        } else if (typeof title === 'string') {
          this._title = title
        } else {
          this._title = ''
        }
      }
    }

    set health (health: number) {
      this._health = health
    }

    set dividers (dividers: number) {
      this._dividers = divisions[dividers]
    }

    set color (color: number) {
      this._color = colors[color]
    }

    set flags (flags: number) {
      this._shouldDarkenSky = flags & 0x1
      this._isDragonBar = flags & 0x2
      this._createFog = flags & 0x4
    }

    get flags () {
      return (this._shouldDarkenSky as number) | ((this._isDragonBar as number) << 1) | ((this._createFog as number) << 2)
    }

    set shouldDarkenSky (darkenSky: boolean) {
      this._shouldDarkenSky = darkenSky
    }

    set isDragonBar (dragonBar: boolean) {
      this._isDragonBar = dragonBar
    }

    get createFog () {
      return this._createFog as boolean
    }

    set createFog (createFog: boolean) {
      this._createFog = createFog
    }

    get entityUUID () {
      return this._entityUUID
    }

    get title (): ChatMessageInstance | string {
      return this._title
    }

    get health () {
      return this._health
    }

    get dividers () {
      return this._dividers
    }

    get color (): BossBarColor {
      return this._color
    }

    get shouldDarkenSky () {
      return this._shouldDarkenSky as boolean
    }

    get isDragonBar () {
      return this._isDragonBar as boolean
    }

    get shouldCreateFog () {
      return this._createFog as boolean
    }
  }
}

export default loader
