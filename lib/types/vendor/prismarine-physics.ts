// prismarine-physics ships no typings. Ambient declaration (this file has no top-level import/export)
// of what mineflayer uses, from prismarine-physics/index.js 1.11.
declare module 'prismarine-physics' {
  import type { Vec3 } from 'vec3'
  import type { Block } from 'prismarine-block'
  import type { Entity } from 'prismarine-entity'
  import type { Item } from 'prismarine-item'
  import type { IndexedData } from 'minecraft-data'

  export interface PhysicsWorld {
    getBlock (pos: Vec3): Block | null
  }

  interface BubbleColumnDrag { down: number, maxDown: number, up: number, maxUp: number }

  export interface PhysicsEngine {
    gravity: number
    airdrag: number
    yawSpeed: number
    pitchSpeed: number
    playerSpeed: number
    sprintSpeed: number
    sneakSpeed: number
    stepHeight: number
    negligeableVelocity: number
    soulsandSpeed: number
    honeyblockSpeed: number
    honeyblockJumpSpeed: number
    ladderMaxSpeed: number
    ladderClimbSpeed: number
    playerHalfWidth: number
    playerHeight: number
    waterInertia: number
    lavaInertia: number
    liquidAcceleration: number
    airborneInertia: number
    airborneAcceleration: number
    defaultSlipperiness: number
    outOfLiquidImpulse: number
    autojumpCooldown: number
    bubbleColumnSurfaceDrag: BubbleColumnDrag
    bubbleColumnDrag: BubbleColumnDrag
    slowFalling: number
    movementSpeedAttribute: string
    sprintingUUID: string
    waterGravity: number
    lavaGravity: number
    adjustPositionHeight (pos: Vec3): void
    simulatePlayer (state: PlayerState, world: PhysicsWorld): PlayerState
  }

  export interface PlayerControls {
    forward: boolean
    back: boolean
    left: boolean
    right: boolean
    jump: boolean
    sprint: boolean
    sneak: boolean
  }

  /** the parts of a mineflayer bot PlayerState reads and apply() writes */
  export interface PhysicsBot {
    version: string
    entity: Entity
    jumpTicks: number
    jumpQueued: boolean
    fireworkRocketDuration: number
    inventory: { slots: Array<Item | null> }
  }

  export function Physics (mcData: IndexedData, world: PhysicsWorld): PhysicsEngine

  export class PlayerState {
    constructor (bot: PhysicsBot, control: PlayerControls)
    pos: Vec3
    vel: Vec3
    onGround: boolean
    isInWater: boolean
    isInLava: boolean
    isInWeb: boolean
    isCollidedHorizontally: boolean
    isCollidedVertically: boolean
    elytraFlying: boolean
    jumpTicks: number
    jumpQueued: boolean
    fireworkRocketDuration: number
    attributes: Entity['attributes']
    yaw: number
    pitch: number
    control: PlayerControls
    jumpBoost: number
    speed: number
    slowness: number
    dolphinsGrace: number
    slowFalling: number
    levitation: number
    depthStrider: number
    elytraEquipped: boolean
    apply (bot: PhysicsBot): void
  }
}
