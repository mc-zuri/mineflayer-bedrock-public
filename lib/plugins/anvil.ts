import assert from 'assert'
import { sleep } from '../promise_utils.ts'
import { once } from '../promise_utils.ts'
import prismarineItem from 'prismarine-item'
import type { Item as ItemInstance } from 'prismarine-item'
import type { Block } from 'prismarine-block'
import type { Window } from 'prismarine-windows'
import type { Anvil } from '../types/mineflayer.ts'
import type { BotInternal } from '../types/internal.ts'

export default inject

function inject (bot: BotInternal): void {
  const Item = prismarineItem(bot.registry)

  const matchWindowType = (window: Window): boolean => /minecraft:(?:chipped_|damaged_)?anvil/.test(window.type as string)

  async function openAnvil (anvilBlock: Block): Promise<Anvil> {
    const anvil = await bot.openBlock(anvilBlock) as Anvil
    if (!matchWindowType(anvil)) {
      throw new Error('Not a anvil-like window: ' + JSON.stringify(anvil))
    }

    function err (name: string): never {
      anvil.close()
      throw new Error(name)
    }

    function sendItemName (name: string): void {
      if (bot.supportFeature('useMCItemName')) {
        bot._client.writeChannel('MC|ItemName', name)
      } else {
        bot._client.write('name_item', { name })
      }
    }

    async function addCustomName (name: string | undefined): Promise<void> {
      if (!name) return
      for (let i = 1; i < name.length + 1; i++) {
        sendItemName(name.substring(0, i))
        await sleep(50)
      }
    }
    async function putInAnvil (itemOne: ItemInstance, itemTwo: ItemInstance): Promise<void> {
      await putSomething(0, itemOne.type, itemOne.metadata, itemOne.count, itemOne.nbt)
      sendItemName('') // sent like this by vnailla
      if (!bot.supportFeature('useMCItemName')) sendItemName('')
      await putSomething(1, itemTwo.type, itemTwo.metadata, itemTwo.count, itemTwo.nbt)
    }

    async function combine (itemOne: ItemInstance, itemTwo: ItemInstance, name?: string): Promise<void> {
      if (name?.length! > 35) err('Name is too long.')
      if (bot.supportFeature('useMCItemName')) {
        bot._client.registerChannel('MC|ItemName', 'string')
      }

      assert.ok(itemOne && itemTwo)
      const { xpCost: normalCost } = Item.anvil(itemOne, itemTwo, bot.game.gameMode === 'creative', name)
      const { xpCost: inverseCost } = Item.anvil(itemTwo, itemOne, bot.game.gameMode === 'creative', name)
      if (normalCost === 0 && inverseCost === 0) err('Not anvil-able (in either direction), cancelling.')

      // the cost of the order put in the anvil below (0 means that order is not possible)
      const smallest = normalCost === 0 ? inverseCost : inverseCost === 0 ? normalCost : Math.min(normalCost, inverseCost)
      // level is null until the first experience packet, which compares as 0
      if (bot.game.gameMode !== 'creative' && bot.experience.level! < smallest) {
        err('Player does not have enough xp to do action, cancelling.')
      }

      const xpPromise = bot.game.gameMode === 'creative' ? Promise.resolve() : once(bot, 'experience')
      if (normalCost === 0) await putInAnvil(itemTwo, itemOne)
      else if (inverseCost === 0) await putInAnvil(itemOne, itemTwo)
      else if (normalCost < inverseCost) await putInAnvil(itemOne, itemTwo)
      else await putInAnvil(itemTwo, itemOne)

      await addCustomName(name)
      await bot.putAway(2)
      await xpPromise
    }

    async function rename (item: ItemInstance, name?: string): Promise<void> {
      if (name?.length! > 35) err('Name is too long.')
      if (bot.supportFeature('useMCItemName')) {
        bot._client.registerChannel('MC|ItemName', 'string')
      }
      assert.ok(item)
      const { xpCost: normalCost } = Item.anvil(item, null, bot.game.gameMode === 'creative', name)
      if (normalCost === 0) err('Not valid rename, cancelling.')

      if (bot.game.gameMode !== 'creative' && bot.experience.level! < normalCost) {
        err('Player does not have enough xp to do action, cancelling.')
      }
      const xpPromise = once(bot, 'experience')
      await putSomething(0, item.type, item.metadata, item.count, item.nbt)
      sendItemName('') // sent like this by vnailla
      if (!bot.supportFeature('useMCItemName')) sendItemName('')
      await addCustomName(name)
      await bot.putAway(2)
      await xpPromise
    }

    async function putSomething (destSlot: number, itemId: number, metadata: number | null, count: number, nbt: ItemInstance['nbt']): Promise<void> {
      const options = {
        window: anvil,
        itemType: itemId,
        metadata,
        count,
        nbt,
        sourceStart: anvil.inventoryStart,
        sourceEnd: anvil.inventoryEnd,
        destStart: destSlot,
        destEnd: destSlot + 1
      }
      await bot.transfer(options)
    }

    anvil.combine = combine
    anvil.rename = rename

    return anvil
  }

  bot.openAnvil = openAnvil
}
