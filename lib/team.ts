import prismarineChat from 'prismarine-chat'
import type { ChatMessage as ChatMessageInstance } from 'prismarine-chat'
import type { Registry } from 'prismarine-registry'
import type { Team as TeamInstance } from './types/mineflayer.ts'
import type { TextComponent } from './types/protocol.ts'
import type { ChatLoader } from './types/vendor/prismarine-chat.ts'

function colorString (color: number | undefined): string {
  const formatting = [
    'black',
    'dark_blue',
    'dark_green',
    'dark_aqua',
    'dark_red',
    'dark_purple',
    'gold',
    'gray',
    'dark_gray',
    'blue',
    'green',
    'aqua',
    'red',
    'light_purple',
    'yellow',
    'white',
    'obfuscated',
    'bold',
    'strikethrough',
    'underlined',
    'italic',
    'reset'
  ]
  if (color === undefined || color > 21 || color === -1) return 'reset'
  return formatting[color]!
}

function loader (registry: Registry) {
  const ChatMessage = (prismarineChat as unknown as ChatLoader)(registry)
  const MessageBuilder = ChatMessage.MessageBuilder
  return class Team implements TeamInstance {
    declare team: string
    declare name: ChatMessageInstance
    declare friendlyFire: number
    declare nameTagVisibility: string
    declare collisionRule: string
    declare color: string
    declare prefix: ChatMessageInstance
    declare suffix: ChatMessageInstance
    declare membersMap: { [name: string]: '' }

    constructor (team: string, name: TextComponent, friendlyFire: number, nameTagVisibility: string, collisionRule: string, formatting: number | undefined, prefix: TextComponent, suffix: TextComponent) {
      this.team = team
      this.update(name, friendlyFire, nameTagVisibility, collisionRule, formatting, prefix, suffix)
      this.membersMap = {}
    }

    parseMessage (value: TextComponent): ChatMessageInstance {
      if (registry.supportFeature('teamUsesChatComponents')) { // 1.13+
        return ChatMessage.fromNotch(value)
      } else {
        const result = MessageBuilder.fromString(value as string, { colorSeparator: '§' })
        if (result === null) {
          return new ChatMessage('')
        }
        return new ChatMessage(result.toJSON())
      }
    }

    add (name: string) {
      this.membersMap[name] = ''
      return this.membersMap[name]
    }

    remove (name: string) {
      const removed: '' | undefined = this.membersMap[name]
      delete this.membersMap[name]
      return removed
    }

    update (name: TextComponent, friendlyFire: number, nameTagVisibility: string, collisionRule: string, formatting: number | undefined, prefix: TextComponent, suffix: TextComponent) {
      this.name = this.parseMessage(name)
      this.friendlyFire = friendlyFire
      this.nameTagVisibility = nameTagVisibility
      this.collisionRule = collisionRule
      this.color = colorString(formatting)
      this.prefix = this.parseMessage(prefix)
      this.suffix = this.parseMessage(suffix)
    }

    // Return a chat component with prefix + color + name + suffix
    displayName (member: string): ChatMessageInstance {
      const name = this.prefix.clone()
      name.append(new ChatMessage({ text: member, color: this.color }), this.suffix)
      return name
    }

    get members () {
      return Object.keys(this.membersMap)
    }
  }
}

export default loader
