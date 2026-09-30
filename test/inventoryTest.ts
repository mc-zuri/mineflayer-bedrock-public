// Regression tests for the inventory plugins, driven on a fake bot with a mock client
import { EventEmitter } from 'events'
import assert from 'assert'
import prismarineRegistry from 'prismarine-registry'
import prismarineItem from 'prismarine-item'
import prismarineWindows from 'prismarine-windows'
import inventoryPlugin from '../lib/plugins/inventory.ts'
import simpleInventoryPlugin from '../lib/plugins/simple_inventory.ts'
import villagerPlugin from '../lib/plugins/villager.ts'
import craftPlugin from '../lib/plugins/craft.ts'
import furnacePlugin from '../lib/plugins/furnace.ts'
import { Vec3 } from 'vec3'

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
  inventoryPlugin(bot, {} as any)
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

  for (const serverSide of [false, true]) {
    it(`a ${serverSide ? 'server' : 'client'} close of a furnace emits close and removes its craft_progress_bar listener`, async () => {
      const bot = createFakeBot('1.20.4')
      bot.activateBlock = () => {}
      furnacePlugin(bot)
      const Item = prismarineItem(bot.registry)
      const furnaceWindow = prismarineWindows(bot.version).windows['minecraft:furnace']
      const before = bot._client.listenerCount('craft_progress_bar')
      const opening = bot.openFurnace({ position: new Vec3(0, 0, 0) })
      bot._client.emit('open_window', { windowId: 1, inventoryType: furnaceWindow.type, windowTitle: JSON.stringify({ text: 'Furnace' }) })
      bot._client.emit('window_items', { windowId: 1, stateId: 1, items: new Array(furnaceWindow.slots).fill(Item.toNotch(null)), carriedItem: Item.toNotch(null) })
      const furnace = await opening
      assert.strictEqual(bot._client.listenerCount('craft_progress_bar'), before + 1)
      let closes = 0
      furnace.on('close', () => { closes++ })
      if (serverSide) bot._client.emit('close_window', { windowId: 1 })
      else await furnace.close()
      assert.strictEqual(closes, 1)
      assert.strictEqual(bot._client.listenerCount('craft_progress_bar'), before)
    })
  }

  it('the click action number wraps like a short and the transaction queue follows it (1.12.2)', async function () {
    this.timeout(60000)
    const bot = createFakeBot('1.12.2')
    const write = bot._client.write
    let confirm = true
    bot._client.write = (name: string, params: any) => {
      write(name, params)
      if (name === 'window_click' && confirm) {
        setImmediate(() => bot._client.emit('transaction', { windowId: params.windowId, action: params.action, accepted: true }))
      }
    }
    for (let i = 1; i < 32767; i++) await bot.clickWindow(-999, 0, 0)
    bot._client.writes.length = 0
    // the server answers only the second click, which accepts the first as well
    confirm = false
    const first = bot.clickWindow(-999, 0, 0)
    const second = bot.clickWindow(-999, 0, 0)
    const actions = bot._client.writes.filter((w: Write) => w.name === 'window_click').map((w: Write) => w.params.action)
    assert.deepStrictEqual(actions, [32767, -32768])
    bot._client.emit('transaction', { windowId: 0, action: -32768, accepted: true })
    await Promise.all([first, second])
  })

  it('consume with an empty hand rejects with a clear error', async () => {
    const bot = createFakeBot('1.20.4')
    await assert.rejects(bot.consume(), /not holding an item/)
    bot.game.gameMode = 'creative'
    await assert.rejects(bot.consume(), /not holding an item/)
  })

  it('an update of another slot does not stop using the held item', () => {
    const bot = createFakeBot('1.20.4')
    const Item = prismarineItem(bot.registry)
    const { apple, dirt } = bot.registry.itemsByName
    bot._client.emit('set_slot', { windowId: 0, stateId: 1, slot: 36, item: Item.toNotch(new Item(apple.id, 5)) })
    bot.activateItem()
    assert.strictEqual(bot.usingHeldItem, true)
    bot._client.emit('set_slot', { windowId: 0, stateId: 2, slot: 9, item: Item.toNotch(new Item(dirt.id, 1)) })
    assert.strictEqual(bot.usingHeldItem, true, 'held item unchanged')
    bot._client.emit('set_slot', { windowId: 0, stateId: 3, slot: 36, item: Item.toNotch(new Item(apple.id, 4)) })
    assert.strictEqual(bot.usingHeldItem, false, 'held item count changed')
  })

  for (const version of ['1.20.4', '1.21.11']) {
    it(`a cooldown on the held item stops using it (${version})`, () => {
      const bot = createFakeBot(version)
      const Item = prismarineItem(bot.registry)
      const { shield, ender_pearl: enderPearl } = bot.registry.itemsByName
      const cooldown = (item: { id: number, name: string }) => bot.registry.version['>=']('1.21.2')
        ? { cooldownGroup: `minecraft:${item.name}`, cooldownTicks: 100 }
        : { itemID: item.id, cooldownTicks: 100 }
      bot._client.emit('set_slot', { windowId: 0, stateId: 1, slot: 36, item: Item.toNotch(new Item(shield.id, 1)) })
      bot.activateItem()
      bot._client.emit('set_cooldown', cooldown(enderPearl))
      assert.strictEqual(bot.usingHeldItem, true, 'cooldown on another item')
      bot._client.emit('set_cooldown', cooldown(shield))
      assert.strictEqual(bot.usingHeldItem, false, 'cooldown on the held item')
    })
  }

  it('a click in a merchant window without a selected trade', async () => {
    const bot = createFakeBot('1.20.4')
    const Item = prismarineItem(bot.registry)
    const merchant = prismarineWindows(bot.version).windows['minecraft:merchant']
    bot._client.emit('open_window', { windowId: 1, inventoryType: merchant.type, windowTitle: JSON.stringify({ text: 'Villager' }) })
    bot._client.emit('window_items', { windowId: 1, stateId: 1, items: new Array(merchant.slots).fill(Item.toNotch(null)), carriedItem: Item.toNotch(null) })
    assert.strictEqual(bot.currentWindow?.type, 'minecraft:merchant')
    await bot.clickWindow(0, 0, 0)
    await bot.clickWindow(2, 0, 0)
  })
})

describe('villager plugin', () => {
  it('a trade without a second input has inputItem2 null', async () => {
    const bot = createFakeBot('1.20.4')
    bot.lookAt = async () => {}
    villagerPlugin(bot, {} as any)
    const Item = prismarineItem(bot.registry)
    const { emerald, bread } = bot.registry.itemsByName
    const merchant = prismarineWindows(bot.version).windows['minecraft:merchant']
    const opening = bot.openVillager({ id: 5, entityType: bot.registry.entitiesByName.villager.id, position: new Vec3(0, 0, 0) })
    bot._client.emit('open_window', { windowId: 1, inventoryType: merchant.type, windowTitle: JSON.stringify({ text: 'Villager' }) })
    bot._client.emit('window_items', { windowId: 1, stateId: 1, items: new Array(merchant.slots).fill(Item.toNotch(null)), carriedItem: Item.toNotch(null) })
    await new Promise(resolve => setImmediate(resolve))
    const trade = (input2: any) => ({
      inputItem1: Item.toNotch(new Item(emerald.id, 1)),
      outputItem: Item.toNotch(new Item(bread.id, 6)),
      inputItem2: Item.toNotch(input2),
      tradeDisabled: false,
      nbTradeUses: 0,
      maximumNbTradeUses: 16,
      xp: 1,
      specialPrice: 0,
      priceMultiplier: 0.05,
      demand: 0
    })
    bot._client.emit('trade_list', {
      windowId: 1,
      trades: [trade(null), trade(new Item(bread.id, 1))],
      villagerLevel: 1,
      experience: 0,
      isRegularVillager: true,
      canRestock: true
    })
    const villager = await opening
    assert.strictEqual(villager.trades[0].inputItem2, null)
    assert.strictEqual(villager.trades[0].hasItem2, false)
    assert.strictEqual(villager.trades[0].inputs.length, 1)
    assert.strictEqual(villager.trades[1].inputItem2.name, 'bread')
    assert.strictEqual(villager.trades[1].hasItem2, true)
    assert.strictEqual(villager.trades[1].inputs.length, 2)
  })

  it('trade predicts the trading slots as Item instances (1.16.5)', async () => {
    const bot = createFakeBot('1.16.5')
    bot.lookAt = async () => {}
    villagerPlugin(bot, {} as any)
    const Item = prismarineItem(bot.registry)
    const { emerald, bread } = bot.registry.itemsByName
    const merchant = prismarineWindows(bot.version).windows['minecraft:merchant']
    const invStart = merchant.inventory.start
    // a server that accepts every click and moves the price into slot 0 when a trade is selected
    const write = bot._client.write
    bot._client.write = (name: string, params: any) => {
      write(name, params)
      if (name === 'window_click') {
        setImmediate(() => bot._client.emit('transaction', { windowId: params.windowId, action: params.action, accepted: true }))
      } else if (name === 'select_trade') {
        setImmediate(() => {
          bot._client.emit('set_slot', { windowId: 1, slot: invStart, item: Item.toNotch(new Item(emerald.id, 4)) })
          bot._client.emit('set_slot', { windowId: 1, slot: 0, item: Item.toNotch(new Item(emerald.id, 1)) })
        })
      }
    }
    const opening = bot.openVillager({ id: 5, entityType: bot.registry.entitiesByName.villager.id, position: new Vec3(0, 0, 0) })
    const items = new Array(merchant.slots).fill(Item.toNotch(null))
    items[invStart] = Item.toNotch(new Item(emerald.id, 5))
    bot._client.emit('open_window', { windowId: 1, inventoryType: merchant.type, windowTitle: JSON.stringify({ text: 'Villager' }) })
    bot._client.emit('window_items', { windowId: 1, items })
    await new Promise(resolve => setImmediate(resolve))
    bot._client.emit('trade_list', {
      windowId: 1,
      trades: [{
        inputItem1: Item.toNotch(new Item(emerald.id, 1)),
        outputItem: Item.toNotch(new Item(bread.id, 6)),
        inputItem2: Item.toNotch(null),
        tradeDisabled: false,
        nbTradeUses: 0,
        maximumNbTradeUses: 16,
        xp: 1,
        specialPrice: 0,
        priceMultiplier: 0.05,
        demand: 0
      }],
      villagerLevel: 1,
      experience: 0,
      isRegularVillager: true,
      canRestock: true
    })
    const villager = await opening
    const plain: number[] = []
    villager.on('updateSlot', (slot: number, oldItem: unknown, newItem: object | null) => {
      if (newItem && Object.getPrototypeOf(newItem) === Object.prototype) plain.push(slot)
    })
    await bot.trade(villager, 0, 1)
    assert.deepStrictEqual(plain, [])
    assert.strictEqual(villager.slots[invStart + 1]?.name, 'bread')
  })
})

describe('craft plugin', () => {
  it('craft rejects with the original error', async () => {
    const bot = createFakeBot('1.20.4')
    craftPlugin(bot)
    const [recipe] = bot.recipesAll(bot.registry.itemsByName.oak_planks.id, null, null)
    await assert.rejects(bot.craft(recipe, 1, null), (err: Error) => {
      assert.strictEqual(err.message, 'missing ingredient')
      assert.match(err.stack!, /clickShape|nextIngredientsClick/)
      return true
    })
  })
})
