import assert from 'assert'
import { Vec3 } from 'vec3'
import prismarineItem from 'prismarine-item'
import { onceWithCleanup } from '../../lib/promise_utils.ts'
import type { Entity } from 'prismarine-entity'
import type { EquipmentDestination } from '../../lib/types/mineflayer.ts'
import type { TestBot, TestFunction } from './plugins/testCommon.ts'

// The inventory helpers' less travelled paths: full inventories, equipment slots, tossing, entity interaction.
export default (): Record<string, TestFunction> => {
  const make = async (bot: TestBot) => {
    const Item = prismarineItem(bot.registry)
    const item = (name: string, count = 1) => new Item(bot.registry.itemsByName[name]!.id, count, 0)
    const count = (name: string) => bot.inventory.count(bot.registry.itemsByName[name]!.id, null)
    // every inventory slot (9 - 44) but the ones given; on versions without a creative slot ack
    // each set waits for a rejection, so they are set concurrently
    const fillInventory = (except: number[] = []) => Promise.all(Array.from({ length: 36 }, (_, i) => 9 + i)
      .filter(slot => !except.includes(slot))
      .map(slot => bot.test.setInventorySlot(slot, item('stone', 64))))
    return { Item, item, count, fillInventory }
  }

  // Wait for an item entity to show up: the dropped stack
  const itemDropped = (bot: TestBot) => onceWithCleanup(bot, 'itemDrop', { timeout: 5000 })

  const tests: Record<string, TestFunction> = {
    async activateEntityAt (bot) {
      const { item } = await make(bot)
      const summonName = bot.registry.entitiesByName['armor_stand'] ? 'armor_stand' : 'ArmorStand'
      // as in placeEntity: 1.13's data names the armor stand object 'armorstand'
      const standName = bot.supportFeature('entityNameUpperCaseNoUnderscore')
        ? 'ArmorStand'
        : bot.supportFeature('entityNameLowerCaseNoUnderscore') ? 'armorstand' : 'armor_stand'
      await bot.test.setInventorySlot(36, item('iron_helmet'))
      bot.setQuickBarSlot(0)
      const spawned = onceWithCleanup(bot, 'entitySpawn', { timeout: 5000, checkCondition: (e: Entity) => e.name === standName })
      bot.chat(`/summon ${summonName} ~2 ~ ~`)
      const [stand] = await spawned
      // survival: the helmet leaves the hand for the stand
      await bot.test.becomeSurvival()
      const equipped = onceWithCleanup(bot, 'entityEquip', { timeout: 5000, checkCondition: (e: Entity) => e.id === stand.id })
      const handEmptied = onceWithCleanup(bot.inventory, 'updateSlot:36', { timeout: 5000, checkCondition: (_old, now) => now === null })
      await bot.activateEntityAt(stand, stand.position.offset(0, 1.6, 0))
      await Promise.all([equipped, handEmptied])
      assert.ok(stand.equipment.some(equipment => equipment?.name === 'iron_helmet'), 'the stand does not wear the helmet')
      assert.strictEqual(bot.heldItem, null)
      await bot.test.becomeCreative()
      // killEntity selects by the entity's name, which is no command id on 1.13
      const gone = onceWithCleanup(bot, 'entityGone', { timeout: 5000, checkCondition: (e: Entity) => e.id === stand.id })
      bot.chat(`/kill @e[type=${summonName}]`)
      await gone
    },

    async fullInventory (bot) {
      const { count, fillInventory } = await make(bot)
      // a chest holding 5 diamonds
      const chestPos = new Vec3(1, bot.test.groundY, 0)
      await bot.test.setBlock({ ...chestPos, blockName: 'chest' })
      const where = `block ${chestPos.x} ${chestPos.y} ${chestPos.z}`
      if (bot.registry.version['>=']('1.17')) bot.chat(`/item replace ${where} container.0 with minecraft:diamond 5`)
      else if (bot.registry.version['>=']('1.13')) bot.chat(`/replaceitem ${where} container.0 minecraft:diamond 5`)
      else bot.chat(`/replaceitem ${where} slot.container.0 minecraft:diamond 5`)
      await bot.test.awaitCommandsProcessed('chest-filled')

      await fillInventory()
      assert.strictEqual(bot.inventory.emptySlotCount(), 0)
      const chest = await bot.openContainer(bot.blockAt(chestPos)!)
      try {
        const diamond = bot.registry.itemsByName['diamond']!.id
        assert.strictEqual(chest.containerCount(diamond, null), 5)
        await assert.rejects(chest.withdraw(diamond, null, 1), /inventory is full/)

        // no room: putAway drops what it picked up
        const dropped = itemDropped(bot)
        await bot.putAway(0)
        await dropped
        assert.strictEqual(chest.containerCount(diamond, null), 0)
        assert.strictEqual(count('diamond'), 0)
        assert.strictEqual(chest.selectedItem, null)
      } finally {
        await chest.close()
      }
    },

    async consumeTwice (bot) {
      const { item } = await make(bot)
      // golden apples can be eaten with a full hunger bar (1.8 creative players cannot eat at all)
      await bot.test.setInventorySlot(36, item('golden_apple', 2))
      bot.setQuickBarSlot(0)
      await bot.test.becomeSurvival()
      const first = bot.consume()
      const second = bot.consume()
      await assert.rejects(first, /calling bot\.consume\(\) again/)
      await second
      assert.ok(!bot.usingHeldItem)
    },

    async moveSlotItem (bot) {
      const { item } = await make(bot)
      await Promise.all([
        bot.test.setInventorySlot(36, item('diamond', 3)),
        bot.test.setInventorySlot(37, item('stick', 5))
      ])
      // the stick picked up from the destination goes back where the diamond was
      await bot.moveSlotItem(36, 37)
      assert.strictEqual(bot.inventory.slots[36]?.name, 'stick')
      assert.strictEqual(bot.inventory.slots[36]?.count, 5)
      assert.strictEqual(bot.inventory.slots[37]?.name, 'diamond')
      assert.strictEqual(bot.inventory.slots[37]?.count, 3)
      assert.strictEqual(bot.inventory.selectedItem, null)
      // into an empty slot nothing comes back
      await bot.moveSlotItem(37, 20)
      assert.strictEqual(bot.inventory.slots[37], null)
      assert.strictEqual(bot.inventory.slots[20]?.name, 'diamond')
    },

    async equip (bot) {
      const { item, fillInventory } = await make(bot)
      const hasOffHand = !bot.supportFeature('doesntHaveOffHandSlot')
      const wear: Array<[EquipmentDestination, string]> = [
        ['head', 'iron_helmet'], ['torso', 'iron_chestplate'], ['legs', 'iron_leggings'], ['feet', 'iron_boots']
      ]
      if (hasOffHand) wear.push(['off-hand', 'shield'])
      await Promise.all(wear.map(([, name], i) => bot.test.setInventorySlot(9 + i, item(name))))
      await bot.test.setInventorySlot(20, item('diamond_sword'))
      bot.setQuickBarSlot(0)

      await assert.rejects(bot.equip(null as unknown as number, 'hand'), /Invalid item object/)

      for (const [destination, name] of wear) {
        await bot.equip(bot.registry.itemsByName[name]!.id, destination) // by id
        assert.strictEqual(bot.inventory.slots[bot.getEquipmentDestSlot(destination)]?.name, name, destination)
      }
      // from the main inventory to the hand: the first empty hotbar slot is selected
      await bot.equip(bot.inventory.slots[20]!, null)
      assert.strictEqual(bot.heldItem?.name, 'diamond_sword')
      assert.strictEqual(bot.quickBarSlot, 0)
      // already in the hand
      await bot.equip(bot.heldItem!, 'hand')
      // a hotbar item just gets selected
      await bot.test.setInventorySlot(40, item('stick'))
      await bot.equip(bot.inventory.slots[40]!, 'hand')
      assert.strictEqual(bot.quickBarSlot, 4)
      assert.strictEqual(bot.heldItem?.name, 'stick')

      // what the bot wears, as its entity's equipment: hand, (off hand), feet, legs, torso, head
      const equipment = bot.entity.equipment.map(e => e?.name ?? null)
      assert.deepStrictEqual(equipment, ['stick', ...(hasOffHand ? ['shield'] : []), 'iron_boots', 'iron_leggings', 'iron_chestplate', 'iron_helmet'])

      for (const [destination, name] of wear) {
        await bot.unequip(destination)
        assert.strictEqual(bot.inventory.slots[bot.getEquipmentDestSlot(destination)], null, destination)
        assert.ok(bot.inventory.items().some(i => i.name === name), `${name} went back to the inventory`)
      }
      // unequipping the hand selects an empty hotbar slot
      await bot.unequip('hand')
      assert.strictEqual(bot.heldItem, null)
      assert.strictEqual(bot.quickBarSlot, 1)

      // a full hotbar: the hand's item moves to the main inventory
      await bot.creative.clearInventory()
      await Promise.all(Array.from({ length: 9 }, (_, i) => bot.test.setInventorySlot(36 + i, item('stick', i + 1))))
      bot.setQuickBarSlot(2)
      await bot.unequip('hand')
      assert.strictEqual(bot.heldItem, null)
      assert.strictEqual(bot.quickBarSlot, 2)
      assert.ok(bot.inventory.slots.slice(9, 36).some(i => i?.name === 'stick' && i.count === 3))
      // a full hotbar and inventory: the hand's item is tossed
      await fillInventory(Array.from({ length: 9 }, (_, i) => 36 + i))
      await bot.test.setInventorySlot(38, item('stick', 3))
      const dropped = itemDropped(bot)
      await bot.unequip('hand')
      await dropped
      assert.strictEqual(bot.heldItem, null)
      // equipping from the full main inventory into a full hotbar replaces a hotbar slot
      await bot.test.setInventorySlot(38, item('stick', 3))
      await bot.test.setInventorySlot(9, item('diamond', 1))
      await bot.equip(bot.inventory.slots[9]!, 'hand')
      assert.strictEqual(bot.inventory.slots[bot.QUICK_BAR_START + bot.quickBarSlot]?.name, 'diamond') // heldItem, which the assertion above narrowed to null
    },

    async toss (bot) {
      const { item, count } = await make(bot)
      await Promise.all([
        bot.test.setInventorySlot(36, item('diamond', 10)),
        bot.test.setInventorySlot(37, item('stick', 4))
      ])
      await bot.test.becomeSurvival()
      let dropped = itemDropped(bot)
      await bot.toss(bot.registry.itemsByName['diamond']!.id, null, 3)
      await dropped
      assert.strictEqual(count('diamond'), 7)
      dropped = itemDropped(bot)
      await bot.tossStack(bot.inventory.slots[37]!)
      await dropped
      assert.strictEqual(count('stick'), 0)
      await assert.rejects(bot.toss(bot.registry.itemsByName['stick']!.id, null, 1), /Can't find stick/)
      // left and right clicks of the simple click helpers (toss put the rest of the diamonds back
      // in the first free slot of the main inventory)
      const diamondSlot = bot.inventory.findInventoryItem(bot.registry.itemsByName['diamond']!.id, null, false)!.slot
      await bot.simpleClick.leftMouse(diamondSlot)
      assert.strictEqual(bot.inventory.selectedItem?.count, 7)
      await bot.simpleClick.rightMouse(20)
      assert.strictEqual(bot.inventory.slots[20]?.count, 1)
      await bot.simpleClick.leftMouse(diamondSlot)
      assert.strictEqual(bot.inventory.selectedItem, null)
      assert.strictEqual(bot.inventory.slots[diamondSlot]?.count, 6)
    }
  }
  return Object.fromEntries(Object.entries(tests).map(([name, test]) => [name, async (bot: TestBot, done: Mocha.Done) => {
    await test(bot, done)
    bot.setQuickBarSlot(0) // the hotbar selection survives the reset between tests, and later tests hold their items in slot 0
  }]))
}
