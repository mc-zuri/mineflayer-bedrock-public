import assert from 'assert'
import { onceWithCleanup } from '../promise_utils.ts'
import prismarineItem from 'prismarine-item'
import type { Item as ItemInstance } from 'prismarine-item'
import type { BotInternal } from '../types/internal.ts'
import type { ItemClass } from '../types/vendor/prismarine-item.ts'

export default inject

/** the book's NBT as modifyBook builds it */
type BookNbt = { type: string, name?: string, value: { [tag: string]: any } }

type EditBook = (book: ItemInstance, pages: string[], title: string | null, slot: number, signing?: boolean, hand?: number) => void

function inject (bot: BotInternal): void {
  const Item = prismarineItem(bot.registry) as ItemClass

  let editBook: EditBook | undefined
  if (bot.supportFeature('editBookIsPluginChannel')) {
    bot._client.registerChannel('MC|BEdit', 'slot')
    bot._client.registerChannel('MC|BSign', 'slot')
    editBook = (book: ItemInstance, pages: string[], title: string | null, slot: number, signing = false) => {
      if (signing) bot._client.writeChannel('MC|BSign', Item.toNotch(book))
      else bot._client.writeChannel('MC|BEdit', Item.toNotch(book))
    }
  } else if (bot.supportFeature('hasEditBookPacket')) {
    if (bot.supportFeature('editBookPacketUsesNbt')) {
      editBook = (book: ItemInstance, pages: string[], title: string | null, slot: number, signing = false, hand = 0) => {
        bot._client.write('edit_book', {
          new_book: Item.toNotch(book),
          signing,
          hand
        })
      }
    } else {
      editBook = (book: ItemInstance, pages: string[], title: string | null, slot: number, signing = false, hand = 0) => {
        bot._client.write('edit_book', {
          hand: slot,
          pages,
          title: title!
        })
      }
    }
  }

  async function write (slot: number, pages: string[], author: string | null, title: string | null, signing: boolean) {
    assert.ok(slot >= 0 && slot <= 44, 'slot out of inventory range')
    const book = bot.inventory.slots[slot]
    assert.ok(book && book.type === bot.registry.itemsByName.writable_book.id, `no book found in slot ${slot}`)
    const quickBarSlot = bot.quickBarSlot
    const moveToQuickBar = slot < 36

    if (moveToQuickBar) {
      await bot.moveSlotItem(slot, 36)
      // 1.21.9+ never acknowledges an edit_book handled in the same tick as
      // the clicks that put the book in hand, so those must round-trip first.
      await bot._syncWindow(bot.inventory)
    }

    bot.setQuickBarSlot(moveToQuickBar ? 0 : slot - 36)

    const bookSlot = moveToQuickBar ? 36 : slot
    const modifiedBook = await modifyBook(bookSlot, pages, author, title, signing)
    editBook!(modifiedBook, pages, title, moveToQuickBar ? 0 : slot - 36, signing)
    // Clicks are echoed by the server as slot updates that predate the edit,
    // and the edit itself is applied asynchronously, so only an update that
    // already reflects it counts as the acknowledgement.
    await onceWithCleanup(bot.inventory, `updateSlot:${bookSlot}`, {
      timeout: 20000,
      checkCondition: (oldItem: ItemInstance | null, newItem: ItemInstance | null) => newItem && (signing ? newItem.type === bot.registry.itemsByName.written_book.id : hasPages(newItem))
    })

    bot.setQuickBarSlot(quickBarSlot)

    if (moveToQuickBar) {
      await bot.moveSlotItem(36, slot)
    }
  }

  function hasPages (item: ItemInstance) {
    if (item.componentMap) return item.componentMap.has('writable_book_content')
    return Boolean((item.nbt?.value as { pages?: unknown } | undefined)?.pages)
  }

  function modifyBook (slot: number, pages: string[], author: string | null, title: string | null, signing: boolean) {
    // a plain copy, not an Item: it keeps the fields but loses the prototype
    const book = Object.assign({}, bot.inventory.slots[slot]) as Omit<ItemInstance, 'nbt'> & { nbt: BookNbt | null }
    if (!book.nbt || book.nbt.type !== 'compound') {
      book.nbt = {
        type: 'compound',
        name: '',
        value: {}
      }
    }
    if (signing) {
      if (bot.supportFeature('clientUpdateBookIdWhenSign')) {
        book.type = bot.registry.itemsByName.written_book.id
      }
      book.nbt.value.author = {
        type: 'string',
        value: author
      }
      book.nbt.value.title = {
        type: 'string',
        value: title
      }
    }
    book.nbt.value.pages = {
      type: 'list',
      value: {
        type: 'string',
        value: pages
      }
    }
    bot.inventory.updateSlot(slot, book as ItemInstance)
    return book as ItemInstance
  }

  bot.writeBook = async (slot: number, pages: string[]) => {
    await write(slot, pages, null, null, false)
  }

  bot.signBook = async (slot: number, pages: string[], author: string, title: string) => {
    await write(slot, pages, author, title, true)
  }
}
