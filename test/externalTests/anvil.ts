import assert from 'assert'
import { once } from '../../lib/promise_utils.ts'
import prismarineItem from 'prismarine-item'
import minecraftData from 'minecraft-data'
import type { TestBot, TestFunction } from './plugins/testCommon.ts'
import type { Item } from 'prismarine-item'
import type { Block } from 'prismarine-block'

type Enchants = Array<{ name: string, lvl: number }>
interface ItemOptions { type: number, count?: number, enchants?: Enchants, repairCost?: number }
type AnvilTest = (
  b: Block,
  renameCost: () => number,
  renameName: (name: string) => unknown,
  Item: ReturnType<typeof prismarineItem>,
  bot: TestBot,
  makeBook: (enchants: Enchants) => Item,
  makeItem: (opts: ItemOptions) => Item
) => Promise<void>

export default (version: string): Record<string, TestFunction> => {
  // prismarine-item writes enchants to the item's NBT, which 1.20.5+ items (data components)
  // no longer carry, and reads no stored_enchantments component: no enchanted item or book
  // can be made or combined there yet
  const enchantsSupported = minecraftData(version).version['<']('1.20.5')

  async function runTest (bot: TestBot, testFunction: AnvilTest) {
    const Item = prismarineItem(bot.registry)
    const renameCost = () => bot.registry.isNewerOrEqualTo('1.8.9') ? 0 : 1 // weird quirk of anvils
    // weird quirk of anvils; 1.20.5+: the custom_name component, a plain text being a bare NBT string
    const renameName = (name: string) => bot.registry.isOlderThan('1.13.2')
      ? name
      : bot.registry.isNewerOrEqualTo('1.20.5') ? { type: 'string', value: name } : JSON.stringify({ text: name })
    await bot.test.becomeCreative()
    await bot.test.setInventorySlot(36, new Item(bot.registry.itemsByName['anvil']!.id, 1))
    await bot.test.becomeSurvival()
    await bot.test.placeBlock(36, bot.entity.position.offset(1, 0, 0))

    if (bot.registry.isNewerOrEqualTo('1.13')) bot.chat(`/xp set ${bot.username} 999 levels`)
    else {
      bot.chat(`/xp -2147483648L ${bot.username}`)
      await once(bot, 'experience')
      bot.chat(`/xp 999L ${bot.username}`)
    }

    await once(bot, 'experience')

    const b = bot.findBlock({ matching: bot.registry.blocksByName['anvil']!.id })! // find anvil before tests so all tests can use it

    function makeBook (enchants: Enchants) {
      return makeItem({ type: bot.registry.itemsByName['enchanted_book']!.id, count: 1, enchants })
    }

    function makeItem (opts: ItemOptions) {
      const { type, count = 1, enchants, repairCost } = opts
      const item = new Item(type, count)
      if (enchants) item.enchants = enchants
      if (repairCost) item.repairCost = repairCost
      return item
    }
    await testFunction(b, renameCost, renameName, Item, bot, makeBook, makeItem)
  }

  const tests: Record<string, TestFunction> = {}

  function addTest (name: string, f: AnvilTest, needsEnchants = true) {
    if (needsEnchants && !enchantsSupported) return
    tests[name] = bot => runTest(bot, f)
  }

  addTest('combine two items', async (b, _renameCost, _renameName, Item, bot, makeBook) => { // combine two items
    await bot.test.becomeCreative()
    // get items
    await bot.test.setInventorySlot(36, new Item(bot.registry.itemsByName['diamond_sword']!.id, 1))
    await bot.test.setInventorySlot(37, makeBook([{ name: 'sharpness', lvl: 5 }]))
    await bot.test.becomeSurvival()

    const anvil = await bot.openAnvil(b)

    const sword = anvil.findInventoryItem(bot.registry.itemsByName['diamond_sword']!.id)
    const book = anvil.findInventoryItem(bot.registry.itemsByName['enchanted_book']!.id)

    await anvil.combine(sword!, book!)
    // test result
    assert.strictEqual(bot.experience.level, 994)
    assert.strictEqual(anvil.slots[3]!.repairCost, 1)
    assert.deepStrictEqual(anvil.slots[3]!.enchants, [{ name: 'sharpness', lvl: 5 }])
    await anvil.close()
    await bot.test.wait(1000)
  })

  addTest('combine with nbt selection two items', async (b, _renameCost, _renameName, Item, bot, makeBook, makeItem) => { // combining two items in inventory, but there are three items, so this is more a test of using nbt when picking the item in inventory
    bot.chat(`/clear ${bot.username}`)
    await bot.test.becomeCreative()

    await bot.test.setInventorySlot(36, new Item(bot.registry.itemsByName['diamond_sword']!.id, 1))
    await bot.test.setInventorySlot(37, makeItem({ type: bot.registry.itemsByName['diamond_sword']!.id, enchants: [{ name: 'sharpness', lvl: 5 }] }))
    await bot.test.setInventorySlot(38, makeBook([{ name: 'unbreaking', lvl: 3 }]))

    await bot.test.becomeSurvival()

    const anvil = await bot.openAnvil(b)

    const sword = bot.inventory.slots[37]
    const book = anvil.findInventoryItem(bot.registry.itemsByName['enchanted_book']!.id)

    await anvil.combine(sword!, book!)
    // test result
    assert.strictEqual(bot.experience.level, 996)
    assert.strictEqual(anvil.slots[3]!.repairCost, 1)
    assert.deepStrictEqual(anvil.slots[3]!.enchants, [{ name: 'sharpness', lvl: 5 }, { name: 'unbreaking', lvl: 3 }])
    await anvil.close()
    await bot.test.wait(1000)
  })

  addTest('using anvil.rename', async (b, renameCost, renameName, _Item, bot, _makeBook, makeItem) => { // using anvil.rename
    bot.chat(`/clear ${bot.username}`)
    await bot.test.becomeCreative()

    await bot.test.setInventorySlot(36, makeItem({ type: bot.registry.itemsByName['diamond_sword']!.id }))

    await bot.test.becomeSurvival()

    const anvil = await bot.openAnvil(b)

    const sword = anvil.findInventoryItem(bot.registry.itemsByName['diamond_sword']!.id)
    await anvil.rename(sword!, 'hello')
    // test result
    assert.strictEqual(bot.experience.level, 998)
    assert.strictEqual(anvil.slots[3]!.repairCost, renameCost())
    assert.deepStrictEqual(anvil.slots[3]!.customName, renameName('hello'))
    await anvil.close()
    await bot.test.wait(1000)
  }, false)

  addTest('two item + rename', async (b, _renameCost, renameName, Item, bot, makeBook, makeItem) => { // test 2 + a rename
    bot.chat(`/clear ${bot.username}`)
    await bot.test.becomeCreative()

    await bot.test.setInventorySlot(36, new Item(bot.registry.itemsByName['diamond_sword']!.id, 1))
    await bot.test.setInventorySlot(37, makeItem({ type: bot.registry.itemsByName['diamond_sword']!.id, enchants: [{ name: 'sharpness', lvl: 5 }] }))
    await bot.test.setInventorySlot(38, makeBook([{ name: 'unbreaking', lvl: 3 }]))

    await bot.test.becomeSurvival()

    const anvil = await bot.openAnvil(b)

    const sword = bot.inventory.slots[37]
    const book = anvil.findInventoryItem(bot.registry.itemsByName['enchanted_book']!.id)

    await anvil.combine(sword!, book!, 'lol')
    // test result
    assert.strictEqual(bot.experience.level, 995)
    assert.strictEqual(anvil.slots[3]!.repairCost, 1)
    assert.deepStrictEqual(anvil.slots[3]!.enchants, [{ name: 'sharpness', lvl: 5 }, { name: 'unbreaking', lvl: 3 }])
    assert.strictEqual(anvil.slots[3]!.customName, renameName('lol'))
    await anvil.close()
    await bot.test.wait(1000)
  })

  return tests
}
