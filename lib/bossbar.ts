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
    declare _shouldDarkenSky: boolean
    declare _isDragonBar: boolean
    declare _createFog: boolean

    constructor (uuid: string, title: TextComponent, health: number, dividers: number, color: number, flags: number) {
      this._entityUUID = uuid
      this.title = title
      this._health = health
      this._dividers = divisions[dividers]!
      this._color = colors[color]!
      this._shouldDarkenSky = (flags & 0x1) !== 0
      this._isDragonBar = (flags & 0x2) !== 0
      this._createFog = (flags & 0x4) !== 0
    }

    set entityUUID (uuid: string) {
      this._entityUUID = uuid
    }

    set title (title: TextComponent) {
      if (title && typeof title === 'object' && title.type === 'string' && 'value' in title) {
        this._title = title.value
      } else {
        this._title = ChatMessage.fromNotch(title)
      }
    }

    set health (health: number) {
      this._health = health
    }

    set dividers (dividers: number) {
      this._dividers = divisions[dividers]!
    }

    set color (color: number) {
      this._color = colors[color]!
    }

    set flags (flags: number) {
      this._shouldDarkenSky = (flags & 0x1) !== 0
      this._isDragonBar = (flags & 0x2) !== 0
      this._createFog = (flags & 0x4) !== 0
    }

    get flags () {
      return (this._shouldDarkenSky ? 0x1 : 0) | (this._isDragonBar ? 0x2 : 0) | (this._createFog ? 0x4 : 0)
    }

    set shouldDarkenSky (darkenSky: boolean) {
      this._shouldDarkenSky = darkenSky
    }

    set isDragonBar (dragonBar: boolean) {
      this._isDragonBar = dragonBar
    }

    get createFog () {
      return this._createFog
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
      return this._shouldDarkenSky
    }

    get isDragonBar () {
      return this._isDragonBar
    }

    get shouldCreateFog () {
      return this._createFog
    }
  }
}

export default loader
