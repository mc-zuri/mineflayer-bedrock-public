const editions = {
  java: require('./client/java'),
  bedrock: require('./client/bedrock')
}
const { EventEmitter } = require('events')
const pluginLoader = require('./plugin_loader')
const javaPlugins = {
  abilities: require('./plugins/abilities'),
  bed: require('./plugins/bed'),
  title: require('./plugins/title'),
  block_actions: require('./plugins/block_actions'),
  blocks: require('./plugins/blocks'),
  book: require('./plugins/book'),
  boss_bar: require('./plugins/boss_bar'),
  breath: require('./plugins/breath'),
  chat: require('./plugins/chat'),
  chest: require('./plugins/chest'),
  command_block: require('./plugins/command_block'),
  craft: require('./plugins/craft'),
  creative: require('./plugins/creative'),
  digging: require('./plugins/digging'),
  enchantment_table: require('./plugins/enchantment_table'),
  entities: require('./plugins/entities'),
  experience: require('./plugins/experience'),
  explosion: require('./plugins/explosion'),
  fishing: require('./plugins/fishing'),
  furnace: require('./plugins/furnace'),
  game: require('./plugins/game'),
  health: require('./plugins/health'),
  inventory: require('./plugins/inventory'),
  kick: require('./plugins/kick'),
  physics: require('./plugins/physics'),
  place_block: require('./plugins/place_block'),
  rain: require('./plugins/rain'),
  ray_trace: require('./plugins/ray_trace'),
  resource_pack: require('./plugins/resource_pack'),
  scoreboard: require('./plugins/scoreboard'),
  team: require('./plugins/team'),
  settings: require('./plugins/settings'),
  simple_inventory: require('./plugins/simple_inventory'),
  sound: require('./plugins/sound'),
  spawn_point: require('./plugins/spawn_point'),
  tablist: require('./plugins/tablist'),
  time: require('./plugins/time'),
  villager: require('./plugins/villager'),
  anvil: require('./plugins/anvil'),
  place_entity: require('./plugins/place_entity'),
  generic_place: require('./plugins/generic_place'),
  particle: require('./plugins/particle')
}

// Bedrock plugins translate bedrock-protocol packets into the same bot state and events as the Java plugins.
const bedrockPlugins = {
  game: require('./bedrock_plugins/game'),
  client_input: require('./bedrock_plugins/client_input'),
  health: require('./bedrock_plugins/health'),
  breath: require('./bedrock_plugins/breath'),
  experience: require('./bedrock_plugins/experience'),
  time: require('./bedrock_plugins/time'),
  spawn_point: require('./bedrock_plugins/spawn_point'),
  blocks: require('./bedrock_plugins/blocks'),
  block_actions: require('./bedrock_plugins/block_actions'), // blockBreakProgressObserved/End from other entities (level_event)
  ray_trace: require('./plugins/ray_trace'), // world-generic (bot.world.raycast + bot.entity), shared with Java
  interact: require('./bedrock_plugins/interact'),
  place_block: require('./plugins/place_block'), // shared: wraps bot._genericPlace with world confirmation, so bedrock placeBlock matches Java (resolves on blockUpdate, throws on refusal)
  explosion: require('./plugins/explosion'), // shared: getExplosionDamages is edition-agnostic (world.raycast + entity.attributes); no packet listener, so it runs cleanly on bedrock and beats parity.js's null stub
  digging: require('./bedrock_plugins/digging'),
  lifecycle: require('./bedrock_plugins/lifecycle'),
  entities: require('./bedrock_plugins/entities'),
  bed: require('./bedrock_plugins/bed'),
  fishing: require('./bedrock_plugins/fishing'),
  trading: require('./bedrock_plugins/trading'),
  inventory: require('./bedrock_plugins/inventory'),
  stack_request: require('./bedrock_plugins/stack_request'),
  containers: require('./bedrock_plugins/containers'),
  crafting: require('./bedrock_plugins/crafting'),
  creative: require('./bedrock_plugins/creative'),
  stations: require('./bedrock_plugins/stations'),
  parity: require('./bedrock_plugins/parity'),
  book: require('./bedrock_plugins/book'),
  place_entity: require('./bedrock_plugins/place_entity'),
  furnace: require('./bedrock_plugins/furnace'),
  abilities: require('./bedrock_plugins/abilities'),
  vehicles: require('./bedrock_plugins/vehicles'),
  scoreboard: require('./bedrock_plugins/scoreboard'),
  boss_bar: require('./bedrock_plugins/boss_bar'),
  title: require('./bedrock_plugins/title'),
  rain: require('./bedrock_plugins/rain'),
  particle: require('./bedrock_plugins/particle'),
  sound: require('./bedrock_plugins/sound'),
  settings: require('./bedrock_plugins/settings'),
  resource_pack: require('./bedrock_plugins/resource_pack'),
  chat: require('./bedrock_plugins/chat'),
  forms: require('./bedrock_plugins/forms') // Bedrock-only: server forms (modalForm event + bot.answerForm/closeForm)
}

const minecraftData = require('minecraft-data')
const { testedVersions, latestSupportedVersion, oldestSupportedVersion, bedrockTestedVersions } = require('./version')
const latestSupportedProtocolVersion = minecraftData.versionsByMinecraftVersion.pc[latestSupportedVersion].version
if (!latestSupportedProtocolVersion) throw new Error(`Version '${latestSupportedVersion}' not supported by minecraft-data - is it up to date?`)

module.exports = {
  createBot,
  Location: require('./location'),
  Painting: require('./painting'),
  ScoreBoard: require('./scoreboard'),
  BossBar: require('./bossbar'),
  Particle: require('./particle'),
  latestSupportedVersion,
  oldestSupportedVersion,
  testedVersions,
  bedrockTestedVersions,
  supportFeature: (feature, version) => minecraftData(version).supportFeature(feature)
}

function createBot (options = {}) {
  options.username = options.username ?? 'Player'
  options.version = options.version ?? false
  options.plugins = options.plugins ?? {}
  options.hideErrors = options.hideErrors ?? false
  options.logErrors = options.logErrors ?? true
  options.loadInternalPlugins = options.loadInternalPlugins ?? true
  options.client = options.client ?? null
  options.brand = options.brand ?? 'vanilla'
  options.respawn = options.respawn ?? true
  const edition = getEdition(options)
  options.edition = edition

  const bot = new EventEmitter()
  bot.edition = edition
  bot._client = options.client
  bot.end = (reason) => {
    if (typeof bot._client.end === 'function') bot._client.end(reason)
    else bot._client.close(reason)
  }
  bot._warn = function (...message) {
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

  pluginLoader(bot, options)
  const plugins = edition === 'bedrock' ? bedrockPlugins : javaPlugins
  const internalPlugins = Object.keys(plugins)
    .filter(key => {
      if (typeof options.plugins[key] === 'function') return false
      if (options.plugins[key] === false) return false
      return options.plugins[key] || options.loadInternalPlugins
    }).map(key => plugins[key])
  const externalPlugins = Object.keys(options.plugins)
    .filter(key => {
      return typeof options.plugins[key] === 'function'
    }).map(key => options.plugins[key])
  bot.loadPlugins([...internalPlugins, ...externalPlugins])

  options.validateChannelProtocol = false
  bot._client = bot._client ?? editions[edition].createClient(options)
  bot._client.on('connect', () => {
    bot.emit('connect')
  })
  bot._client.on('error', (err) => {
    bot.emit('error', err)
  })
  // bedrock-protocol reports the end of a session as close
  bot._client.on(edition === 'bedrock' ? 'close' : 'end', (reason) => {
    bot.emit('end', reason)
  })
  if (!bot._client.wait_connect) next()
  else bot._client.once('connect_allowed', next)
  function next () {
    const serverPingVersion = edition === 'bedrock' ? editions.bedrock.normalizeVersion(bot._client.options.version).data : bot._client.version
    bot.registry = require('prismarine-registry')(serverPingVersion)
    if (!bot.registry?.version) throw new Error(`Server version '${serverPingVersion}' is not supported, no data for version`)

    const versionData = bot.registry.version
    if (edition === 'bedrock') {
      if (!bedrockTestedVersions.includes(versionData.minecraftVersion)) bot._warn(`Bedrock version '${versionData.minecraftVersion}' is not in the tested list (${bedrockTestedVersions.join(', ')})`)
    } else if (versionData['>'](latestSupportedVersion) && (versionData.version !== latestSupportedProtocolVersion)) {
      throw new Error(`Server version '${serverPingVersion}' is not supported. Latest supported version is '${latestSupportedVersion}'.`)
    } else if (versionData['<'](oldestSupportedVersion)) {
      throw new Error(`Server version '${serverPingVersion}' is not supported. Oldest supported version is '${oldestSupportedVersion}'.`)
    }

    bot.protocolVersion = versionData.version
    bot.majorVersion = versionData.majorVersion
    bot.version = versionData.minecraftVersion
    options.version = versionData.minecraftVersion
    bot.supportFeature = bot.registry.supportFeature
    setTimeout(() => bot.emit('inject_allowed'), 0)
  }
  return bot
}

function getEdition (options) {
  if (options.edition && options.edition !== 'java' && options.edition !== 'bedrock') throw new Error(`Unknown Minecraft edition '${options.edition}'`)
  if (options.edition) return options.edition
  if (options.client?.bedrock || options.client?.options?.raknetBackend || options.client?.connection?.nethernet) return 'bedrock'
  return typeof options.version === 'string' && (options.version === 'bedrock' || options.version.startsWith('bedrock_')) ? 'bedrock' : 'java'
}
