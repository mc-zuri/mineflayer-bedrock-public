// Regression tests for the inventory plugins, driven on a fake bot with a mock client
import { EventEmitter } from 'events'
import assert from 'assert'
import prismarineRegistry from 'prismarine-registry'
import prismarineItem from 'prismarine-item'
import inventoryPlugin from '../lib/plugins/inventory.ts'
import simpleInventoryPlugin from '../lib/plugins/simple_inventory.ts'

interface Write { name: string, params: any }

function createFakeBot (version: string): any {
  const registry = prismarineRegistry(version)
  const client: any = new EventEmitter()
  const writes: Write[] = []
  client.writes = writes
  client.write = (name: string, params: any) => { writes.push({ name, params }) }
  const bot: any = new EventEmitter()
  bot._client = client
  bot.registry = registry
  bot.version = registry.version.minecraftVersion
  bot.supportFeature = registry.supportFeature.bind(registry)
  bot.entity = { id: 1, yaw: 0, pitch: 0 }
  bot.game = { gameMode: 'survival' }
  bot.food = 10
  bot.lastDigTime = null
  bot._nextSequence = () => 0
  simpleInventoryPlugin(bot)
  inventoryPlugin(bot, {})
  client.emit('held_item_slot', { slot: 0 })
  return bot
}

describe('inventory plugin', () => {
  it('a hotbar click right after digging waits for the dig click timeout', async () => {
    const bot = createFakeBot('1.20.4')
    bot.lastDigTime = performance.now()
    const start = performance.now()
    await bot.clickWindow(36, 0, 0)
    const elapsed = performance.now() - start
    assert.ok(bot._client.writes.some((w: Write) => w.name === 'window_click'))
    assert.ok(elapsed >= 400, `clicked ${elapsed.toFixed(0)}ms after digging`)
  })

  it('transfer defaults an omitted sourceEnd / destEnd to one slot', async () => {
    const bot = createFakeBot('1.20.4')
    const Item = prismarineItem(bot.registry)
    const dirt = bot.registry.itemsByName.dirt.id
    bot._client.emit('set_slot', { windowId: 0, stateId: 1, slot: 9, item: Item.toNotch(new Item(dirt, 3)) })
    await bot.transfer({ window: bot.inventory, itemType: dirt, count: 3, sourceStart: 9, destStart: 10 })
    assert.strictEqual(bot.inventory.slots[9], null)
    assert.strictEqual(bot.inventory.slots[10]?.count, 3)
  })

  it('a server close_window without an open window emits no windowClose', () => {
    const bot = createFakeBot('1.20.4')
    const closed: unknown[] = []
    bot.on('windowClose', (window: unknown) => closed.push(window))
    bot._client.emit('close_window', { windowId: 0 })
    assert.deepStrictEqual(closed, [])
  })
})
