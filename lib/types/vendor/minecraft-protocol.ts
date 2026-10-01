// minecraft-protocol's d.ts requires customPackets in createSerializer/createDeserializer and takes the state only
// as its States enum; src/transforms/serializer.js defaults every option (customPackets is optional) and the
// states are plain strings ('play', 'configuration', ...).
// Its Client listeners must return void | Promise<void>, but EventEmitter ignores what a listener returns, so a
// listener such as `(data) => seen.push(data)` is fine (TypedClient, the bot's packet-typed view, has its own on/once).
// Server lacks once('playerJoin').
import type { States } from 'minecraft-protocol'

interface LooseSerializerOptions {
  state?: States | `${States}`
  isServer?: boolean
  version: string
  customPackets?: any
  compiled?: boolean
}

declare module 'minecraft-protocol' {
  interface Client {
    on (event: string, handler: (data: any, packetMeta: PacketMeta) => unknown): this
    once (event: string, handler: (data: any, packetMeta: PacketMeta) => unknown): this
  }
  interface Server {
    once (event: 'playerJoin', handler: (client: ServerClient) => void): this
  }
  export function createSerializer (options: LooseSerializerOptions): any
  export function createDeserializer (options: LooseSerializerOptions & { noErrorLogging?: boolean }): any
}
