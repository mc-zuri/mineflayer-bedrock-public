import assert from 'assert'
import type { Bot, BotOptions, Plugin } from './types/mineflayer.ts'
import type { BotInternal } from './types/internal.ts'

export default inject

function inject (bot: BotInternal, options: BotOptions): void {
  let loaded = false
  const pluginList: Plugin[] = []
  bot.once('inject_allowed', onInjectAllowed)

  function onInjectAllowed () {
    loaded = true
    injectPlugins()
  }

  function loadPlugin (plugin: Plugin): void {
    assert.ok(typeof plugin === 'function', 'plugin needs to be a function')

    if (hasPlugin(plugin)) {
      return
    }

    pluginList.push(plugin)

    if (loaded) {
      plugin(bot as unknown as Bot, options)
    }
  }

  function loadPlugins (plugins: Plugin[]): void {
    // While type checking if already done in the other function, it's useful to do
    // it here to prevent situations where only half the plugin list is loaded.
    assert.ok(plugins.filter(plugin => typeof plugin === 'function').length === plugins.length, 'plugins need to be an array of functions')

    plugins.forEach((plugin) => {
      loadPlugin(plugin)
    })
  }

  function injectPlugins () {
    pluginList.forEach((plugin) => {
      plugin(bot as unknown as Bot, options)
    })
  }

  function hasPlugin (plugin: Plugin): boolean {
    return pluginList.indexOf(plugin) >= 0
  }

  bot.loadPlugin = loadPlugin
  bot.loadPlugins = loadPlugins
  bot.hasPlugin = hasPlugin
}
