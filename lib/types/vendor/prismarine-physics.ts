// prismarine-physics ships no typings. Ambient declaration (this file has no top-level import/export)
// of what mineflayer uses, from prismarine-physics/index.js (the vanilla-parity Java engine).
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

  /** an attribute as the engine reads it: keyed by minecraft-data's resource name */
  export interface PhysicsAttribute {
    value: number
    modifiers: Array<{ uuid: string, amount: number, operation: number }>
  }

  /** another entity near the player: solid ones (boats, shulkers) collide, mobs push */
  export interface PhysicsEntity {
    id: number
    /** the entity name, e.g. 'oak_boat', 'boat', 'shulker', 'zombie' */
    type: string
    pos: Vec3
    vel?: Vec3
    /** [minX, minY, minZ, maxX, maxY, maxZ] when known; else from the type's size */
    box?: [number, number, number, number, number, number]
  }

  /** a piston head moving next to the player (a block_action) */
  export interface PhysicsPiston {
    x: number
    y: number
    z: number
    dir: [number, number, number]
    extending: boolean
    progress: number
  }

  /** the vehicle the player rides, as the engine keeps it from tick to tick */
  export interface PhysicsVehicle {
    id: number
    /** the entity name: boats and rafts, horse, donkey, mule, skeleton_horse, zombie_horse, camel, pig, strider, minecarts */
    type: string
    pos: Vec3
    vel: Vec3
    /** vanilla degrees */
    yaw: number
    pitch: number
    onGround: boolean
    /** boats: the rotation speed, kept by the engine */
    deltaRotation?: number
    landFriction?: number
    status?: string
    waterLevel?: number
    /** boats: the keys of the rider's last tick */
    input?: { left: boolean, right: boolean, up: boolean, down: boolean }
    /** mounts: the movement_speed / jump_strength attributes */
    movementSpeed?: number
    jumpStrength?: number
    stepHeight?: number
    /** a pig or strider steered with its stick */
    steered?: boolean
    jumpRidingScale?: number
    [engineState: string]: unknown
  }

  /** the parts of a mineflayer bot PlayerState reads and apply() writes */
  export interface PhysicsBot {
    version: string
    registry?: IndexedData
    entity: Entity
    jumpTicks: number
    jumpQueued: boolean
    fireworkRocketDuration: number
    autoJump?: boolean
    autoJumpTime?: number
    jumpRidingTicks?: number
    usingHeldItem?: boolean
    food?: number
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
    /** how many firework rockets boost the glide this tick (each attached rocket boosts once) */
    fireworkRockets?: number
    attributes: { [resource: string]: PhysicsAttribute } | undefined
    yaw: number
    pitch: number
    /** vanilla degrees; the engine sets yawDegrees when a boat turns its rider */
    yawDegrees?: number
    control: PlayerControls
    jumpBoost: number
    speed: number
    slowness: number
    dolphinsGrace: number
    slowFalling: number
    levitation: number
    blindness: number
    depthStrider: number
    elytraEquipped: boolean
    // the vanilla client's state and inputs
    sprinting: boolean
    sprintTriggerTime: number
    jumpTriggerTime: number
    flying: boolean
    mayFly: boolean
    flySpeed: number | undefined
    gameMode: string | undefined
    autoJump: boolean
    usingItem: boolean
    food: number | undefined
    riptideLaunch: number
    /** riptide works in rain too */
    inRain?: boolean
    entities?: PhysicsEntity[]
    pistons?: PhysicsPiston[]
    vehicle: PhysicsVehicle | undefined
    apply (bot: PhysicsBot): void
  }
}
