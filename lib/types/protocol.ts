// Packet shapes mineflayer reads and writes, merged by hand across every tested version
// (lib/version.ts testedVersions, 1.8.8 – 26.3).
//
// A field present in every version is required. A field that only some versions send is
// optional and carries the version range. A field whose type changed is a union.
// The reference per-version shapes come from mc-zuri/types-minecraft-data run against
// minecraft-data; runtime representations follow minecraft-protocol / protodef:
//  - i64 is read as a [high, low] array whose valueOf() is the bigint (protodef SignedBigInt)
//  - position / lpVec3 / vec3* are plain { x, y, z } numbers
//  - text components are JSON strings before 1.20.3 and anonymous NBT after
import type { Client, PacketMeta, States } from 'minecraft-protocol'
import type { NBT, Tags, TagType } from 'prismarine-nbt'

/** protodef SignedBigInt: [high, low] with valueOf() returning the bigint */
export type Int64 = [number, number] & { valueOf (): bigint }
/** what protodef accepts when writing an i64 */
export type Int64Write = bigint | [number, number] | Int64

/** anonymous NBT (1.20.3+) as decoded by prismarine-nbt */
export type AnonymousNbt = Tags[TagType]
/** chat component: JSON string before 1.20.3, anonymous NBT after */
export type TextComponent = string | AnonymousNbt

export interface Vec3Like { x: number, y: number, z: number }
export type Position = Vec3Like

/** a relative move in 1/4096 block (1.14+; 1/32 before) */
export interface DeltaStep { dX: number, dY: number, dZ: number }
/**
 * 26.3+ entity move (minecraft-protocol `vecDelta`): one delta, or the moves of several batched
 * ticks as chained steps, each relative to the position the previous step left
 */
export type VecDelta = { onGround: boolean } & (DeltaStep | { steps: Array<DeltaStep & { ticks: number }> })
/** 26.3+ sync_entity_position path */
export type PositionPath = Vec3Like | { steps: Array<Vec3Like & { tickOffset: number }> }
/** light section masks: i64 arrays 1.17 – 26.2, byte arrays (BitSet bytes) 26.3+ */
export type LightMask = Int64[] | Buffer

/** item slot, as the three wire formats prismarine-item's fromNotch accepts */
export type Slot =
  // 1.8 – 1.12
  | { blockId: number, itemCount?: number, itemDamage?: number, nbtData?: NBT }
  // 1.13 – 1.20.4
  | { present: boolean, itemId?: number, itemCount?: number, nbtData?: NBT }
  // 1.20.5+ (data components)
  | { itemCount: number, itemId?: number, addedComponentCount?: number, removedComponentCount?: number, components?: SlotComponent[], removeComponents?: Array<{ type: string }> }

export interface SlotComponent { type: string, data: any }

/** 1.21.5+ window_click only sends component hashes */
export interface HashedSlot {
  itemId: number
  itemCount: number
  components: Array<{ type: string, hash: number }>
  removeComponents: Array<{ type: string }>
}

export interface EntityMetadataEntry {
  key: number
  /** type name (1.9+) or id (1.8) */
  type: string | number
  value: any
}

/** 1.21.2+ teleport flags (bitflags); before that a plain bitmask number */
export interface PositionUpdateRelatives {
  _value?: number
  x?: boolean
  y?: boolean
  z?: boolean
  yaw?: boolean
  pitch?: boolean
  dx?: boolean
  dy?: boolean
  dz?: boolean
  yawDelta?: boolean
}

/** 1.21.2+ movement flags */
export interface MovementFlags {
  onGround?: boolean
  hasHorizontalCollision?: boolean | undefined // physics writes undefined
}

export interface GlobalPos { dimensionName: string, location: Position }

/** login / respawn world state (1.20.5+) */
export interface SpawnInfo {
  dimension: number
  name: string
  hashedSeed: Int64
  gamemode: 'survival' | 'creative' | 'adventure' | 'spectator'
  previousGamemode: number
  isDebug: boolean
  isFlat: boolean
  death?: GlobalPos
  portalCooldown: number
  seaLevel?: number // 1.21.2+
}

export type SoundHolder = { soundId: number, data?: undefined } | { soundId?: undefined, data: { soundName: string, fixedRange?: number } }

export interface Particle { type: string | number, [key: string]: any }

export interface GameProfileProperty { name: string, value: string, signature?: string }

export interface ChatSession {
  uuid: string
  publicKey: { expireTime: Int64, keyBytes: Buffer, keySignature: Buffer }
}

export interface EntityAttribute {
  /** 1.8 – 1.16 and 1.20.5+ */
  key?: string
  /** 1.17 – 1.20.4 */
  name?: string
  value: number
  modifiers: Array<{ uuid: string, amount: number, operation: number }>
}

export interface PlayerInfoEntry {
  uuid: string
  // 1.8 – 1.19.2
  name?: string
  properties?: GameProfileProperty[]
  ping?: number
  crypto?: { timestamp: Int64, publicKey: Buffer, signature: Buffer }
  // 1.19.3+
  player?: { name: string, properties: GameProfileProperty[] }
  chatSession?: ChatSession
  listed?: number
  latency?: number
  listPriority?: number // 1.21.2+
  showHat?: boolean // 1.21.4+
  // all versions
  gamemode?: number
  displayName?: TextComponent
}

export interface Trade {
  /** Slot before 1.20.5, { itemId, itemCount, components } after */
  inputItem1: Slot | { itemId: number, itemCount: number, components: any }
  outputItem: Slot
  inputItem2?: Slot | { itemId: number, itemCount: number, components: any }
  tradeDisabled: boolean
  nbTradeUses: number
  maximumNbTradeUses: number
  xp?: number // 1.14+
  specialPrice?: number // 1.14+
  priceMultiplier?: number // 1.14+
  demand?: number // 1.14+
}

export interface ClientboundPackets {
  abilities: { flags: number, flyingSpeed: number, walkingSpeed: number }
  /** 1.20.3+ */
  add_resource_pack: { uuid: string, url: string, hash: string, forced: boolean, promptMessage?: AnonymousNbt }
  animation: { entityId: number, animation: number }
  attach_entity: {
    entityId: number
    vehicleId: number
    leash?: boolean // 1.8
  }
  /** 1.8 – 1.13 */
  bed: { entityId: number, location: Position }
  block_action: { location: Position, byte1: number, byte2: number, blockId: number }
  block_break_animation: { entityId: number, location: Position, destroyStage: number }
  block_change: { location: Position, type: number }
  /** 1.9+ */
  boss_bar: { entityUUID: string, action: number, title?: TextComponent, health?: number, color?: number, dividers?: number, flags?: number }
  /** 1.20.2+ */
  chunk_batch_finished: { batchSize: number }
  /** 1.20.2+ */
  chunk_batch_start: {}
  /** 1.17+ */
  clear_titles: { reset: boolean }
  close_window: { windowId: number }
  collect: {
    collectedEntityId: number
    collectorEntityId: number
    pickupItemCount?: number // 1.11+
  }
  craft_progress_bar: { windowId: number, property: number, value: number }
  /** 1.19.4+ */
  damage_event: { entityId: number, sourceTypeId: number, sourceCauseId: number, sourceDirectId: number, sourcePosition?: Vec3Like }
  /** 1.17 only */
  destroy_entity: { entityId: number }
  difficulty: {
    /** number before 1.21.6, name after */
    difficulty: number | 'peaceful' | 'easy' | 'normal' | 'hard'
    difficultyLocked?: boolean // 1.14+
  }
  /** configuration state, 1.20.2+ */
  disconnect: { reason: TextComponent }
  entity_destroy: { entityIds: number[] }
  entity_effect: {
    entityId: number
    effectId: number
    amplifier: number
    duration: number
    /** boolean in 1.8, bit flags 1.9 – 1.20.4 */
    hideParticles?: boolean | number
    factorCodec?: any // 1.19 – 1.20.4
    flags?: number // 1.20.5+
  }
  entity_equipment: {
    entityId: number
    // 1.8 – 1.15
    slot?: number
    item?: Slot
    // 1.16+
    equipments?: Array<{ slot: number, item: Slot }>
  }
  entity_head_rotation: { entityId: number, headYaw: number }
  entity_look: { entityId: number, yaw: number, pitch: number, onGround: boolean }
  entity_metadata: { entityId: number, metadata: EntityMetadataEntry[] }
  entity_move_look: {
    entityId: number
    yaw: number
    pitch: number
    // before 26.3
    dX?: number
    dY?: number
    dZ?: number
    onGround?: boolean
    delta?: VecDelta // 26.3+
  }
  entity_status: { entityId: number, entityStatus: number }
  entity_teleport: {
    entityId: number
    x: number
    y: number
    z: number
    yaw: number
    pitch: number
    onGround: boolean
    // 1.21.2+
    dx?: number
    dy?: number
    dz?: number
    flags?: PositionUpdateRelatives
  }
  /** 1.9+ (1.8: update_attributes) */
  entity_update_attributes: { entityId: number, properties: EntityAttribute[] }
  entity_velocity: { entityId: number, velocity: Vec3Like }
  experience: { experienceBar: number, level: number, totalExperience: number }
  explosion: {
    // 1.8 – 1.21.1: x y z; 1.21.9+: center
    x?: number
    y?: number
    z?: number
    center?: Vec3Like
    radius?: number // all but 1.21.2 – 1.21.8
    // 1.8 – 1.21.1
    affectedBlockOffsets?: Vec3Like[]
    playerMotionX?: number
    playerMotionY?: number
    playerMotionZ?: number
    // 1.21.2+
    playerKnockback?: Vec3Like
    blockCount?: number // 1.21.9+
    playSound?: boolean // 26.3+
    [key: string]: any
  }
  game_state_change: {
    /** number before 1.21.6, name after */
    reason: number | 'no_respawn_block_available' | 'start_raining' | 'stop_raining' | 'change_game_mode' | 'win_game' | 'demo_event' | 'play_arrow_hit_sound' | 'rain_level_change' | 'thunder_level_change' | 'puffer_fish_sting' | 'guardian_elder_effect' | 'immediate_respawn' | 'limited_crafting' | 'level_chunks_load_start'
    gameMode: number
  }
  held_item_slot: { slot: number }
  kick_disconnect: { reason: TextComponent }
  login: {
    entityId: number
    maxPlayers: number
    reducedDebugInfo: boolean
    // 1.8 – 1.20.4 (1.20.5+: inside worldState)
    gameMode?: number
    previousGameMode?: number // 1.16 – 1.20.4
    /** number before 1.16, NBT 1.16 – 1.18; absent 1.19+ (the dimension type is worldType) */
    dimension?: number | any
    difficulty?: number // 1.8 – 1.13
    levelType?: string // 1.8 – 1.15
    viewDistance?: number // 1.14+
    enableRespawnScreen?: boolean // 1.15+
    hashedSeed?: Int64 // 1.15 – 1.20.4
    // 1.16+
    isHardcore?: boolean
    worldNames?: string[]
    dimensionCodec?: any // 1.16 – 1.20.1
    worldName?: string // 1.16 – 1.20.4
    worldType?: string // 1.19 – 1.20.4
    isDebug?: boolean // 1.16 – 1.20.4
    isFlat?: boolean // 1.16 – 1.20.4
    simulationDistance?: number // 1.18+
    death?: GlobalPos // 1.19 – 1.20.4
    portalCooldown?: number // 1.20 – 1.20.4
    doLimitedCrafting?: boolean // 1.20.2+
    worldState?: SpawnInfo // 1.20.5+
    onlineMode?: boolean // 26.3+
    enforcesSecureChat?: boolean // 1.20.5+
  }
  map_chunk: {
    x: number
    z: number
    chunkData: Buffer
    // 1.8 – 1.16
    groundUp?: boolean
    /** number before 1.17, i64 array 1.17 */
    bitMap?: number | Int64[]
    heightmaps?: any // 1.14+
    biomes?: number[] // 1.15 – 1.17
    blockEntities?: any[] // 1.9+
    // 1.18+ light data
    trustEdges?: boolean // 1.18 – 1.19.4
    skyLightMask?: LightMask
    blockLightMask?: LightMask
    emptySkyLightMask?: LightMask
    emptyBlockLightMask?: LightMask
    skyLight?: number[][]
    blockLight?: number[][]
  }
  /** 1.8 */
  map_chunk_bulk: { skyLightSent: boolean, meta: Array<{ x: number, z: number, bitMap: number }>, data: Buffer }
  multi_block_change: {
    // 1.8 – 1.15
    chunkX?: number
    chunkZ?: number
    /** objects before 1.16; varlong (1.16+), which minecraft-protocol reads as a number */
    records: Array<{ horizontalPos: number, y: number, blockId: number }> | number[]
    // 1.16+
    chunkCoordinates?: Vec3Like
    notTrustEdges?: boolean // 1.16 – 1.19
    suppressLightUpdates?: boolean // 1.19.1 – 1.19.4
  }
  /** 1.8 – 1.20.1 */
  named_entity_spawn: {
    entityId: number
    playerUUID: string
    x: number
    y: number
    z: number
    yaw: number
    pitch: number
    currentItem?: number // 1.8
    metadata?: EntityMetadataEntry[] // 1.8 – 1.14
  }
  /** 1.8 – 1.19.2 */
  named_sound_effect: {
    soundName: string
    soundCategory?: number // 1.9+
    x: number
    y: number
    z: number
    volume: number
    pitch: number
    seed?: Int64 // 1.19+
  }
  /** 1.14+ */
  open_horse_window: { windowId: number, nbSlots: number, entityId: number }
  open_sign_entity: {
    location: Position
    isFrontText?: boolean // 1.20+
  }
  open_window: {
    windowId: number
    /** string before 1.14 */
    inventoryType: number | string
    windowTitle: TextComponent
    slotCount?: number // 1.8 – 1.13
    entityId?: number // 1.8 – 1.13
  }
  /** 1.17+ */
  ping: { id: number }
  player_info: {
    /** action name before 1.19.3, flag set after */
    action: 'add_player' | 'update_game_mode' | 'update_latency' | 'update_display_name' | 'remove_player' | number |
    { add_player?: boolean, initialize_chat?: boolean, update_game_mode?: boolean, update_listed?: boolean, update_latency?: boolean, update_display_name?: boolean, update_hat?: boolean, update_list_order?: boolean, _value?: number }
    data: PlayerInfoEntry[]
  }
  playerlist_header: { header: TextComponent, footer: TextComponent }
  /** 1.19.3+ */
  player_remove: { players: string[] }
  /** 1.21.2+ */
  player_rotation: {
    yaw: number
    pitch: number
    // 1.21.9+
    relativeYaw?: boolean
    relativePitch?: boolean
  }
  position: {
    x: number
    y: number
    z: number
    yaw: number
    pitch: number
    /** bitmask before 1.20.5, bitflags after */
    flags: number | PositionUpdateRelatives
    teleportId?: number // 1.9+
    dismountVehicle?: boolean // 1.17 – 1.19.3
    // 1.21.2+
    dx?: number
    dy?: number
    dz?: number
  }
  /** configuration state, 1.20.2+ */
  registry_data: {
    codec?: AnonymousNbt // 1.20.2 – 1.20.4
    // 1.20.5+
    id?: string
    entries?: Array<{ key: string, value?: AnonymousNbt }>
  }
  rel_entity_move: {
    entityId: number
    // before 26.3
    dX?: number
    dY?: number
    dZ?: number
    onGround?: boolean
    delta?: VecDelta // 26.3+
  }
  remove_entity_effect: { entityId: number, effectId: number }
  /** 1.20.3+ */
  remove_resource_pack: { uuid?: string }
  /** 1.20.3+ (before: scoreboard_score action 1); no objective_name resets every objective */
  reset_score: { entity_name: string, objective_name?: string }
  /** 1.8 – 1.20.2 */
  resource_pack_send: {
    url: string
    hash: string
    forced?: boolean // 1.17+
    promptMessage?: string // 1.17+
  }
  respawn: {
    // 1.8 – 1.20.4 (1.20.5+: inside worldState)
    /** number before 1.16, NBT 1.16 – 1.18, name 1.19+ */
    dimension?: number | string | any
    difficulty?: number // 1.8 – 1.13
    gamemode?: number
    levelType?: string // 1.8 – 1.15
    hashedSeed?: Int64 // 1.15+
    worldName?: string // 1.16+
    previousGamemode?: number
    isDebug?: boolean
    isFlat?: boolean
    death?: GlobalPos // 1.19+
    portalCooldown?: number // 1.20+
    /** boolean 1.16 – 1.20.4, bit flags 1.20.5+ */
    copyMetadata?: boolean | number
    worldState?: SpawnInfo // 1.20.5+
  }
  scoreboard_display_objective: { position: number, name: string }
  scoreboard_objective: {
    name: string
    action: number
    displayText?: TextComponent
    /** string before 1.13 */
    type?: number | string
    // 1.20.3+
    number_format?: number
    styling?: AnonymousNbt
  }
  scoreboard_score: {
    itemName: string
    scoreName: string
    action?: number // before 1.20.3
    value?: number
    // 1.20.3+
    display_name?: AnonymousNbt
    number_format?: number
    styling?: AnonymousNbt
  }
  /** 1.8 (1.9+: teams) */
  scoreboard_team: { team: string, mode: number, name?: string, prefix?: string, suffix?: string, friendlyFire?: number, nameTagVisibility?: string, color?: number, players?: string[] }
  /** 1.9+ */
  set_cooldown: {
    itemID?: number // 1.9 – 1.21.1
    cooldownGroup?: string // 1.21.2+
    cooldownTicks: number
  }
  /** 1.9+ */
  set_passengers: { entityId: number, passengers: number[] }
  /** 1.21.2+ */
  set_player_inventory: { slotId: number, contents: Slot }
  set_slot: {
    windowId: number
    stateId?: number // 1.17+
    slot: number
    item: Slot
  }
  /** 1.17+ */
  set_title_subtitle: { text: TextComponent }
  /** 1.17+ */
  set_title_text: { text: TextComponent }
  /** 26.3+: arm swings (before: animation 0 / 3) */
  swing_animation: { entityId: number, hand: 'main_hand' | 'off_hand', animation: 'none' | 'whack' | 'stab', duration: number }
  /** 1.17+ */
  set_title_time: { fadeIn: number, stay: number, fadeOut: number }
  /** 1.9+ */
  sound_effect: {
    /** 1.9 – 1.19.2 */
    soundId?: number
    /** 1.19.3+ */
    sound?: SoundHolder
    /** number before 1.19.3, name after */
    soundCategory: number | string
    x: number
    y: number
    z: number
    volume: number
    pitch: number
    seed?: Int64 // 1.19+
  }
  spawn_entity: {
    entityId: number
    objectUUID?: string // 1.9+
    type: number
    x: number
    y: number
    z: number
    pitch: number
    yaw: number
    headPitch?: number // 1.19+
    objectData: number
    /** optional in 1.8 */
    velocity?: Vec3Like
  }
  /** 1.8 – 1.21.4 */
  spawn_entity_experience_orb: { entityId: number, x: number, y: number, z: number, count: number }
  /** 1.8 – 1.18 */
  spawn_entity_living: {
    entityId: number
    entityUUID?: string // 1.9+
    type: number
    x: number
    y: number
    z: number
    yaw: number
    pitch: number
    headPitch: number
    velocity: Vec3Like
    metadata?: EntityMetadataEntry[] // 1.8 – 1.14
  }
  /** 1.8 – 1.18 */
  spawn_entity_painting: {
    entityId: number
    entityUUID?: string // 1.9+
    /** name before 1.13, id after */
    title: string | number
    location: Position
    direction: number
  }
  /** 1.8 – 1.15 */
  spawn_entity_weather: { entityId: number, type: number, x: number, y: number, z: number }
  spawn_position: {
    // 1.8 – 1.21.8
    location?: Position
    angle?: number // 1.17 – 1.21.8
    // 1.21.9+
    globalPos?: GlobalPos
    yaw?: number
    pitch?: number
  }
  /** 1.20.2+ */
  start_configuration: {}
  statistics: {
    entries: Array<{
      name?: string // 1.8 – 1.12
      categoryId?: number // 1.13+
      statisticId?: number // 1.13+
      value: number
    }>
  }
  /** 1.21.2+ */
  sync_entity_position: {
    entityId: number
    yaw: number
    pitch: number
    onGround: boolean
    // 1.21.2 – 26.2
    x?: number
    y?: number
    z?: number
    dx?: number
    dy?: number
    dz?: number
    // 26.3+
    pathType?: 'linear' | 'stepped'
    path?: PositionPath
  }
  /** 1.9+ (1.8: scoreboard_team) */
  teams: {
    team: string
    /** number before 1.21.6, name after */
    mode: number | 'add' | 'remove' | 'change' | 'join' | 'leave'
    name?: TextComponent
    /** number before 1.21.6 */
    friendlyFire?: number
    /** 1.21.6+ */
    flags?: { friendly_fire?: boolean, see_friendly_invisible?: boolean, _value?: number }
    /** string before 1.21.5, id in 1.21.5, name 1.21.6+ */
    nameTagVisibility?: string | number
    collisionRule?: string | number
    color?: number // 1.9 – 1.12
    formatting?: number // 1.13+
    prefix?: TextComponent
    suffix?: TextComponent
    players?: string[]
  }
  /** answer to the serverbound tab_complete */
  tab_complete: {
    /** strings before 1.13 */
    matches: string[] | Array<{ match: string, tooltip?: TextComponent }>
    // 1.13+
    transactionId?: number
    start?: number
    length?: number
  }
  tile_entity_data: { location: Position, action: number, nbtData?: NBT }
  /** 1.8 – 1.16 */
  title: { action: number, text?: string, fadeIn?: number, stay?: number, fadeOut?: number }
  /** 1.14+ */
  trade_list: { windowId: number, trades: Trade[], villagerLevel: number, experience: number, isRegularVillager: boolean, canRestock: boolean }
  /** 1.8 – 1.16 */
  transaction: { windowId: number, action: number, accepted: boolean }
  /** 1.9+ */
  unload_chunk: { chunkX: number, chunkZ: number }
  /** 1.8 (1.9+: entity_update_attributes) */
  update_attributes: { entityId: number, properties: EntityAttribute[] }
  update_health: { health: number, food: number, foodSaturation: number }
  /** 1.14+ */
  update_light: {
    chunkX: number
    chunkZ: number
    trustEdges?: boolean // 1.16 – 1.19.4
    /** number before 1.17, i64 array 1.17 – 26.2, byte array 26.3+ */
    skyLightMask: number | LightMask
    blockLightMask: number | LightMask
    emptySkyLightMask: number | LightMask
    emptyBlockLightMask: number | LightMask
    data?: Buffer // 1.14 – 1.16
    skyLight?: number[][] // 1.17+
    blockLight?: number[][] // 1.17+
  }
  /** 1.8 */
  update_sign: { location: Position, text1: string, text2: string, text3: string, text4: string }
  update_time: {
    age: Int64
    time?: Int64 // before 26.1
    tickDayTime?: boolean // 1.21.2 – 1.21.11
    /** 26.1+ */
    /** totalTicks is a varlong, which minecraft-protocol reads as a plain number */
    clockUpdates?: Array<{ id: number, totalTicks: number, partialTick: number, rate: number }>
  }
  window_items: {
    windowId: number
    stateId?: number // 1.17+
    items: Slot[]
    carriedItem?: Slot // 1.17+
  }
  world_particles: {
    // 1.8 – 1.20.4
    particleId?: number
    particleData?: number
    particles?: number
    data?: any
    // 1.20.5+
    particle?: Particle
    velocityOffset?: number // 1.20.5 – 26.2
    amount?: number
    alwaysShow?: boolean // 1.21.4+
    // 26.3+: one speed per axis
    velocityOffsetX?: number
    velocityOffsetY?: number
    velocityOffsetZ?: number
    randomizationType?: 'default' | 'alternative' | 'alternative_with_speed'
    // all versions
    longDistance: boolean
    x: number
    y: number
    z: number
    offsetX: number
    offsetY: number
    offsetZ: number
  }
}

export interface ServerboundPackets {
  /** 1.8 – 26.2 (26.3+: punch) */
  arm_animation: {
    hand?: number // 1.9+
  }
  /** 26.3+: a main hand swing at nothing; the server swings the arm and resets the attack strength */
  punch: {}
  /** 26.1+ */
  attack: { entityId: number }
  block_dig: {
    status: number
    location: Position
    face: number
    sequence?: number // 1.19+
  }
  block_place: {
    location: Position
    direction: number
    cursorX: number
    cursorY: number
    cursorZ: number
    heldItem?: Slot // 1.8
    hand?: number // 1.9+
    insideBlock?: boolean // 1.14+
    worldBorderHit?: boolean // 1.21.2+
    sequence?: number // 1.19+
  }
  /** 1.20.2+ */
  chunk_batch_received: { chunksPerTick: number }
  client_command: {
    payload?: number // 1.8
    /** number before 26.1, name after */
    actionId?: number | 'perform_respawn' | 'request_stats' | 'request_gamerule_values'
  }
  close_window: { windowId: number }
  custom_payload: { channel: string, data: Buffer }
  /** 1.13+ */
  edit_book: {
    hand: number
    // 1.13 – 1.16
    new_book?: Slot
    signing?: boolean
    // 1.17+
    pages?: string[]
    title?: string
  }
  enchant_item: { windowId: number, enchantment: number }
  entity_action: {
    entityId: number
    /** number before 1.21.6, name after */
    actionId: number | 'leave_bed' | 'start_sprinting' | 'stop_sprinting' | 'start_horse_jump' | 'stop_horse_jump' | 'open_vehicle_inventory' | 'start_elytra_flying'
    jumpBoost: number
  }
  flying: {
    onGround?: boolean // before 1.21.2
    flags?: MovementFlags // 1.21.2+
  }
  held_item_slot: { slotId: number }
  look: {
    yaw: number
    pitch: number
    onGround?: boolean // before 1.21.2
    flags?: MovementFlags // 1.21.2+
  }
  /** 1.13+ */
  name_item: { name: string }
  /** 1.21.2+ */
  player_input: { inputs: { forward?: boolean, backward?: boolean, left?: boolean, right?: boolean, jump?: boolean, shift?: boolean, sprint?: boolean } }
  /** 1.21.4+ */
  player_loaded: {}
  /** 1.17+ */
  pong: { id: number }
  position: {
    x: number
    y: number
    z: number
    onGround?: boolean // before 1.21.2
    flags?: MovementFlags // 1.21.2+
  }
  position_look: {
    x: number
    y: number
    z: number
    yaw: number
    pitch: number
    onGround?: boolean // before 1.21.2
    flags?: MovementFlags // 1.21.2+
  }
  resource_pack_receive: {
    hash?: string // 1.8 – 1.9
    uuid?: string // 1.20.3+
    result: number
  }
  /** 1.13+ */
  select_trade: { slot: number }
  set_creative_slot: { slot: number, item: Slot }
  settings: {
    locale: string
    viewDistance: number
    chatFlags: number
    chatColors: boolean
    skinParts: number
    mainHand?: number // 1.9+
    disableTextFiltering?: boolean // 1.17
    enableTextFiltering?: boolean // 1.18+
    enableServerListing?: boolean // 1.18+
    particleStatus?: 'all' | 'decreased' | 'minimal' // 1.21.2+
  }
  /** 1.8 – 1.21.1 */
  steer_vehicle: { sideways: number, forward: number, jump: number }
  tab_complete: {
    text: string
    block?: Position | undefined // 1.8, an option: undefined writes none
    assumeCommand?: boolean // 1.9 – 1.12
    lookedAtBlock?: Position | undefined // 1.9 – 1.12, an option
    transactionId?: number // 1.13+
  }
  /** 1.9+ */
  /** 1.21.2+: ends a client tick; 26.3+ servers accept one move packet per tick */
  tick_end: {}
  teleport_confirm: {
    teleportId: number
    // 26.3+: the position and rotation (degrees) the client resolved the teleport to
    x?: number
    y?: number
    z?: number
    yaw?: number
    pitch?: number
  }
  /** 1.8 – 1.16 */
  transaction: { windowId: number, action: number, accepted: boolean }
  /** 1.13+ */
  update_command_block: { location: Position, command: string, mode: number, flags: number }
  update_sign: {
    location: Position
    isFrontText?: boolean // 1.20 – 26.2
    slot?: 'back' | 'front' // 26.3+
    text1: string
    text2: string
    text3: string
    text4: string
  }
  use_entity: {
    target: number
    /** 0 interact, 1 attack, 2 interact at; before 26.1 */
    mouse?: number
    x?: number
    y?: number
    z?: number
    /** number before 26.1, name after */
    hand?: number | 'main_hand' | 'off_hand'
    location?: Vec3Like // 26.1+
    sneaking?: boolean // 1.16+
  }
  /** 1.9+ */
  use_item: {
    hand: number
    sequence?: number // 1.19+
    rotation?: { x: number, y: number } // 1.21+
  }
  window_click: {
    windowId: number
    slot: number
    mouseButton: number
    mode: number
    action?: number // 1.8 – 1.16
    item?: Slot // 1.8 – 1.16
    // 1.17+
    stateId?: number
    changedSlots?: Array<{ location: number, item?: Slot | HashedSlot }>
    cursorItem?: Slot | HashedSlot
  }
}

/** events minecraft-protocol emits on the client besides packets */
export interface ClientEvents {
  connect: () => void
  connect_allowed: () => void
  end: (reason: string) => void
  error: (err: Error) => void
  state: (newState: States, oldState: States) => void
  playerChat: (data: PlayerChatEvent) => void
  systemChat: (data: { positionId: 1 | 2, formattedMessage: string }) => void // 2: action bar
  /** every clientbound packet (minecraft-protocol client.js), before its named event */
  packet: (data: unknown, meta: PacketMeta, buffer: Buffer, fullBuffer: Buffer) => void
}

export interface PlayerChatEvent {
  globalIndex?: number
  plainMessage: string
  unsignedContent?: string
  formattedMessage?: string
  /** chat type registry id; 1.21.2+ a registry entry holder: { chatType } or an inline { data } */
  type: number | { chatType?: number, data?: any }
  sender: string
  senderName?: string
  senderTeam?: string
  targetName?: string
  verified?: boolean
  [key: string]: any
}

/** plugin channel names: `namespace:path` (1.13+) or `MC|Name` (before) */
export type ChannelName = `${string}:${string}` | `MC|${string}`

type Listener<P> = (packet: P, meta: PacketMeta) => void

interface TypedClientEvents {
  on<K extends keyof ClientboundPackets> (event: K, listener: Listener<ClientboundPackets[K]>): this
  on<K extends keyof ClientEvents> (event: K, listener: ClientEvents[K]): this
  on (event: ChannelName, listener: (data: any) => void): this
  once<K extends keyof ClientboundPackets> (event: K, listener: Listener<ClientboundPackets[K]>): this
  once<K extends keyof ClientEvents> (event: K, listener: ClientEvents[K]): this
  once (event: ChannelName, listener: (data: any) => void): this
  prependListener<K extends keyof ClientboundPackets> (event: K, listener: Listener<ClientboundPackets[K]>): this
  prependListener<K extends keyof ClientEvents> (event: K, listener: ClientEvents[K]): this
  removeListener<K extends keyof ClientboundPackets> (event: K, listener: Listener<ClientboundPackets[K]>): this
  removeListener<K extends keyof ClientEvents> (event: K, listener: ClientEvents[K]): this
  removeListener (event: ChannelName, listener: (data: any) => void): this
  off<K extends keyof ClientboundPackets> (event: K, listener: Listener<ClientboundPackets[K]>): this
  off<K extends keyof ClientEvents> (event: K, listener: ClientEvents[K]): this
  emit<K extends keyof ClientboundPackets> (event: K, packet: ClientboundPackets[K], meta?: PacketMeta): boolean
  emit<K extends keyof ClientEvents> (event: K, ...args: Parameters<ClientEvents[K]>): boolean
  write<K extends keyof ServerboundPackets> (name: K, params: ServerboundPackets[K]): void
}

/** set by minecraft-protocol plugins (autoVersion) that delay the connection */
interface ClientExtras {
  wait_connect?: boolean
}

/** minecraft-protocol Client with packet-typed events and write */
export type TypedClient = Omit<Client, keyof TypedClientEvents> & TypedClientEvents & ClientExtras
