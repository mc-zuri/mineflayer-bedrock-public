// Corrections to prismarine-windows' d.ts (2.x) for what lib/Window.js actually does.
// Merged overloads are tried before the package's own.
// Not fixable here: `title` is typed string, but mineflayer passes a ChatMessage for server-opened
// windows (open_window), and a string only for the player inventory and horse windows.
import type { Item } from 'prismarine-item'
import type { ChatMessage } from 'prismarine-chat'

declare module 'prismarine-windows' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- merged declarations repeat the class's type parameters
  interface Window<T> {
    /** returns the slots a mode 0 / 3 / 4 click changed; other modes return undefined */
    acceptClick (click: Click, gamemode?: number): number[] | undefined
    /** null empties the slot */
    updateSlot (slot: number, newItem: Item | null): void
    findInventoryItem (itemType: number | string, metadata?: number | null, notFull?: boolean): Item | null
    /** metadata null / undefined: any metadata (countRange) */
    count (itemType: number | string, metadata?: number | null): number
    containerCount (itemType: number | string, metadata?: number | null): number
    /** metadata and nbt: null / undefined match anything */
    findItemRange (start: number, end: number, itemType: number, metadata: number | null | undefined, notFull: boolean, nbt: unknown): Item | null
  }

  interface Click {
    /** the item in `slot` when clicked (null for an empty slot or -999) */
    item?: Item | null
  }

  interface WindowsExports {
    /** T: the events the caller emits on the window besides updateSlot / updateSlot:<slot> */
    createWindow<T = unknown> (id: number, type: number | string, title: string | ChatMessage, slotCount?: number): Window<T>
  }
}
