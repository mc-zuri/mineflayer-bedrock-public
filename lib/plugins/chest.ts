import { Vec3 } from 'vec3'
import type { Block } from 'prismarine-block'
import type { Entity } from 'prismarine-entity'
import type { Window } from 'prismarine-windows'
import type { Chest } from '../types/mineflayer.ts'
import type { BotInternal } from '../types/internal.ts'

export default inject

function inject (bot: BotInternal): void {
  const allowedWindowTypes = ['minecraft:generic', 'minecraft:chest', 'minecraft:dispenser', 'minecraft:ender_chest', 'minecraft:shulker_box', 'minecraft:hopper', 'minecraft:container', 'minecraft:dropper', 'minecraft:trapped_chest', 'minecraft:barrel', 'minecraft:white_shulker_box', 'minecraft:orange_shulker_box', 'minecraft:magenta_shulker_box', 'minecraft:light_blue_shulker_box', 'minecraft:yellow_shulker_box', 'minecraft:lime_shulker_box', 'minecraft:pink_shulker_box', 'minecraft:gray_shulker_box', 'minecraft:light_gray_shulker_box', 'minecraft:cyan_shulker_box', 'minecraft:purple_shulker_box', 'minecraft:blue_shulker_box', 'minecraft:brown_shulker_box', 'minecraft:green_shulker_box', 'minecraft:red_shulker_box', 'minecraft:black_shulker_box']
  function matchWindowType (window: Window): boolean {
    for (const type of allowedWindowTypes) {
      if ((window.type as string).startsWith(type)) return true
    }
    return false
  }

  async function openContainer (containerToOpen: Block | Entity, direction?: Vec3, cursorPos?: Vec3): Promise<Chest> {
    direction = direction ?? new Vec3(0, 1, 0)
    cursorPos = cursorPos ?? new Vec3(0.5, 0.5, 0.5)
    let chest: Window
    if (containerToOpen.constructor.name === 'Block' && allowedWindowTypes.map(name => name.replace('minecraft:', '')).includes((containerToOpen as Block).name)) {
      chest = await bot.openBlock(containerToOpen as Block, direction, cursorPos)
    } else if (containerToOpen.constructor.name === 'Entity') {
      chest = await bot.openEntity(containerToOpen as Entity)
    } else {
      throw new Error('containerToOpen is neither a block nor an entity')
    }

    if (!matchWindowType(chest)) { throw new Error('Non-container window used as a container: ' + JSON.stringify(chest)) }
    return chest as Chest
  }

  bot.openContainer = openContainer
  bot.openChest = openContainer
  bot.openDispenser = openContainer
}
