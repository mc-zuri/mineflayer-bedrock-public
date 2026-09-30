import type TypedEmitter from 'typed-emitter'
import type { Client, ClientOptions } from 'minecraft-protocol'
import type { Vec3 } from 'vec3'
import type { Item } from 'prismarine-item'
import type { Window } from 'prismarine-windows'
import type { Recipe } from 'prismarine-recipe'
import type { Block } from 'prismarine-block'
import type { Entity } from 'prismarine-entity'
import type { ChatMessage } from 'prismarine-chat'
import type { world } from 'prismarine-world'
import type { Registry } from 'prismarine-registry'
import type { IndexedData, SupportsFeature } from 'minecraft-data'
import type { ChatSession, ClientboundPackets, TextComponent } from './protocol.ts'
import type { RaycastHitBlock, RaycastMatcher } from './vendor/prismarine-world.ts'
import type {} from './vendor/prismarine-entity.ts' // Entity members mineflayer adds

export declare function createBot (options: { client: Client } & Partial<BotOptions>): Bot
export declare function createBot (options: BotOptions): Bot

export interface BotOptions extends Omit<ClientOptions, 'version'> {
  logErrors?: boolean
  hideErrors?: boolean
  loadInternalPlugins?: boolean
  plugins?: PluginOptions
  chat?: ChatLevel
  colorsEnabled?: boolean
  viewDistance?: ViewDistance
  mainHand?: MainHands
  difficulty?: number
  chatLengthLimit?: number
  physicsEnabled?: boolean
  /** @default 4 */
  maxCatchupTicks?: number
  client?: Client | null
  /** false (the default) detects the server version */
  version?: string | false
  brand?: string
  defaultChatPatterns?: boolean
  respawn?: boolean
}

export type ChatLevel = 'enabled' | 'commandsOnly' | 'disabled'
export type ViewDistance = 'far' | 'normal' | 'short' | 'tiny' | number
export type MainHands = 'left' | 'right'

export interface PluginOptions {
  [plugin: string]: boolean | Plugin
}

export type Plugin = (bot: Bot, options: BotOptions) => void

export interface BotEvents {
  /** node EventEmitter: a listener is about to be added */
  newListener: (event: string | symbol, listener: (...args: any[]) => void) => void
  /** node EventEmitter: a listener was removed */
  removeListener: (event: string | symbol, listener: (...args: any[]) => void) => void
  chat: (
    username: string,
    message: string,
    translate: string | null,
    jsonMsg: ChatMessage,
    matches: string[] | null
  ) => Promise<void> | void
  whisper: (
    username: string,
    message: string,
    translate: string | null,
    jsonMsg: ChatMessage,
    matches: string[] | null
  ) => Promise<void> | void
  actionBar: (jsonMsg: ChatMessage) => Promise<void> | void
  error: (err: Error) => Promise<void> | void
  message: (jsonMsg: ChatMessage, position: string) => Promise<void> | void
  messagestr: (message: string, position: string, jsonMsg: ChatMessage) => Promise<void> | void
  unmatchedMessage: (stringMsg: string, jsonMsg: ChatMessage) => Promise<void> | void
  inject_allowed: () => Promise<void> | void
  connect: () => Promise<void> | void
  login: () => Promise<void> | void
  /** When `respawn` option is disabled, you can call this method manually to respawn. */
  spawn: () => Promise<void> | void
  respawn: () => Promise<void> | void
  game: () => Promise<void> | void
  title: (text: string, type: 'subtitle' | 'title') => Promise<void> | void
  rain: () => Promise<void> | void
  time: () => Promise<void> | void
  kicked: (reason: string, loggedIn: boolean) => Promise<void> | void
  end: (reason: string) => Promise<void> | void
  spawnReset: () => Promise<void> | void
  death: () => Promise<void> | void
  health: () => Promise<void> | void
  breath: () => Promise<void> | void
  abilities: (abilities: Abilities) => Promise<void> | void
  entitySwingArm: (entity: Entity) => Promise<void> | void
  /** source only from damage_event (1.19.4+), when the server names a known entity */
  entityHurt: (entity: Entity, source?: Entity) => Promise<void> | void
  entityDead: (entity: Entity) => Promise<void> | void
  entityTaming: (entity: Entity) => Promise<void> | void
  entityTamed: (entity: Entity) => Promise<void> | void
  entityShakingOffWater: (entity: Entity) => Promise<void> | void
  entityEatingGrass: (entity: Entity) => Promise<void> | void
  entityHandSwap: (entity: Entity) => Promise<void> | void
  entityWake: (entity: Entity) => Promise<void> | void
  entityEat: (entity: Entity) => Promise<void> | void
  entityCriticalEffect: (entity: Entity) => Promise<void> | void
  entityMagicCriticalEffect: (entity: Entity) => Promise<void> | void
  entityCrouch: (entity: Entity) => Promise<void> | void
  entityUncrouch: (entity: Entity) => Promise<void> | void
  entityEquip: (entity: Entity) => Promise<void> | void
  entitySleep: (entity: Entity) => Promise<void> | void
  entitySpawn: (entity: Entity) => Promise<void> | void
  entityElytraFlew: (entity: Entity) => Promise<void> | void
  usedFirework: (fireworkEntityId: number) => Promise<void> | void
  itemDrop: (entity: Entity) => Promise<void> | void
  playerCollect: (collector: Entity, collected: Entity) => Promise<void> | void
  entityAttributes: (entity: Entity) => Promise<void> | void
  entityGone: (entity: Entity) => Promise<void> | void
  entityMoved: (entity: Entity) => Promise<void> | void
  entityDetach: (entity: Entity, vehicle: Entity | null) => Promise<void> | void
  entityAttach: (entity: Entity, vehicle: Entity) => Promise<void> | void
  entityUpdate: (entity: Entity) => Promise<void> | void
  entityEffect: (entity: Entity, effect: Effect) => Promise<void> | void
  entityEffectEnd: (entity: Entity, effect: Effect) => Promise<void> | void
  playerJoined: (player: Player) => Promise<void> | void
  playerUpdated: (player: Player) => Promise<void> | void
  playerLeft: (entity: Player) => Promise<void> | void
  blockUpdate: (oldBlock: Block | null, newBlock: Block) => Promise<void> | void
  /** `blockUpdate:(x, y, z)` with the block's integer position; (null, null) when the world is switched */
  [event: `blockUpdate:${string}`]: (oldBlock: Block | null, newBlock: Block | null) => Promise<void> | void
  blockEntityData: (block: Block | null) => Promise<void> | void
  signOpen: (block: Block | null) => Promise<void> | void
  chunkColumnLoad: (entity: Vec3) => Promise<void> | void
  chunkColumnUnload: (entity: Vec3) => Promise<void> | void
  soundEffectHeard: (
    soundName: string,
    position: Vec3,
    volume: number,
    pitch: number
  ) => Promise<void> | void
  hardcodedSoundEffectHeard: (
    soundId: number,
    soundCategory: number,
    position: Vec3,
    volume: number,
    pitch: number
  ) => Promise<void> | void
  noteHeard: (block: Block, instrument: Instrument, pitch: number) => Promise<void> | void
  pistonMove: (block: Block, isPulling: number, direction: number) => Promise<void> | void
  chestLidMove: (block: Block, isOpen: number, block2: Block | null) => Promise<void> | void
  blockBreakProgressObserved: (block: Block, destroyStage: number) => Promise<void> | void
  blockBreakProgressEnd: (block: Block) => Promise<void> | void
  diggingCompleted: (block: Block) => Promise<void> | void
  diggingAborted: (block: Block) => Promise<void> | void
  move: (position: Vec3) => Promise<void> | void
  forcedMove: () => Promise<void> | void
  mount: () => Promise<void> | void
  dismount: (vehicle: Entity | null) => Promise<void> | void
  windowOpen: (window: Window) => Promise<void> | void
  windowClose: (window: Window) => Promise<void> | void
  sleep: () => Promise<void> | void
  wake: () => Promise<void> | void
  experience: () => Promise<void> | void
  physicsTick: () => Promise<void> | void
  physicTick: () => Promise<void> | void
  scoreboardCreated: (scoreboard: ScoreBoard) => Promise<void> | void
  scoreboardDeleted: (scoreboard: ScoreBoard) => Promise<void> | void
  scoreboardTitleChanged: (scoreboard: ScoreBoard) => Promise<void> | void
  scoreUpdated: (scoreboard: ScoreBoard, item: ScoreBoardItem) => Promise<void> | void
  scoreRemoved: (scoreboard: ScoreBoard, item: ScoreBoardItem | undefined) => Promise<void> | void
  /** position is the numeric display slot; previous is the objective it replaced */
  scoreboardPosition: (position: number, scoreboard: ScoreBoard, previous: ScoreBoard | undefined) => Promise<void> | void
  teamCreated: (team: Team) => Promise<void> | void
  teamRemoved: (team: Team) => Promise<void> | void
  teamUpdated: (team: Team) => Promise<void> | void
  teamMemberAdded: (team: Team) => Promise<void> | void
  teamMemberRemoved: (team: Team) => Promise<void> | void
  bossBarCreated: (bossBar: BossBar) => Promise<void> | void
  bossBarDeleted: (bossBar: BossBar) => Promise<void> | void
  bossBarUpdated: (bossBar: BossBar) => Promise<void> | void
  resourcePack: (url: string, hash?: string, uuid?: string) => Promise<void> | void
  heldItemChanged: (newItem: Item | null) => Promise<void> | void
  // per-window events of the inventory plugin, keyed by window id / click action number
  /** window_items for that window was applied */
  [event: `setWindowItems:${number}`]: () => Promise<void> | void
  /** set_slot (or set_player_inventory) for that window was applied */
  [event: `setSlot:${number}`]: (oldItem: Item | null, newItem: Item | null) => Promise<void> | void
  /** the server accepted (true) or rejected (false) that click; 1.8 – 1.16 */
  [event: `confirmTransaction${number}`]: (accepted: boolean) => Promise<void> | void
  particle: (particle: Particle) => Promise<void> | void
}

export interface CommandBlockOptions {
  mode: number,
  trackOutput: boolean,
  conditional: boolean,
  alwaysActive: boolean
}

export interface Bot extends TypedEmitter<BotEvents> {
  username: string
  protocolVersion: number
  majorVersion: string
  version: string
  entity: Entity
  entities: { [id: string]: Entity }
  /** the entity the bot rides, null when not riding */
  vehicle: Entity | null
  fireworkRocketDuration: number
  /** set by physics for prismarine-physics: a jump is requested */
  jumpQueued: boolean
  /** set by physics for prismarine-physics: autojump cooldown ticks */
  jumpTicks: number
  spawnPoint: Vec3
  game: GameState
  player: Player
  players: { [username: string]: Player }
  uuidToUsername: { [uuid: string]: string }
  isRaining: boolean
  thunderState: number
  chatPatterns: ChatPattern[]
  settings: GameSettings
  experience: Experience
  health: number
  /** false from death (or a respawn packet) until health is above 0 again (health plugin) */
  isAlive: boolean
  food: number
  foodSaturation: number
  oxygenLevel: number
  physics: PhysicsOptions
  physicsEnabled: boolean
  abilities: Abilities
  time: Time
  quickBarSlot: number
  inventory: Window<StorageEvents>
  targetDigBlock: Block | null
  /** face sent in the current block_dig; null when not digging */
  targetDigFace: number | null
  /** performance.now() of the last finished or aborted dig */
  lastDigTime: number | null
  isSleeping: boolean
  scoreboards: { [name: string]: ScoreBoard }
  scoreboard: ScoreBoardPositions
  teams: { [name: string]: Team }
  teamMap: { [name: string]: Team }
  controlState: ControlStateStatus
  creative: creativeMethods
  world: world.WorldSync
  _client: Client
  heldItem: Item | null
  usingHeldItem: boolean
  currentWindow: Window | null
  simpleClick: simpleClick
  tablist: Tablist
  registry: Registry

  connect: (options: BotOptions) => void

  supportFeature: IndexedData['supportFeature']

  end: (reason?: string) => void

  blockAt: (point: Vec3, extraInfos?: boolean) => Block | null

  /** @deprecated use blockAtCursor */
  blockInSight: (maxSteps?: number, vectorLength?: number) => RaycastHitBlock | undefined

  /** face and intersect are only set when no matcher is given */
  blockAtCursor: (maxDistance?: number, matcher?: RaycastMatcher | null) => RaycastHitBlock | null
  blockAtEntityCursor: (entity?: Entity, maxDistance?: number, matcher?: RaycastMatcher | null) => RaycastHitBlock | null

  canSeeBlock: (block: Block) => boolean

  findBlock: (options: FindBlockOptions) => Block | null

  findBlocks: (options: FindBlockOptions) => Vec3[]

  canDigBlock: (block: Block) => boolean

  recipesFor: (
    itemType: number,
    metadata: number | null,
    minResultCount: number | null,
    craftingTable: Block | boolean | null
  ) => Recipe[]

  recipesAll: (
    itemType: number,
    metadata: number | null,
    craftingTable: Block | boolean | null
  ) => Recipe[]

  quit: (reason?: string) => void

  tabComplete: (
    str: string,
    assumeCommand?: boolean,
    sendBlockInSight?: boolean,
    timeout?: number
  ) => Promise<string[]>

  chat: (message: string) => void

  whisper: (username: string, message: string) => void

  chatAddPattern: (pattern: RegExp, chatType: string, description?: string) => number

  setSettings: (options: Partial<GameSettings>) => void

  loadPlugin: (plugin: Plugin) => void

  loadPlugins: (plugins: Plugin[]) => void

  hasPlugin: (plugin: Plugin) => boolean

  sleep: (bedBlock: Block) => Promise<void>

  isABed: (bedBlock: Block) => boolean

  parseBedMetadata: (bedBlock: Block) => BedMetadata

  wake: () => Promise<void>

  elytraFly: () => Promise<void>

  setControlState: (control: ControlState, state: boolean) => void

  getControlState: (control: ControlState) => boolean

  clearControlStates: () => void

  getExplosionDamages: (targetEntity: Entity, position: Vec3, radius: number, rawDamages?: boolean) => number | null

  lookAt: (point: Vec3, force?: boolean) => Promise<void>

  look: (
    yaw: number,
    pitch: number,
    force?: boolean
  ) => Promise<void>

  updateSign: (block: Block, text: string, back?: boolean) => void

  equip: (
    item: Item | number,
    destination: EquipmentDestination | null
  ) => Promise<void>

  unequip: (
    destination: EquipmentDestination
  ) => Promise<void>

  tossStack: (item: Item) => Promise<void>

  toss: (
    itemType: number,
    metadata: number | null,
    count: number | null
  ) => Promise<void>

  dig: ((block: Block, forceLook?: boolean | 'ignore') => Promise<void>) & ((block: Block, forceLook: boolean | 'ignore', digFace: 'auto' | Vec3 | 'raycast') => Promise<void>)

  stopDigging: () => void

  digTime: (block: Block) => number

  placeBlock: (referenceBlock: Block, faceVector: Vec3) => Promise<void>

  placeEntity: (referenceBlock: Block, faceVector: Vec3) => Promise<Entity>

  activateBlock: (block: Block, direction?: Vec3, cursorPos?: Vec3) => Promise<void>

  activateEntity: (entity: Entity) => Promise<void>

  activateEntityAt: (entity: Entity, position: Vec3) => Promise<void>

  consume: () => Promise<void>

  fish: () => Promise<void>

  activateItem: (offhand?: boolean) => void

  deactivateItem: () => void

  useOn: (targetEntity: Entity) => void

  attack: (entity: Entity, swing?: boolean) => void

  swingArm: (hand?: 'left' | 'right', showHand?: boolean) => void

  mount: (entity: Entity) => void

  dismount: () => void

  moveVehicle: (left: number, forward: number) => void

  setQuickBarSlot: (slot: number) => void

  craft: (
    recipe: Recipe,
    count?: number,
    craftingTable?: Block
  ) => Promise<void>

  writeBook: (
    slot: number,
    pages: string[]
  ) => Promise<void>

  openContainer: (chest: Block | Entity, direction?: Vec3, cursorPos?: Vec3) => Promise<Chest | Dispenser>

  openChest: (chest: Block | Entity, direction?: Vec3, cursorPos?: Vec3) => Promise<Chest>

  openFurnace: (furnace: Block) => Promise<Furnace>

  openDispenser: (dispenser: Block) => Promise<Dispenser>

  openEnchantmentTable: (enchantmentTable: Block) => Promise<EnchantmentTable>

  openAnvil: (anvil: Block) => Promise<Anvil>

  openVillager: (
    villager: Entity
  ) => Promise<Villager>

  trade: (
    villagerInstance: Villager,
    tradeIndex: string | number,
    times?: number
  ) => Promise<void>

  setCommandBlock: (pos: Vec3, command: string, options: CommandBlockOptions) => void

  clickWindow: (
    slot: number,
    mouseButton: number,
    mode: number
  ) => Promise<void>

  putSelectedItemRange: (
    start: number,
    end: number,
    window: Window,
    /** where leftovers go when the range is full; null tosses them */
    slot: number | null
  ) => Promise<void>

  putAway: (slot: number) => Promise<void>

  closeWindow: (window: Window) => Promise<void>

  transfer: (options: TransferOptions) => Promise<void>

  openBlock: (block: Block, direction?: Vec3, cursorPos?: Vec3) => Promise<Window>

  openEntity: (entity: Entity) => Promise<Window>

  moveSlotItem: (
    sourceSlot: number,
    destSlot: number
  ) => Promise<void>

  updateHeldItem: () => void

  getEquipmentDestSlot: (destination: EquipmentDestination) => number

  waitForChunksToLoad: () => Promise<void>

  entityAtCursor: (maxDistance?: number) => Entity | null
  nearestEntity: (filter?: (entity: Entity) => boolean) => Entity | null
  /** player entities matching filter (null: all); a string filter returns null / one entity / an array */
  findPlayer: FindPlayers
  findPlayers: FindPlayers

  waitForTicks: (ticks: number) => Promise<void>

  addChatPattern: (name: string, pattern: RegExp, options?: chatPatternOptions) => number

  addChatPatternSet: (name: string, patterns: RegExp[], options?: chatPatternOptions) => number

  removeChatPattern: (name: string | number) => void

  awaitMessage: (...args: string[] | RegExp[]) => Promise<string>

  acceptResourcePack: () => void

  denyResourcePack: () => void

  respawn: () => void
}

export interface FindPlayers {
  (filter: string): Entity | Entity[] | null
  (filter: RegExp | ((entity: Entity) => boolean) | null): Entity[]
}

export interface BedMetadata {
  /** true: head, false: foot */
  part: boolean
  /** boolean once parsed; the initial 0 only survives on a version with neither block states nor metadata */
  occupied: boolean | number
  /** 0: south, 1: west, 2: north, 3: east */
  facing: number
  headOffset: Vec3
}

export interface simpleClick {
  leftMouse: (slot: number) => Promise<void>
  rightMouse: (slot: number) => Promise<void>
}

export interface Tablist {
  header: ChatMessage
  footer: ChatMessage
}

export interface chatPatternOptions {
  repeat: boolean
  parse: boolean
}

export interface GameState {
  levelType: LevelType
  gameMode: GameMode
  hardcore: boolean
  dimension: Dimension
  difficulty: Difficulty
  maxPlayers: number
  serverBrand: string
}

export type LevelType =
  | 'default'
  | 'flat'
  | 'largeBiomes'
  | 'amplified'
  | 'customized'
  | 'buffet'
  | 'default_1_1'
export type GameMode = 'survival' | 'creative' | 'adventure' | 'spectator'
export type Dimension = 'the_nether' | 'overworld' | 'the_end'
export type Difficulty = 'peaceful' | 'easy' | 'normal' | 'hard'

export interface Player {
  uuid: string
  username: string
  displayName: ChatMessage
  gamemode: number
  ping: number
  /** undefined when the player's entity is not (yet) known, null once it is gone */
  entity: Entity | null | undefined
  skinData: SkinData | undefined
  /** 1.19 – 1.19.2 */
  profileKeys?: {
    publicKey: Buffer
    signature: Buffer
  }
  /** 1.19.3+ */
  chatSession?: {
    publicKey: ChatSession['publicKey']
    sessionUuid: string
  }
  /** 1.19.3+ */
  listed?: number
}

export interface SkinData {
  url: string
  model: string | undefined
  capeUrl: string | undefined
}

export interface ChatPattern {
  pattern: RegExp
  type: string
  description: string
}

export interface SkinParts {
  showCape: boolean
  showJacket: boolean
  showLeftSleeve: boolean
  showRightSleeve: boolean
  showLeftPants: boolean
  showRightPants: boolean
  showHat: boolean
}

export interface GameSettings {
  chat: ChatLevel
  colorsEnabled: boolean
  viewDistance: ViewDistance
  difficulty: number
  skinParts: SkinParts
  mainHand: MainHands
}

export interface Experience {
  level: number
  points: number
  progress: number
}

export interface Abilities {
  invulnerable: boolean
  flying: boolean
  mayFly: boolean
  instantBuild: boolean
  flyingSpeed: number
  walkingSpeed: number
}

/** the prismarine-physics engine settings (bot.physics) */
export interface PhysicsOptions {
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
  bubbleColumnSurfaceDrag: { down: number, maxDown: number, up: number, maxUp: number }
  bubbleColumnDrag: { down: number, maxDown: number, up: number, maxUp: number }
  slowFalling: number
  movementSpeedAttribute: string
  sprintingUUID: string
  waterGravity: number
  lavaGravity: number
  adjustPositionHeight: (pos: Vec3) => void
}

export interface Time {
  doDaylightCycle: boolean
  bigTime: BigInt
  time: number
  timeOfDay: number
  day: number
  isDay: boolean
  moonPhase: number
  bigAge: BigInt
  age: number
}

export interface ControlStateStatus {
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
  jump: boolean
  sprint: boolean
  sneak: boolean
}

export type ControlState =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'sprint'
  | 'sneak'

export interface Effect {
  id: number
  amplifier: number
  duration: number
}

export interface Instrument {
  id: number
  name: 'harp' | 'doubleBass' | 'snareDrum' | 'sticks' | 'bassDrum'
}

export interface FindBlockOptions {
  point?: Vec3
  matching: number | number[] | ((block: Block) => boolean)
  maxDistance?: number
  count?: number
  useExtraInfo?: boolean | ((block: Block) => boolean)
}

export type EquipmentDestination = 'hand' | 'head' | 'torso' | 'legs' | 'feet' | 'off-hand'

export interface TransferOptions {
  /** defaults to bot.currentWindow, then bot.inventory */
  window?: Window | null
  itemType: number
  /** null / omitted matches any metadata */
  metadata?: number | null
  /** null / omitted means 1 */
  count?: number | null
  /** null / omitted ignores nbt */
  nbt?: Item['nbt']
  sourceStart: number
  /** defaults to sourceStart + 1 */
  sourceEnd?: number | null
  /** -999 tosses the items */
  destStart: number
  /** defaults to destStart + 1 */
  destEnd?: number | null
}

export interface creativeMethods {
  setInventorySlot: (
    slot: number,
    item: Item | null
  ) => Promise<void>

  clearSlot: (slot: number) => Promise<void>

  clearInventory: () => Promise<void>

  flyTo: (destination: Vec3) => Promise<void>

  startFlying: () => void

  stopFlying: () => void
}

export declare class Location {
  floored: Vec3
  blockPoint: Vec3
  chunkCorner: Vec3
  blockIndex: number
  biomeBlockIndex: number
  chunkYIndex: number

  constructor (absoluteVector: Vec3)
}

export declare class Painting {
  id: number
  position: Vec3
  /** motive name before 1.13, motive registry id 1.13 – 1.18 (spawn_entity_painting title) */
  name: string | number
  direction: Vec3

  constructor (id: number, position: Vec3, name: string | number, direction: Vec3)
}

export interface StorageEvents {
  open: () => void
  close: () => void
  updateSlot: (slot: number, oldItem: Item | null, newItem: Item | null) => void
}

interface FurnaceEvents extends StorageEvents {
  update: () => void
}

interface ConditionalStorageEvents extends StorageEvents {
  ready: () => void
}

export declare class Chest extends Window<StorageEvents> {
  constructor ()

  close (): Promise<void>

  deposit (
    itemType: number,
    metadata: number | null,
    count: number | null,
    nbt?: Item['nbt']
  ): Promise<void>

  withdraw (
    itemType: number,
    metadata: number | null,
    count: number | null,
    nbt?: Item['nbt']
  ): Promise<void>
}

export declare class Furnace extends Window<FurnaceEvents> {
  /** craft_progress_bar values; null until the server sends them */
  totalFuel: number | null
  /** set with totalFuel */
  totalFuelSeconds?: number
  /** fraction of totalFuel left */
  fuel: number | null
  fuelSeconds: number | null
  totalProgress: number | null
  /** set with totalProgress */
  totalProgressSeconds?: number
  /** fraction of totalProgress done */
  progress: number | null
  /** seconds left */
  progressSeconds: number | null

  constructor ()

  close (): Promise<void>

  deposit (
    itemType: number,
    metadata: number | null,
    count: number | null,
    nbt?: Item['nbt']
  ): Promise<void>

  withdraw (
    itemType: number,
    metadata: number | null,
    count: number | null,
    nbt?: Item['nbt']
  ): Promise<void>

  takeInput (): Promise<Item>

  takeFuel (): Promise<Item>

  takeOutput (): Promise<Item>

  putInput (
    itemType: number,
    metadata: number | null,
    count: number
  ): Promise<void>

  putFuel (
    itemType: number,
    metadata: number | null,
    count: number
  ): Promise<void>

  inputItem (): Item | null

  fuelItem (): Item | null

  outputItem (): Item | null
}

export declare class Dispenser extends Window<StorageEvents> {
  constructor ()

  close (): Promise<void>

  deposit (
    itemType: number,
    metadata: number | null,
    count: number | null,
    nbt?: Item['nbt']
  ): Promise<void>

  withdraw (
    itemType: number,
    metadata: number | null,
    count: number | null,
    nbt?: Item['nbt']
  ): Promise<void>
}

export declare class EnchantmentTable extends Window<ConditionalStorageEvents> {
  enchantments: Enchantment[]
  /** craft_progress_bar property 3; -1 until the server sends it */
  xpseed: number

  constructor ()

  close (): Promise<void>

  deposit (
    itemType: number,
    metadata: number | null,
    count: number | null,
    nbt?: Item['nbt']
  ): Promise<void>

  withdraw (
    itemType: number,
    metadata: number | null,
    count: number | null,
    nbt?: Item['nbt']
  ): Promise<void>

  targetItem (): Item | null

  /** resolves with the enchanted item (the new content of slot 0) */
  enchant (
    choice: string | number
  ): Promise<Item | null>

  takeTargetItem (): Promise<Item>

  putTargetItem (item: Item): Promise<void>

  putLapis (item: Item): Promise<void>
}

export declare class Anvil extends Window<StorageEvents> {
  constructor ()

  close (): Promise<void>

  deposit (
    itemType: number,
    metadata: number | null,
    count: number | null,
    nbt?: Item['nbt']
  ): Promise<void>

  withdraw (
    itemType: number,
    metadata: number | null,
    count: number | null,
    nbt?: Item['nbt']
  ): Promise<void>

  combine (itemOne: Item, itemTwo: Item, name?: string): Promise<void>
  rename (item: Item, name?: string): Promise<void>
}

export interface Enchantment {
  level: number
  expected: { enchant: number, level: number }
}

export declare class Villager extends Window<ConditionalStorageEvents> {
  trades: VillagerTrade[]

  constructor ()

  close (): Promise<void>
}

export interface VillagerTrade {
  inputItem1: Item
  outputItem: Item
  inputItem2: Item | null
  hasItem2: boolean
  tradeDisabled: boolean
  nbTradeUses: number
  maximumNbTradeUses: number
  xp?: number
  specialPrice?: number
  priceMultiplier?: number
  demand?: number
  realPrice?: number
}

export interface ScoreBoard {
  name: string
  title: string
  itemsMap: { [name: string]: ScoreBoardItem }
  /** sorted by value, highest first */
  readonly items: ScoreBoardItem[]

  setTitle (title: TextComponent | undefined): void

  add (name: string, value: number): ScoreBoardItem

  remove (name: string): ScoreBoardItem | undefined
}

/** the display slots (bot.scoreboard): numeric slots from scoreboard_display_objective, named aliases for 0 – 2 */
export interface ScoreBoardPositions {
  [slot: number]: ScoreBoard
  readonly list: ScoreBoard | undefined
  readonly sidebar: ScoreBoard | undefined
  readonly belowName: ScoreBoard | undefined
}

export interface ScoreBoardConstructor {
  new (packet: { name: string, displayText?: TextComponent }): ScoreBoard
  positions: ScoreBoardPositions
}

/** mineflayer.ScoreBoard is a loader: ScoreBoard(bot) returns the class */
export declare const ScoreBoard: (bot: Bot) => ScoreBoardConstructor

export interface ScoreBoardItem {
  name: string
  displayName: ChatMessage
  value: number
}

export interface Team {
  team: string
  name: ChatMessage
  /** bit 0x01 friendly fire, 0x02 see friendly invisibles */
  friendlyFire: number
  nameTagVisibility: string
  collisionRule: string
  color: string
  prefix: ChatMessage
  suffix: ChatMessage
  membersMap: { [name: string]: '' }
  readonly members: string[]

  parseMessage (value: TextComponent): ChatMessage

  add (name: string): ''

  remove (name: string): '' | undefined

  update (name: TextComponent, friendlyFire: number, nameTagVisibility: string, collisionRule: string, formatting: number | undefined, prefix: TextComponent, suffix: TextComponent): void

  displayName (member: string): ChatMessage
}

export type DisplaySlot =
  | 'list'
  | 'sidebar'
  | 'belowName'
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18

export type BossBarColor = 'pink' | 'blue' | 'red' | 'green' | 'yellow' | 'purple' | 'white'

export interface BossBar {
  entityUUID: string
  /** a plain string when the server sends an NBT string tag (1.20.3+) */
  get title (): ChatMessage | string
  set title (title: TextComponent)
  health: number
  /** one of 0, 6, 10, 12, 20 */
  get dividers (): number
  /** the boss_bar packet's division index (0 – 4) */
  set dividers (dividers: number)
  get color (): BossBarColor
  /** the boss_bar packet's color index */
  set color (color: number)
  /** the boss_bar packet's flag bits: 0x1 darken sky, 0x2 dragon bar, 0x4 create fog */
  flags: number
  shouldDarkenSky: boolean
  isDragonBar: boolean
  createFog: boolean
  readonly shouldCreateFog: boolean
}

export interface BossBarConstructor {
  new (uuid: string, title: TextComponent, health: number, dividers: number, color: number, flags: number): BossBar
}

/** mineflayer.BossBar is a loader: BossBar(registry) returns the class */
export declare const BossBar: (registry: Registry) => BossBarConstructor

export interface Particle {
  /** registry id */
  id: number
  /** registry name; set from the registry entry */
  name?: string
  position: Vec3
  offset: Vec3
  count: number
  movementSpeed: number
  longDistanceRender: boolean
}

export interface ParticleConstructor {
  /** id is the registry id or name */
  new (id: number | string, position: Vec3, offset: Vec3, count?: number, movementSpeed?: number, longDistanceRender?: boolean): Particle
  fromNetwork (packet: ClientboundPackets['world_particles']): Particle
}

/** mineflayer.Particle is a loader: Particle(registry) returns the class */
export declare const Particle: (registry: Registry) => ParticleConstructor

export declare let testedVersions: string[]
export declare let latestSupportedVersion: string
export declare let oldestSupportedVersion: string

export declare function supportFeature<T extends keyof SupportsFeature> (feature: T, version: string): SupportsFeature[T]
