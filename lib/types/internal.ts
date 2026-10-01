// Members plugins share with each other but that are not part of the public Bot API.
// Public members belong in index.d.ts; this file only adds what the implementation needs.
import type { Vec3 } from 'vec3'
import type { Block } from 'prismarine-block'
import type { Item } from 'prismarine-item'
import type { Entity } from 'prismarine-entity'
import type { Window } from 'prismarine-windows'
import type { Bot, Player } from './mineflayer.ts'
import type { TypedClient } from './protocol.ts'

export interface PlaceOptions {
  /** true: place with the off hand (slot 45) */
  offhand?: boolean
  swingArm?: 'left' | 'right'
  showHand?: boolean
  forceLook?: boolean | 'ignore'
  delta?: Vec3
  half?: 'top' | 'bottom'
}

export interface BotInternal extends Omit<Bot, '_client'> {
  /** packet-typed view of the minecraft-protocol client */
  _client: TypedClient

  _warn: (...message: unknown[]) => void
  /** block_dig / use_item / block_place prediction sequence (1.19+) */
  _nextSequence: () => number
  /** queue a teleport / ping answer for the start of the next physics tick */
  _replyOnNextTick: (reply: () => void) => void
  /** entity ids of the firework rockets attached to the bot (entities plugin) */
  _fireworkRockets: Set<number>
  _placeBlockWithOptions: (referenceBlock: Block, faceVector: Vec3, options: PlaceOptions) => Promise<void>
  _placeEntityWithOptions: (referenceBlock: Block, faceVector: Vec3, options: PlaceOptions) => Promise<Entity>
  _genericPlace: (referenceBlock: Block, faceVector: Vec3, options: PlaceOptions) => Promise<Vec3>
  /** window slot of the first hotbar slot in the player inventory (simple_inventory) */
  QUICK_BAR_START: number
  /** performance.now() of the last block_dig sent, null before any (digging) */
  lastDigTime: number | null
  _ensureHasSentCarriedItem: () => void
  _setSlot: (slotId: number, newItem: Item | null, window?: Window) => void
  /** 1.17.1+: resolves once the server resent the window's items; no-op before */
  _syncWindow: (window: Window) => Promise<void>
  _playerFromUUID: (uuid: string) => Player | undefined
  _getBlockAtEyeLevel: () => Block | null
  /** world name the chunks belong to; undefined before login (only used by tests) */
  _getDimensionName: () => string | undefined
  _updateBlockState: (point: Vec3, stateId: number) => void
}
