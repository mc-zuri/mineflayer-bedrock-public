// prismarine-chat's d.ts (1.13) types the loader as taking only a version string, the constructor
// as taking only strings / MessageBuilders and fromNotch as taking only a string. At runtime the
// loader takes a registry, the constructor takes any JSON chat component and fromNotch takes a
// JSON string or (1.20.3+) an anonymous NBT component. Cast the default export to ChatLoader:
//   const ChatMessage = (prismarineChat as unknown as ChatLoader)(bot.registry)
import type { ChatMessage } from 'prismarine-chat'
import type { Registry } from 'prismarine-registry'
import type { TextComponent } from '../protocol.ts'

export interface ChatMessageClass {
  new (message: string | number | object | object[], displayWarning?: boolean): ChatMessage
  fromNotch (msg: TextComponent): ChatMessage
  fromNetwork (messageType: number, parameters: Record<string, object>): ChatMessage
  MessageBuilder: typeof ChatMessage.MessageBuilder
}

export type ChatLoader = (registryOrVersion: Registry | string) => ChatMessageClass

declare module 'prismarine-chat' {
  interface ChatMessage {
    /** 1.19 – 1.19.2 playerChat: the unsigned (server-modified) content, set by the chat plugin */
    unsigned?: ChatMessage
  }
}
