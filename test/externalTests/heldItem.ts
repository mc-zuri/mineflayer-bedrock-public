import assert from 'assert'
import prismarineItem from 'prismarine-item'
import type { TestFunction } from './plugins/testCommon.ts'

export default (): TestFunction => async (bot) => {
  const Item = prismarineItem(bot.registry)

  await bot.test.becomeCreative()
  await bot.test.clearInventory()
  await bot.test.wait(100)
  assert.equal(bot.heldItem, null)

  const stoneId = bot.registry.itemsByName['stone']!.id
  await bot.test.setInventorySlot(36, new Item(stoneId, 1))
  assert.strictEqual(bot.heldItem!.type, stoneId)

  await bot.tossStack(bot.heldItem!)
  assert.equal(bot.heldItem, null)
}
