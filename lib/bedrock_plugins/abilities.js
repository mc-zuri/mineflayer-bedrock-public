module.exports = inject

// Player abilities and adventure settings. update_abilities carries layered ability sets (may-fly, flying, no-clip,
// build, mine, ...; bot.abilities.flags merges them) plus the permission level and movement speeds; the client takes
// no ability from the game mode itself. update_adventure_settings carries the world-interaction toggles. Both are inbound only, so this just exposes state and fires events.
function inject (bot) {
  // Java-parity named layer (index.d.ts Bot.abilities): the six booleans/speeds mineflayer-java exposes. Seed defaults
  // so a read before the first update_abilities does not throw (Java also starts with a defaults object). The raw
  // Bedrock detail (permission level, full flag set, per-layer speeds) is kept alongside for callers that want it.
  const DEFAULTS = () => ({ invulnerable: false, flying: false, mayFly: false, instantBuild: false, flyingSpeed: 0.05, walkingSpeed: 0.1 })
  bot.abilities = DEFAULTS()
  bot.adventureSettings = null

  // The layers from lowest to highest: a layer decides the abilities it allows, over the ones below it (a spectator's
  // flight and no-clip come in the spectator layer, over a base layer without them).
  const LAYER_ORDER = ['cache', 'base', 'spectator', 'commands', 'editor', 'loading_screen']
  function mergedFlags (layers) {
    const flags = {}
    const ordered = [...layers].sort((a, b) => LAYER_ORDER.indexOf(a.type) - LAYER_ORDER.indexOf(b.type))
    for (const layer of ordered) {
      for (const [name, allowed] of Object.entries(layer.allowed || {})) {
        if (allowed === true) flags[name] = !!(layer.enabled && layer.enabled[name])
      }
    }
    return flags
  }

  bot._client.on('update_abilities', (packet) => {
    const layers = packet.abilities || []
    const base = layers.find(l => l.type === 'base') || layers[0] || {}
    const flags = base.enabled || {}
    bot.abilities = {
      // Java-named layer
      invulnerable: !!flags.invulnerable,
      flying: !!flags.flying,
      mayFly: !!flags.may_fly,
      instantBuild: !!flags.instant_build,
      flyingSpeed: base.fly_speed ?? 0.05,
      walkingSpeed: base.walk_speed ?? 0.1,
      // Bedrock extras
      permissionLevel: packet.permission_level,
      commandPermission: packet.command_permission,
      flags: mergedFlags(layers),
      allowed: base.allowed || {},
      verticalFlySpeed: base.vertical_fly_speed,
      layers
    }
    deriveFromGamemode()
    // Feed the shared physics engine so a creative/spectator bot predicts flight locally (Java abilities.js does this).
    if (bot.entity) bot.entity.flying = bot.abilities.flying
    bot.emit('abilities', bot.abilities)
    bot.emit('abilitiesUpdate', bot.abilities) // Bedrock-era alias, kept for back-compat
  })

  // Bedrock conveys flight CAPABILITY through the gamemode, not the ability flags: BDS's update_abilities base layer
  // keeps may_fly=false even in creative (verified live), because a real client derives "can fly" from creative/
  // spectator. mineflayer-java's bot.abilities.mayFly is true in creative, so derive it from the gamemode to match.
  function deriveFromGamemode () {
    if (!bot.abilities) return
    // Recompute from the raw server flags each time so LEAVING creative/spectator resets mayFly (Bedrock does not
    // resend meaningful ability flags on every gamemode switch).
    const flags = bot.abilities.flags || {}
    bot.abilities.mayFly = !!flags.may_fly
    bot.abilities.flying = !!flags.flying
    bot.abilities.instantBuild = !!flags.instant_build
    bot.abilities.invulnerable = !!flags.invulnerable
    const gm = bot.game && bot.game.gameMode
    if (gm === 'creative') {
      bot.abilities.mayFly = true
      bot.abilities.instantBuild = true
      bot.abilities.invulnerable = true
    } else if (gm === 'spectator') {
      bot.abilities.mayFly = true
      bot.abilities.flying = true
      bot.abilities.invulnerable = true
    }
  }
  // gameMode is set by the game plugin (loaded first) on these packets; re-derive + re-emit so a gamemode switch that
  // does not resend meaningful ability flags still flips bot.abilities.mayFly.
  const onGamemode = () => { deriveFromGamemode(); if (bot.entity) bot.entity.flying = bot.abilities.flying; bot.emit('abilities', bot.abilities) }
  bot._client.on('set_player_game_type', onGamemode)
  bot._client.on('update_player_game_type', onGamemode)

  bot._client.on('update_adventure_settings', (packet) => {
    bot.adventureSettings = {
      noPvm: packet.no_pvm,
      noMvp: packet.no_mvp,
      immutableWorld: packet.immutable_world,
      showNameTags: packet.show_name_tags,
      autoJump: packet.auto_jump
    }
    bot.emit('adventureSettingsUpdate', bot.adventureSettings)
  })
}
