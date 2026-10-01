// Regression test: anvil.combine / anvil.rename take the result only once the server has sent it
import { EventEmitter } from 'events'
import assert from 'assert'
import prismarineRegistry from 'prismarine-registry'
import prismarineItem from 'prismarine-item'
import simpleInventoryPlugin from '../lib/plugins/simple_inventory.ts'
import inventoryPlugin from '../lib/plugins/inventory.ts'
import anvilPlugin from '../lib/plugins/anvil.ts'

interface Write { name: string, params: any }

describe('anvil result', () => {
  // 1.17.1+ clicks have no confirmation, so the bot does not wait for the server between the clicks
  // that fill the inputs and the click that takes the result. The result slot comes from the server
  // (set_slot after the input click, or after the rename) and arrives one round trip later.
  for (const version of ['1.17.1', '1.20.4']) {
    it(`combine waits for the result before taking it (${version})`, async () => {
      const registry = prismarineRegistry(version)
      const Item = prismarineItem(registry)
      const client: any = new EventEmitter()
      const writes: Write[] = []
      const latency = 30
      // the server answers in order, one latency later
      const send = (name: string, params: unknown) => setTimeout(() => client.emit(name, params), latency)
      const sword = new Item(registry.itemsByName['diamond_sword']!.id, 1)
      const book = new Item(registry.itemsByName['enchanted_book']!.id, 1)
      book.enchants = [{ name: 'sharpness', lvl: 5 }]
      const result = new Item(registry.itemsByName['diamond_sword']!.id, 1)
      result.enchants = [{ name: 'sharpness', lvl: 5 }]
      result.repairCost = 1
      let stateId = 1
      const bot: any = new EventEmitter()
      client.write = (name: string, params: any) => {
        writes.push({ name, params })
        if (name !== 'window_click') return
        const window = bot.currentWindow
        if (params.stateId === -1) {
          // a stale click: the server resends the whole window, its result slot included
          const items = window.slots.map((item: any, i: number) => Item.toNotch(i === 2 ? (window.slots[0] && window.slots[1] ? result : null) : item))
          send('window_items', { windowId: window.id, stateId: ++stateId, items, carriedItem: Item.toNotch(window.selectedItem) })
        } else if (params.slot === 1 && params.changedSlots.length > 0) {
          send('set_slot', { windowId: window.id, stateId: ++stateId, slot: 2, item: Item.toNotch(result) })
        }
      }
      client.writeChannel = () => {}
      client.registerChannel = () => {}
      bot._client = client
      bot.registry = registry
      bot.version = registry.version.minecraftVersion
      bot.supportFeature = registry.supportFeature.bind(registry)
      bot.entity = { id: 1, yaw: 0, pitch: 0 }
      bot.game = { gameMode: 'creative' } // no experience to wait for
      bot.lastDigTime = null
      bot._nextSequence = () => 0
      simpleInventoryPlugin(bot)
      inventoryPlugin(bot, {} as any)
      anvilPlugin(bot)
      client.emit('held_item_slot', { slot: 0 })
      const anvilType = registry.version['>=']('1.20.3') ? 8 : 7
      client.emit('open_window', { windowId: 1, inventoryType: anvilType, windowTitle: JSON.stringify({ translate: 'container.repair' }) })
      assert.strictEqual(bot.currentWindow.type, 'minecraft:anvil')
      const items = bot.currentWindow.slots.map(() => Item.toNotch(null))
      items[30] = Item.toNotch(sword)
      items[31] = Item.toNotch(book)
      client.emit('window_items', { windowId: 1, stateId, items, carriedItem: Item.toNotch(null) })
      bot.openBlock = async () => bot.currentWindow

      const anvil = await bot.openAnvil({})
      await anvil.combine(anvil.slots[30], anvil.slots[31])

      const take = writes.find(w => w.name === 'window_click' && w.params.slot === 2)!
      assert.ok(take.params.cursorItem.present !== false, 'the result was taken before the server sent it')
      assert.strictEqual(anvil.slots[2], null)
      assert.ok(anvil.slots.slice(anvil.inventoryStart).some((item: any) => item?.repairCost === 1), 'the result is not in the inventory')
    })
  }
})
