// prismarine-item's d.ts (1.18) mistypes the statics mineflayer relies on:
// - toNotch returns `object`; on pc it returns one of the Slot wire formats
// - equal and the constructor reject the null / undefined the implementation accepts
//   (equal treats null == undefined == empty slot; metadata and nbt default when nullish)
// Statics cannot be fixed by module augmentation (a namespace merged into the class clashes with
// the static methods), so ItemClass is the loader's result with these signatures put first.
import type { Item } from 'prismarine-item'
import type { Slot } from '../protocol.ts'

export interface ItemStatics {
  new (type: number, count: number, metadata?: number | null, nbt?: object | null, stackId?: number | null, sentByServer?: boolean): Item
  equal (item1: Item | null | undefined, item2: Item | null | undefined, matchStackSize?: boolean, matchNbt?: boolean): boolean
  toNotch (item: Item | null | undefined, serverAuthoritative?: boolean): Slot
  fromNotch (item: Slot, stackId?: number): Item | null
}

declare module 'prismarine-item' {
  interface Item {
    /** 1.20.5+ (itemsWithComponents): data components by type */
    componentMap?: Map<string, { type: string, data: any }>
  }
}

/** what `prismarineItem(registry)` returns */
export type ItemClass = ItemStatics & typeof Item
