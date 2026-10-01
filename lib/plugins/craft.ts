import assert from 'assert'
import { once } from '../promise_utils.ts'
import prismarineItem from 'prismarine-item'
import prismarineRecipe from 'prismarine-recipe'
import type { Block } from 'prismarine-block'
import type { Recipe as RecipeT, RecipeItem } from 'prismarine-recipe'
import type { Window } from 'prismarine-windows'
import type { BotInternal } from '../types/internal.ts'
import type { ItemClass } from '../types/vendor/prismarine-item.ts'
import type { RecipeLoader } from '../types/vendor/prismarine-recipe.ts'

export default inject

function inject (bot: BotInternal): void {
  const Item = prismarineItem(bot.registry) as ItemClass
  const Recipe = (prismarineRecipe as unknown as RecipeLoader)(bot.registry).Recipe
  let windowCraftingTable: Window | undefined

  async function craft (recipe: RecipeT, count?: number | null, craftingTable?: Block | null): Promise<void> {
    assert.ok(recipe)
    count = parseInt((count ?? 1) as unknown as string, 10) // parseInt stringifies a number
    if (recipe.requiresTable && !craftingTable) {
      throw new Error('Recipe requires craftingTable, but one was not supplied: ' + JSON.stringify(recipe))
    }

    try {
      for (let i = 0; i < count; i++) {
        await craftOnce(recipe, craftingTable)
      }

      if (windowCraftingTable) {
        // The last put-away click is unconfirmed; closing on a wrong model
        // leaves items the server never placed.
        await bot._syncWindow(windowCraftingTable)
        await bot.closeWindow(windowCraftingTable)
        windowCraftingTable = undefined
      }
    } catch (err) {
      if (windowCraftingTable) {
        bot.closeWindow(windowCraftingTable)
        windowCraftingTable = undefined
      }
      throw err
    }
  }

  async function craftOnce (recipe: RecipeT, craftingTable: Block | null | undefined): Promise<void> {
    if (craftingTable) {
      if (!windowCraftingTable) {
        bot.activateBlock(craftingTable)
        const [window] = await once(bot, 'windowOpen')
        windowCraftingTable = window
      }
      // createWindow sets the window key (a string) as type
      if (!(windowCraftingTable.type as string).startsWith('minecraft:crafting')) {
        throw new Error('crafting: non craftingTable used as craftingTable: ' + windowCraftingTable.type)
      }
      await startClicking(windowCraftingTable, 3, 3)
    } else {
      await startClicking(bot.inventory, 2, 2)
    }

    async function startClicking (window: Window, w: number, h: number): Promise<void> {
      const extraSlots = unusedRecipeSlots()
      let ingredientIndex = 0
      let originalSourceSlot: number | null = null
      let it: { x: number, y: number, row: RecipeItem[] }
      if (recipe.inShape) {
        it = {
          x: 0,
          y: 0,
          row: recipe.inShape[0]!
        }
        await clickShape()
      } else {
        await nextIngredientsClick()
      }

      function incrementShapeIterator (): typeof it | null {
        it.x += 1
        if (it.x >= it.row.length) {
          it.y += 1
          if (it.y >= recipe.inShape.length) return null
          it.x = 0
          it.row = recipe.inShape[it.y]!
        }
        return it
      }

      async function nextShapeClick (): Promise<void> {
        if (incrementShapeIterator()) {
          await clickShape()
        } else if (!recipe.ingredients) {
          await putMaterialsAway()
        } else {
          await nextIngredientsClick()
        }
      }

      async function clickShape (): Promise<void> {
        const destSlot = slot(it.x, it.y)
        const ingredient = it.row[it.x]!
        if (ingredient.id === -1) return nextShapeClick()
        if (!window.selectedItem || window.selectedItem.type !== ingredient.id ||
          (ingredient.metadata != null &&
            window.selectedItem.metadata !== ingredient.metadata)) {
          // we are not holding the item we need. click it.
          const sourceItem = window.findInventoryItem(ingredient.id, ingredient.metadata)
          if (!sourceItem) throw new Error('missing ingredient')
          if (originalSourceSlot == null) originalSourceSlot = sourceItem.slot
          await bot.clickWindow(sourceItem.slot, 0, 0)
        }
        await bot.clickWindow(destSlot, 1, 0)
        await nextShapeClick()
      }

      async function nextIngredientsClick (): Promise<void> {
        const ingredient = recipe.ingredients[ingredientIndex]!
        const destSlot = extraSlots.pop()! // a shapeless recipe has at most w * h ingredients
        if (!window.selectedItem || window.selectedItem.type !== ingredient.id ||
          (ingredient.metadata != null &&
            window.selectedItem.metadata !== ingredient.metadata)) {
          // we are not holding the item we need. click it.
          const sourceItem = window.findInventoryItem(ingredient.id, ingredient.metadata)
          if (!sourceItem) throw new Error('missing ingredient')
          if (originalSourceSlot == null) originalSourceSlot = sourceItem.slot
          await bot.clickWindow(sourceItem.slot, 0, 0)
        }
        await bot.clickWindow(destSlot, 1, 0)
        if (++ingredientIndex < recipe.ingredients.length) {
          await nextIngredientsClick()
        } else {
          await putMaterialsAway()
        }
      }

      async function putMaterialsAway (): Promise<void> {
        const start = window.inventoryStart
        const end = window.inventoryEnd
        await bot.putSelectedItemRange(start, end, window, originalSourceSlot)
        await grabResult()
      }

      async function grabResult (): Promise<void> {
        assert.strictEqual(window.selectedItem, null)
        // Causes a double-emit on 1.12+ --nickelpro
        // put the recipe result in the output
        const item = new Item(recipe.result.id, recipe.result.count, recipe.result.metadata)
        window.updateSlot(0, item)
        await bot.putAway(0)
        await updateOutShape()
      }

      async function updateOutShape (): Promise<void> {
        if (!recipe.outShape) {
          for (let i = 1; i <= w * h; i++) {
            window.updateSlot(i, null)
          }
          return
        }
        const slotsToClick: number[] = []
        for (let y = 0; y < recipe.outShape.length; ++y) {
          const row = recipe.outShape[y]!
          for (let x = 0; x < row.length; ++x) {
            const _slot = slot(x, y)
            let item = null
            if (row[x]!.id !== -1) {
              item = new Item(row[x]!.id, row[x]!.count, row[x]!.metadata || null)
              slotsToClick.push(_slot)
            }
            window.updateSlot(_slot, item)
          }
        }
        for (const _slot of slotsToClick) {
          await bot.putAway(_slot)
        }
      }

      function slot (x: number, y: number): number {
        return 1 + x + w * y
      }

      function unusedRecipeSlots (): number[] {
        const result: number[] = []
        let x
        let y
        let row
        if (recipe.inShape) {
          for (y = 0; y < recipe.inShape.length; ++y) {
            row = recipe.inShape[y]!
            for (x = 0; x < row.length; ++x) {
              if (row[x]!.id === -1) result.push(slot(x, y))
            }
            for (; x < w; ++x) {
              result.push(slot(x, y))
            }
          }
          for (; y < h; ++y) {
            for (x = 0; x < w; ++x) {
              result.push(slot(x, y))
            }
          }
        } else {
          for (y = 0; y < h; ++y) {
            for (x = 0; x < w; ++x) {
              result.push(slot(x, y))
            }
          }
        }
        return result
      }
    }
  }

  function recipesFor (itemType: number, metadata: number | null, minResultCount: number | null, craftingTable?: Block | boolean | null): RecipeT[] {
    minResultCount = minResultCount ?? 1
    const results: RecipeT[] = []
    Recipe.find(itemType, metadata).forEach((recipe) => {
      if (requirementsMetForRecipe(recipe, minResultCount, craftingTable)) {
        results.push(recipe)
      }
    })
    return results
  }

  function recipesAll (itemType: number, metadata: number | null, craftingTable?: Block | boolean | null): RecipeT[] {
    const results: RecipeT[] = []
    Recipe.find(itemType, metadata).forEach((recipe) => {
      if (!recipe.requiresTable || craftingTable) {
        results.push(recipe)
      }
    })
    return results
  }

  function requirementsMetForRecipe (recipe: RecipeT, minResultCount: number, craftingTable?: Block | boolean | null): boolean {
    if (recipe.requiresTable && !craftingTable) return false

    // how many times we have to perform the craft to achieve minResultCount
    const craftCount = Math.ceil(minResultCount / recipe.result.count)

    // false if not enough inventory to make all the ones that we want
    for (let i = 0; i < recipe.delta.length; ++i) {
      const d = recipe.delta[i]!
      if (bot.inventory.count(d.id, d.metadata) + d.count * craftCount < 0) return false
    }

    // otherwise true
    return true
  }

  bot.craft = craft
  bot.recipesFor = recipesFor
  bot.recipesAll = recipesAll
}
