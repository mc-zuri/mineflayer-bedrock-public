import mc from 'minecraft-protocol'
import type { ClientOptions } from 'minecraft-protocol'
import { EventEmitter } from 'events'
import pluginLoader from './plugin_loader.ts'
import minecraftData from 'minecraft-data'
import type { SupportsFeature } from 'minecraft-data'
import { testedVersions, latestSupportedVersion, oldestSupportedVersion } from './version.ts'
import abilitiesModule from './plugins/abilities.ts'
import bedModule from './plugins/bed.ts'
import titleModule from './plugins/title.ts'
import blockActionsModule from './plugins/block_actions.ts'
import blocksModule from './plugins/blocks.ts'
import bookModule from './plugins/book.ts'
import bossBarModule from './plugins/boss_bar.ts'
import breathModule from './plugins/breath.ts'
import chatModule from './plugins/chat.ts'
import chestModule from './plugins/chest.ts'
import commandBlockModule from './plugins/command_block.ts'
import craftModule from './plugins/craft.ts'
import creativeModule from './plugins/creative.ts'
import diggingModule from './plugins/digging.ts'
import enchantmentTableModule from './plugins/enchantment_table.ts'
import entitiesModule from './plugins/entities.ts'
import experienceModule from './plugins/experience.ts'
import explosionModule from './plugins/explosion.ts'
import fishingModule from './plugins/fishing.ts'
import furnaceModule from './plugins/furnace.ts'
import gameModule from './plugins/game.ts'
import healthModule from './plugins/health.ts'
import inventoryModule from './plugins/inventory.ts'
import kickModule from './plugins/kick.ts'
import physicsModule from './plugins/physics.ts'
import placeBlockModule from './plugins/place_block.ts'
import rainModule from './plugins/rain.ts'
import rayTraceModule from './plugins/ray_trace.ts'
import resourcePackModule from './plugins/resource_pack.ts'
import scoreboardModule from './plugins/scoreboard.ts'
import teamModule from './plugins/team.ts'
import settingsModule from './plugins/settings.ts'
import simpleInventoryModule from './plugins/simple_inventory.ts'
import soundModule from './plugins/sound.ts'
import spawnPointModule from './plugins/spawn_point.ts'
import tablistModule from './plugins/tablist.ts'
import timeModule from './plugins/time.ts'
import villagerModule from './plugins/villager.ts'
import anvilModule from './plugins/anvil.ts'
import placeEntityModule from './plugins/place_entity.ts'
import genericPlaceModule from './plugins/generic_place.ts'
import particleModule from './plugins/particle.ts'
import sequenceModule from './plugins/sequence.ts'
import Location from './location.ts'
import Painting from './painting.ts'
import ScoreBoard from './scoreboard.ts'
import BossBar from './bossbar.ts'
import Particle from './particle.ts'
import prismarineRegistry from 'prismarine-registry'
import type { Bot, BotOptions, Plugin } from './types/mineflayer.ts'
import type { BotInternal } from './types/internal.ts'
import type { TypedClient } from './types/protocol.ts'

const plugins = {
  abilities: abilitiesModule,
  bed: bedModule,
  title: titleModule,
  block_actions: blockActionsModule,
  blocks: blocksModule,
  book: bookModule,
  boss_bar: bossBarModule,
  breath: breathModule,
  chat: chatModule,
  chest: chestModule,
  command_block: commandBlockModule,
  craft: craftModule,
  creative: creativeModule,
  digging: diggingModule,
  enchantment_table: enchantmentTableModule,
  entities: entitiesModule,
  experience: experienceModule,
  explosion: explosionModule,
  fishing: fishingModule,
  furnace: furnaceModule,
  game: gameModule,
  health: healthModule,
  inventory: inventoryModule,
  kick: kickModule,
  physics: physicsModule,
  place_block: placeBlockModule,
  rain: rainModule,
  ray_trace: rayTraceModule,
  resource_pack: resourcePackModule,
  scoreboard: scoreboardModule,
  team: teamModule,
  settings: settingsModule,
  simple_inventory: simpleInventoryModule,
  sound: soundModule,
  spawn_point: spawnPointModule,
  tablist: tablistModule,
  time: timeModule,
  villager: villagerModule,
  anvil: anvilModule,
  place_entity: placeEntityModule,
  generic_place: genericPlaceModule,
  particle: particleModule,
  sequence: sequenceModule
} as unknown as Record<string, Plugin>  // internal plugins take the BotInternal view

const latestSupportedProtocolVersion = minecraftData.versionsByMinecraftVersion.pc[latestSupportedVersion].version
if (!latestSupportedProtocolVersion) throw new Error(`Version '${latestSupportedVersion}' not supported by minecraft-data - is it up to date?`)

const supportFeature = <T extends keyof SupportsFeature>(feature: T, version: string): SupportsFeature[T] => minecraftData(version).supportFeature(feature)

export {
  createBot,
  Location,
  Painting,
  ScoreBoard,
  BossBar,
  Particle,
  latestSupportedVersion,
  oldestSupportedVersion,
  testedVersions,
  supportFeature
}

function createBot (options: Partial<BotOptions> = {}): Bot {
  options.username = options.username ?? 'Player'
  options.version = options.version ?? false
  options.plugins = options.plugins ?? {}
  options.hideErrors = options.hideErrors ?? false
  options.logErrors = options.logErrors ?? true
  options.loadInternalPlugins = options.loadInternalPlugins ?? true
  options.client = options.client ?? null
  options.brand = options.brand ?? 'vanilla'
  options.respawn = options.respawn ?? true
  const bot = new EventEmitter() as unknown as BotInternal
  bot._client = options.client as TypedClient
  bot.end = (reason) => bot._client.end(reason)
  bot._warn = function (...message: unknown[]) {
    if (options.hideErrors) return
    console.warn('[mineflayer]', ...message)
  }
  if (options.logErrors) {
    bot.on('error', err => {
      if (!options.hideErrors) {
        console.log(err)
      }
    })
  }

  pluginLoader(bot, options as BotOptions)
  const internalPlugins = Object.keys(plugins)
    .filter(key => {
      if (typeof options.plugins![key] === 'function') return false
      if (options.plugins![key] === false) return false
      return options.plugins![key] || options.loadInternalPlugins
    }).map(key => plugins[key])
  const externalPlugins = Object.keys(options.plugins)
    .filter(key => {
      return typeof options.plugins![key] === 'function'
    }).map(key => options.plugins![key] as Plugin)
  bot.loadPlugins([...internalPlugins, ...externalPlugins])

  options.validateChannelProtocol = false
  bot._client = bot._client ?? mc.createClient(options as ClientOptions) as unknown as TypedClient
  bot._client.on('connect', () => {
    bot.emit('connect')
  })
  bot._client.on('error', (err) => {
    bot.emit('error', err)
  })
  bot._client.on('end', (reason) => {
    bot.emit('end', reason)
  })
  if (!bot._client.wait_connect) next()
  else bot._client.once('connect_allowed', next)
  function next () {
    const serverPingVersion = bot._client.version
    bot.registry = prismarineRegistry(serverPingVersion)
    if (!bot.registry?.version) throw new Error(`Server version '${serverPingVersion}' is not supported, no data for version`)

    const versionData = bot.registry.version
    if (versionData['>'](latestSupportedVersion) && (versionData.version !== latestSupportedProtocolVersion)) {
      throw new Error(`Server version '${serverPingVersion}' is not supported. Latest supported version is '${latestSupportedVersion}'.`)
    } else if (versionData['<'](oldestSupportedVersion)) {
      throw new Error(`Server version '${serverPingVersion}' is not supported. Oldest supported version is '${oldestSupportedVersion}'.`)
    }

    bot.protocolVersion = versionData.version!
    bot.majorVersion = versionData.majorVersion!
    bot.version = versionData.minecraftVersion!
    options.version = versionData.minecraftVersion!
    bot.supportFeature = bot.registry.supportFeature
    setTimeout(() => bot.emit('inject_allowed'), 0)
  }
  return bot as unknown as Bot
}
