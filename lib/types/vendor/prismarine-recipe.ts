// prismarine-recipe's d.ts (1.3) types the loader as taking only a version string; at runtime it also
// takes a registry. Cast the default export to RecipeLoader:
//   const { Recipe } = (prismarineRecipe as unknown as RecipeLoader)(bot.registry)
// Not fixable here: inShape, outShape and ingredients are typed non-null but are null when the recipe
// has none (a shaped recipe has no ingredients, a shapeless one no inShape, most have no outShape).
import type { Recipe, RecipeItem } from 'prismarine-recipe'
import type { Registry } from 'prismarine-registry'

export type RecipeLoader = (registryOrVersion: Registry | string) => { Recipe: typeof Recipe, RecipeItem: typeof RecipeItem }
