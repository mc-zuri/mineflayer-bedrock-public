// Regression test: bot._syncWindow resolves only on the window state that follows every click sent before it
import { EventEmitter } from 'events'
import assert from 'assert'
import prismarineRegistry from 'prismarine-registry'
import prismarineItem from 'prismarine-item'
import simpleInventoryPlugin from '../lib/plugins/simple_inventory.ts'
import inventoryPlugin from '../lib/plugins/inventory.ts'

describe('syncWindow', () => {
  // 1.17.1+ servers answer a click that carries a stale state id with the whole window, so clicks sent
  // before the server's answers to the earlier ones arrived get resyncs of their own. The first window_items
  // after the sync click can be such an older resync, describing the window before the later clicks.
  for (const version of ['1.17.1', '1.18.2', '1.21.11']) {
    it(`waits for the answers to every earlier click (${version})`, async () => {
      const registry = prismarineRegistry(version)
      const Item = prismarineItem(registry)
      const stone = new Item(registry.itemsByName['stone']!.id, 1)
      const client: any = new EventEmitter()
      const latency = 30
      // the server answers in order, one latency later
      const send = (name: string, params: unknown) => setTimeout(() => client.emit(name, params), latency)
      // the server's window: stone in slot 36, then picked up by the first click and put in slot 37 by the second
      const states: Array<{ slots: Record<number, unknown>, carried: unknown }> = [
        { slots: { 36: stone }, carried: null },
        { slots: {}, carried: stone },
        { slots: { 37: stone }, carried: null }
      ]
      let state = 0
      let stateId = 1
      const windowItems = () => ({
        windowId: 0,
        stateId: ++stateId,
        items: Array.from({ length: 46 }, (_, i) => Item.toNotch((states[state]!.slots[i] ?? null) as any)),
        carriedItem: Item.toNotch(states[state]!.carried as any)
      })
      client.write = (name: string, params: any) => {
        if (name === 'window_click') {
          if (params.stateId !== -1) state++
          // every click is stale here: each one is answered with the whole window
          send('window_items', windowItems())
        } else if (name === 'client_command') {
          send('statistics', { entries: [] })
        }
      }
      const bot: any = new EventEmitter()
      bot._client = client
      bot.registry = registry
      bot.version = registry.version.minecraftVersion
      bot.supportFeature = registry.supportFeature.bind(registry)
      bot.entity = { id: 1, yaw: 0, pitch: 0 }
      bot.game = { gameMode: 'survival' }
      bot.lastDigTime = null
      bot._nextSequence = () => 0
      simpleInventoryPlugin(bot)
      inventoryPlugin(bot, {} as any)
      client.emit('held_item_slot', { slot: 0 })
      client.emit('window_items', windowItems())
      assert.strictEqual(bot.inventory.slots[36]?.name, 'stone')

      await bot.clickWindow(36, 0, 0)
      await bot.clickWindow(37, 0, 0)
      await bot._syncWindow(bot.inventory)

      assert.strictEqual(bot.inventory.slots[36], null)
      assert.strictEqual(bot.inventory.slots[37]?.name, 'stone', 'the model went back to before the second click')
      assert.strictEqual(bot.inventory.selectedItem, null)
    })
  }
})
