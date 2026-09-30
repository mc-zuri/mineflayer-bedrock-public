import assert from 'assert'
import type { Block } from 'prismarine-block'
import type { Item } from 'prismarine-item'
import type { Window } from 'prismarine-windows'
import type { Furnace } from '../types/mineflayer.ts'
import type { BotInternal } from '../types/internal.ts'
import type { ClientboundPackets } from '../types/protocol.ts'

export default inject

function inject (bot: BotInternal): void {
  const allowedWindowTypes = ['minecraft:furnace', 'minecraft:blast_furnace', 'minecraft:smoker']

  function matchWindowType (window: Window): boolean {
    for (const type of allowedWindowTypes) {
      if ((window.type as string).startsWith(type)) return true
    }
    return false
  }

  async function openFurnace (furnaceBlock: Block): Promise<Furnace> {
    // becomes a Furnace once the members below are set
    const furnace = await bot.openBlock(furnaceBlock) as Furnace
    if (!matchWindowType(furnace)) {
      throw new Error('This is not a furnace-like window')
    }

    furnace.totalFuel = null
    furnace.fuel = null
    furnace.fuelSeconds = null
    furnace.totalProgress = null
    furnace.progress = null
    furnace.progressSeconds = null
    furnace.takeInput = takeInput
    furnace.takeFuel = takeFuel
    furnace.takeOutput = takeOutput
    furnace.putInput = putInput
    furnace.putFuel = putFuel
    furnace.inputItem = function (this: Furnace) { return this.slots[0] }
    furnace.fuelItem = function (this: Furnace) { return this.slots[1] }
    furnace.outputItem = function (this: Furnace) { return this.slots[2] }

    bot._client.on('craft_progress_bar', onUpdateWindowProperty)
    furnace.once('close', () => {
      bot._client.removeListener('craft_progress_bar', onUpdateWindowProperty)
    })

    return furnace

    function onUpdateWindowProperty (packet: ClientboundPackets['craft_progress_bar']): void {
      if (packet.windowId !== furnace.id) return

      switch (packet.property) {
        case 0: // Current fuel
          furnace.fuel = 0
          furnace.fuelSeconds = 0
          if (furnace.totalFuel) {
            furnace.fuel = packet.value / furnace.totalFuel
            furnace.fuelSeconds = furnace.fuel * furnace.totalFuelSeconds!
          }
          break
        case 1: // Total fuel
          furnace.totalFuel = packet.value
          furnace.totalFuelSeconds = ticksToSeconds(furnace.totalFuel)
          break
        case 2: // Current progress
          furnace.progress = 0
          furnace.progressSeconds = 0
          if (furnace.totalProgress) {
            furnace.progress = packet.value / furnace.totalProgress
            furnace.progressSeconds = furnace.totalProgressSeconds! - (furnace.progress * furnace.totalProgressSeconds!)
          }
          break
        case 3: // Total progress
          furnace.totalProgress = packet.value
          furnace.totalProgressSeconds = ticksToSeconds(furnace.totalProgress)
      }

      furnace.emit('update')
    }

    async function takeSomething (item: Item | null): Promise<Item> {
      assert.ok(item)
      await bot.putAway(item.slot)
      return item
    }

    async function takeInput (): Promise<Item> {
      return takeSomething(furnace.inputItem())
    }

    async function takeFuel (): Promise<Item> {
      return takeSomething(furnace.fuelItem())
    }

    async function takeOutput (): Promise<Item> {
      return takeSomething(furnace.outputItem())
    }

    async function putSomething (destSlot: number, itemType: number, metadata: number | null, count: number): Promise<void> {
      const options = {
        window: furnace,
        itemType,
        metadata,
        count,
        sourceStart: furnace.inventoryStart,
        sourceEnd: furnace.inventoryEnd,
        destStart: destSlot,
        destEnd: destSlot + 1
      }
      await bot.transfer(options)
    }

    async function putInput (itemType: number, metadata: number | null, count: number): Promise<void> {
      await putSomething(0, itemType, metadata, count)
    }

    async function putFuel (itemType: number, metadata: number | null, count: number): Promise<void> {
      await putSomething(1, itemType, metadata, count)
    }
  }

  function ticksToSeconds (ticks: number): number {
    return ticks * 0.05
  }

  bot.openFurnace = openFurnace
}
