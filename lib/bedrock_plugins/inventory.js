const assert = require('assert')

module.exports = inject

const QUICK_BAR_START = 36
const QUICK_BAR_COUNT = 9
const ARMOR_SLOTS = [5, 6, 7, 8]
const OFFHAND_SLOT = 45

function inject (bot) {
  const Item = require('prismarine-item')(bot.registry)
  const windows = require('prismarine-windows')(bot.registry)
  const networkToCanonical = new Map()
  const canonicalToNetwork = new Map()

  bot.quickBarSlot = 0
  bot.inventory = windows.createWindow(0, 'minecraft:inventory', 'Inventory')
  bot.currentWindow = null
  bot.QUICK_BAR_START = QUICK_BAR_START

  Object.defineProperty(bot, 'heldItem', {
    get: () => bot.inventory.slots[QUICK_BAR_START + bot.quickBarSlot]
  })

  bot.updateHeldItem = () => bot.emit('heldItemChanged', bot.heldItem)
  bot.getEquipmentDestSlot = destination => {
    const slot = {
      hand: QUICK_BAR_START + bot.quickBarSlot,
      head: 5,
      torso: 6,
      legs: 7,
      feet: 8,
      'off-hand': OFFHAND_SLOT
    }[destination]
    assert.ok(slot != null, `invalid destination: ${destination}`)
    return slot
  }

  bot.setQuickBarSlot = slot => {
    assert.ok(Number.isInteger(slot) && slot >= 0 && slot < QUICK_BAR_COUNT, 'slot must be between 0 and 8')
    if (bot.quickBarSlot === slot) return
    bot.quickBarSlot = slot
    const packet = {
      runtime_entity_id: compatibleRuntimeId(bot.entity?.id ?? bot._client.entityId ?? 0),
      item: toNotch(bot.heldItem),
      slot,
      selected_slot: slot,
      window_id: 'inventory'
    }
    if (typeof bot._client.queue === 'function') bot._client.queue('mob_equipment', packet)
    else bot._client.write('mob_equipment', packet)
    syncLocalEquipment()
    bot.updateHeldItem()
  }

  // Inventory item moving via item_stack_request (verified shape from a relay capture). Slots are Bedrock inventory
  // slots (0-8 hotbar, 9-35 main). The server validates the stack ids, so we read them from the current slots, and
  // client request ids are negative and odd. Moves that cross between the hotbar and the main inventory need the
  // inventory screen open first (bot.openInventory()); a hotbar-only move does not. Verified live on 1.26.45.
  // One shared item_stack_request id counter for the whole bot: the inventory, crafting and furnace plugins all send
  // item_stack_requests, and the server keys its item_stack_response by this id, so the ids must be unique across them
  // (separate per-plugin counters collide on the same negative-odd sequence and cross-wire the responses).
  if (!bot._stackRequest) bot._stackRequest = { id: 1 }
  const nextRequestId = () => { bot._stackRequest.id -= 2; return bot._stackRequest.id }
  // Bedrock addresses the hotbar (container 'hotbar', slots 0-8) and the main inventory (container 'inventory', slots
  // 9-35) in item_stack_request. The slot number is the ABSOLUTE bedrock slot in both containers - the container_id
  // splits the range, it does not rebase the slot. (Verified live: place into 'inventory' slot 9/14 is accepted; slot 0
  // is rejected. An earlier 0-26 rebase only ever worked because it was tested hotbar-to-hotbar.)
  const slotInfo = (bedrockSlot, stackId) => {
    const container = bedrockSlot < QUICK_BAR_COUNT ? 'hotbar' : 'inventory'
    return { slot_type: { container_id: container }, slot: bedrockSlot, stack_id: stackId ?? 0 }
  }
  const sendStack = (name, packet) => { if (typeof bot._client.queue === 'function') bot._client.queue(name, packet); else bot._client.write(name, packet) }

  const pendingStackRequests = new Map()

  bot.moveInventoryItem = (fromSlot, toSlot, count) => {
    const src = bot.inventory.slots[playerSlot(fromSlot)]
    if (!src) throw new Error('moveInventoryItem: source slot is empty')
    const dst = bot.inventory.slots[playerSlot(toSlot)]
    const requestId = nextRequestId()
    const action = dst
      ? { type_id: 'swap', legacy_type_id: 2, source: slotInfo(fromSlot, src.stackId), destination: slotInfo(toSlot, dst.stackId) }
      : { type_id: 'place', legacy_type_id: 1, count: count ?? src.count, source: slotInfo(fromSlot, src.stackId), destination: slotInfo(toSlot, 0) }
    pendingStackRequests.set(requestId, { from: fromSlot, to: toSlot, swap: !!dst, count: dst ? undefined : count })
    sendStack('item_stack_request', { requests: [{ request_id: requestId, actions: [action], custom_names: [], cause: -1 }] })
    return requestId
  }

  // A slot in the open container (chest/furnace/...). Bedrock addresses it as the 'container' container_id, slot 0-based
  // in that window.
  const openContainerSlot = (slot, stackId) => ({ slot_type: { container_id: 'container' }, slot, stack_id: stackId ?? 0 })

  // Move an item from a player inventory slot (0-8 hotbar, 9-35 main) into the open container's slot. Verified shape:
  // item_stack_request place(inventory/hotbar -> container). The server broadcasts each side (inventory_slot for the
  // container window, the response counts for the player side), so we do not predict the move locally.
  bot.depositItem = (inventorySlot, containerSlot, count) => {
    if (!bot.currentWindow) throw new Error('depositItem: no container is open')
    const src = bot.inventory.slots[playerSlot(inventorySlot)]
    if (!src) throw new Error('depositItem: source slot is empty')
    const moved = count ?? src.count
    const requestId = nextRequestId()
    const action = { type_id: 'place', legacy_type_id: 1, count: moved, source: slotInfo(inventorySlot, src.stackId), destination: openContainerSlot(containerSlot, 0) }
    pendingStackRequests.set(requestId, { container: 'deposit', playerSlot: inventorySlot, count: moved })
    sendStack('item_stack_request', { requests: [{ request_id: requestId, actions: [action], custom_names: [], cause: -1 }] })
    return requestId
  }

  // Move an item from the open container's slot into a player inventory slot (0-8 hotbar, 9-35 main).
  bot.withdrawItem = (containerSlot, inventorySlot, count) => {
    if (!bot.currentWindow) throw new Error('withdrawItem: no container is open')
    const src = (bot.currentWindow.slots || [])[containerSlot]
    if (!src) throw new Error('withdrawItem: container slot is empty')
    const moved = count ?? src.count
    const requestId = nextRequestId()
    const action = { type_id: 'place', legacy_type_id: 1, count: moved, source: openContainerSlot(containerSlot, src.stackId), destination: slotInfo(inventorySlot, 0) }
    pendingStackRequests.set(requestId, { container: 'withdraw', playerSlot: inventorySlot, count: moved, item: src })
    sendStack('item_stack_request', { requests: [{ request_id: requestId, actions: [action], custom_names: [], cause: -1 }] })
    return requestId
  }

  const namedContainerSlot = (containerId, slot, stackId) => ({ slot_type: { container_id: containerId }, slot, stack_id: stackId ?? 0 })
  const ARMOR_DEST = { head: 0, torso: 1, legs: 2, feet: 3 }
  const settle = (ms = 450) => new Promise(resolve => setTimeout(resolve, ms))

  // Equip an item to a destination: 'hand' (select or move to the held hotbar slot), 'head'/'torso'/'legs'/'feet'
  // (the armor container, slots 0-3) or 'off-hand' (the offhand container). Armor/offhand moves go over item_stack_request
  // like any cross-container move and need the inventory screen open, which we open if needed. item may be an inventory
  // Item, or an item type id / name.
  bot.equip = async (item, destination = 'hand') => {
    const target = (item && typeof item === 'object' && item.slot != null) ? item : (bot.inventory.items() || []).find(i => i.type === item || i.name === item)
    if (!target) throw new Error('equip: item not found in the inventory')
    const bedrockSlot = target.slot >= QUICK_BAR_START ? target.slot - QUICK_BAR_START : target.slot
    if (destination === 'hand') {
      if (target.slot >= QUICK_BAR_START && target.slot < QUICK_BAR_START + QUICK_BAR_COUNT) { bot.setQuickBarSlot(target.slot - QUICK_BAR_START); return }
      if (!bot.currentWindow && typeof bot.openInventory === 'function') { bot.openInventory(); await settle() }
      bot.moveInventoryItem(bedrockSlot, bot.quickBarSlot)
      await settle()
      return
    }
    if (destination === 'off-hand') {
      // Bedrock moves an item into the off-hand with a legacy normal inventory_transaction (player inventory window 0 ->
      // off-hand window 119), NOT item_stack_request - the server rejects those (status 50/49). Verified against BDS:
      // the item leaves the source slot and appears in the off-hand. The server only accepts off-hand-valid items.
      const src = bot.inventory.slots[playerSlot(bedrockSlot)]
      if (!src) throw new Error('equip: source slot is empty')
      const netItem = toNotch(src)
      const emptyItem = { network_id: 0, count: 0, metadata: 0, has_stack_id: false, block_runtime_id: 0 }
      sendStack('inventory_transaction', {
        transaction: {
          legacy: { legacy_request_id: 0 },
          transaction_type: 'normal',
          actions: [
            { source_type: 'container', container_presence: true, window_id: 0, flag_presence: true, slot: bedrockSlot, old_item: netItem, new_item: emptyItem },
            { source_type: 'container', container_presence: true, window_id: 119, flag_presence: true, slot: 0, old_item: emptyItem, new_item: netItem }
          ]
        }
      })
      bot.inventory.updateSlot(OFFHAND_SLOT, src)
      bot.inventory.updateSlot(playerSlot(bedrockSlot), null)
      syncLocalEquipment()
      await settle()
      return
    }
    if (!(destination in ARMOR_DEST)) throw new Error(`equip: unknown destination ${destination}`)
    const containerId = 'armor'
    const cslot = ARMOR_DEST[destination]
    const destPrismarine = ARMOR_SLOTS[cslot]
    if (!bot.currentWindow && typeof bot.openInventory === 'function') { bot.openInventory(); await settle() }
    const src = bot.inventory.slots[playerSlot(bedrockSlot)]
    if (!src) throw new Error('equip: source slot is empty')
    const requestId = nextRequestId()
    const action = { type_id: 'place', legacy_type_id: 1, count: src.count, source: slotInfo(bedrockSlot, src.stackId), destination: namedContainerSlot(containerId, cslot, 0) }
    pendingStackRequests.set(requestId, { equip: destPrismarine, from: bedrockSlot, item: src })
    sendStack('item_stack_request', { requests: [{ request_id: requestId, actions: [action], custom_names: [], cause: -1 }] })
    await settle()
  }

  // Move the item worn in `destination` back to a free inventory slot.
  bot.unequip = async (destination) => {
    if (destination === 'hand') {
      // Empty the held slot: prefer selecting an empty hotbar slot (no server move), else move the held item into a
      // free main-inventory slot. mineflayer-tool relies on this to drop a worse tool before digging by hand.
      const held = bot.inventory.slots[QUICK_BAR_START + bot.quickBarSlot]
      if (!held) return
      for (let s = 0; s < QUICK_BAR_COUNT; s++) {
        if (s !== bot.quickBarSlot && !bot.inventory.slots[QUICK_BAR_START + s]) { bot.setQuickBarSlot(s); return }
      }
      let freeMain = null
      for (let s = 9; s < 36 && freeMain == null; s++) if (!bot.inventory.slots[s]) freeMain = s
      if (freeMain == null) throw new Error('unequip: no free inventory slot')
      if (!bot.currentWindow && typeof bot.openInventory === 'function') { bot.openInventory(); await settle() }
      bot.moveInventoryItem(bot.quickBarSlot, freeMain)
      await settle()
      return
    }
    const src = destination === 'off-hand' ? OFFHAND_SLOT : ARMOR_SLOTS[ARMOR_DEST[destination]]
    if (src == null) throw new Error(`unequip: unknown destination ${destination}`)
    const worn = bot.inventory.slots[src]
    if (!worn) throw new Error(`unequip: nothing worn in ${destination}`)
    const containerId = destination === 'off-hand' ? 'offhand' : 'armor'
    const cslot = destination === 'off-hand' ? 0 : ARMOR_DEST[destination]
    let free = null
    for (let s = 9; s < 36 && free == null; s++) if (!bot.inventory.slots[s]) free = s
    for (let s = 0; s < 9 && free == null; s++) if (!bot.inventory.slots[QUICK_BAR_START + s]) free = s
    if (free == null) throw new Error('unequip: no free inventory slot')
    if (!bot.currentWindow && typeof bot.openInventory === 'function') { bot.openInventory(); await settle() }
    const requestId = nextRequestId()
    const action = { type_id: 'place', legacy_type_id: 1, count: worn.count, source: namedContainerSlot(containerId, cslot, worn.stackId), destination: slotInfo(free, 0) }
    pendingStackRequests.set(requestId, { unequip: playerSlot(free), from: src, item: worn })
    sendStack('item_stack_request', { requests: [{ request_id: requestId, actions: [action], custom_names: [], cause: -1 }] })
    await settle()
  }

  // Drop items to the ground. Bedrock: an item_stack_request 'drop' action from the item's slot (verified live: the
  // server accepts it and spawns the item entity, and the stack shrinks). Slots are the usual 0-8 hotbar / 9-35 main.
  bot.tossStack = async (item, count) => {
    if (!item || item.slot == null) throw new Error('tossStack: an inventory item is required')
    const bedrockSlot = item.slot >= QUICK_BAR_START ? item.slot - QUICK_BAR_START : item.slot
    const n = count ?? item.count
    const requestId = nextRequestId()
    const action = { type_id: 'drop', legacy_type_id: 3, count: n, source: slotInfo(bedrockSlot, item.stackId), randomly: false }
    pendingStackRequests.set(requestId, { drop: playerSlot(bedrockSlot), count: n })
    sendStack('item_stack_request', { requests: [{ request_id: requestId, actions: [action], custom_names: [], cause: -1 }] })
    await settle()
  }
  bot.toss = async (itemType, metadata, count) => {
    const item = (bot.inventory.items() || []).find(i => (i.type === itemType || i.name === itemType) && (metadata == null || i.metadata === metadata))
    if (!item) throw new Error('toss: item not found in the inventory')
    return bot.tossStack(item, count)
  }

  // The server confirms an item_stack_request with an item_stack_response and does not resend the slots, so on success
  // we apply the move locally (the response carries the new counts/stack ids per slot).
  bot._client.on('item_stack_response', packet => {
    for (const response of packet.responses || []) {
      const req = pendingStackRequests.get(response.request_id)
      pendingStackRequests.delete(response.request_id)
      if (response.status === 'ok' && req && req.drop != null) {
        // Dropped items: the source slot loses `count`.
        const it = bot.inventory.slots[req.drop]
        if (it) { it.count -= req.count; if (it.count <= 0) bot.inventory.updateSlot(req.drop, null) }
        applyStackIds(response)
        syncLocalEquipment()
        bot.updateHeldItem()
      } else if (response.status === 'ok' && req && !req.container && req.equip == null && req.unequip == null) {
        // Player-inventory-only move (moveInventoryItem): the server does not resend the slots, so relocate locally.
        const fromP = playerSlot(req.from)
        const toP = playerSlot(req.to)
        const fromItem = bot.inventory.slots[fromP]
        const toItem = bot.inventory.slots[toP]
        if (req.swap) {
          bot.inventory.updateSlot(fromP, toItem || null); bot.inventory.updateSlot(toP, fromItem || null)
        } else if (req.count != null && fromItem && req.count < fromItem.count) {
          // Partial place: the dest gains `count`, the source keeps the remainder (Java stack split).
          if (toItem && toItem.type === fromItem.type) { toItem.count += req.count } else { const copy = fromItem.clone ? fromItem.clone() : { ...fromItem }; copy.count = req.count; copy.stackId = undefined; bot.inventory.updateSlot(toP, copy) }
          fromItem.count -= req.count; bot.inventory.updateSlot(fromP, fromItem)
        } else {
          bot.inventory.updateSlot(toP, fromItem || null); bot.inventory.updateSlot(fromP, null)
        }
        applyStackIds(response)
        syncLocalEquipment()
        bot.updateHeldItem()
      } else if (response.status === 'ok' && req && req.container) {
        // Container transfer. The open container's own side is updated by the containers plugin (inventory_slot on the
        // window). Here we settle the player side: a deposit's source loses `count`; a withdraw's destination gains the
        // item (creating it in an empty slot, since the server does not resend the player item there). applyStackIds
        // then corrects counts/stack ids from the server's response.
        const p = playerSlot(req.playerSlot)
        if (req.container === 'deposit') {
          const it = bot.inventory.slots[p]
          if (it) { it.count -= req.count; if (it.count <= 0) bot.inventory.updateSlot(p, null) }
        } else {
          const existing = bot.inventory.slots[p]
          if (existing && existing.type === req.item.type) { existing.count += req.count } else if (!existing && req.item) { const copy = req.item.clone ? req.item.clone() : { ...req.item }; copy.count = req.count; bot.inventory.updateSlot(p, copy) }
        }
        applyStackIds(response)
        syncLocalEquipment()
        bot.updateHeldItem()
      } else if (response.status === 'ok' && req && (req.equip != null || req.unequip != null)) {
        // Equip: the source item moves to the armor/offhand prismarine slot. Unequip: the worn item moves to a free
        // inventory slot. Relocate locally (the server does not resend these slots for a self-inventory move). For equip
        // req.from is a bedrock inventory slot; for unequip it is already an armor/offhand prismarine slot.
        const dest = req.equip != null ? req.equip : req.unequip
        const fromP = req.equip != null ? playerSlot(req.from) : req.from
        // Use the item captured at request time: the server may already have cleared the source slot (e.g. it broadcasts
        // the armor change) before this response arrives, so reading the slot now can be null.
        const moved = req.item || bot.inventory.slots[fromP]
        bot.inventory.updateSlot(dest, moved || null)
        bot.inventory.updateSlot(fromP, null)
        applyStackIds(response)
        syncLocalEquipment()
        bot.updateHeldItem()
      }
      if (response.status === 'ok' && !req && response.request_id < bot._stackRequest.id) applyUnrequested(response)
      bot.emit('itemStackResponse', response.status, response.request_id, response)
    }
  })

  // The item on the cursor while the inventory screen moves it (a take puts it there, a place takes it off).
  let cursor = null
  // A response to a request this bot did not make (the player's own, through the inventory screen): the slots take
  // what the response says, each item found by its stack id where it was before, on the cursor or in the inventory.
  function applyUnrequested (response) {
    const byStack = new Map()
    for (const item of [cursor, ...bot.inventory.slots]) if (item && item.stackId != null) byStack.set(item.stackId, item)
    for (const container of response.containers || []) {
      const cid = container.slot_type.container_id
      if (cid !== 'hotbar' && cid !== 'inventory' && cid !== 'cursor') continue
      for (const s of container.slots || []) {
        const known = byStack.get(s.item_stack_id)
        let item = null
        if (s.count > 0 && known) {
          item = known.clone ? known.clone() : Object.assign(Object.create(Object.getPrototypeOf(known)), known)
          item.count = s.count
          item.stackId = s.item_stack_id
        }
        if (cid === 'cursor') cursor = item
        else bot.inventory.updateSlot(playerSlot(s.slot), item)
      }
    }
    syncLocalEquipment()
    bot.updateHeldItem()
  }

  // Update local slot counts / stack ids from a successful response's container slots. Only the player-inventory
  // containers are applied here (the response's slot is the absolute bedrock slot); the open container's own side is
  // updated from its inventory_slot/inventory_content by the containers plugin.
  function applyStackIds (response) {
    for (const container of response.containers || []) {
      const cid = container.slot_type.container_id
      if (cid !== 'hotbar' && cid !== 'inventory') continue
      for (const s of container.slots || []) {
        const p = playerSlot(s.slot)
        const item = bot.inventory.slots[p]
        if (s.count === 0) { bot.inventory.updateSlot(p, null) } else if (item) { item.count = s.count; if (s.item_stack_id != null) item.stackId = s.item_stack_id }
      }
    }
  }

  bot._client.on('item_registry', packet => registerItems(packet.itemstates))
  bot._client.on('start_game', packet => registerItems(packet.itemstates))
  bot._bedrockItemFromNotch = fromNotch
  bot._bedrockItemToNotch = toNotch

  // the held stack as a key, to tell whether an update changed what the hand holds
  const heldKey = () => { const item = bot.heldItem; return item ? `${item.type}:${item.metadata}:${item.count}` : '' }

  bot._client.on('inventory_content', packet => {
    const held = heldKey()
    if (packet.window_id === 'inventory') {
      for (let slot = 0; slot < 36; slot++) setInventorySlot(playerSlot(slot), packet.input[slot])
    } else if (packet.window_id === 'armor') {
      for (let slot = 0; slot < ARMOR_SLOTS.length; slot++) setInventorySlot(ARMOR_SLOTS[slot], packet.input[slot])
    } else if (packet.window_id === 'offhand') {
      setInventorySlot(OFFHAND_SLOT, packet.input[0])
    } else {
      return
    }
    syncLocalEquipment()
    bot.emit(`setWindowItems:${packet.window_id}`)
    if (heldKey() !== held) bot.updateHeldItem()
  })

  bot._client.on('inventory_slot', packet => {
    const slot = windowSlot(packet.window_id, packet.slot)
    if (slot == null) return
    const held = heldKey()
    setInventorySlot(slot, packet.item)
    syncLocalEquipment()
    if (heldKey() !== held) bot.updateHeldItem()
  })

  // Server-driven inventory changes that the client did not request (ground pickups, world interactions) arrive as a
  // normal inventory_transaction rather than an inventory_slot/content update - this is how BDS reports a pickup. Apply
  // each container action's authoritative new_item so the slot carries the real server stack_id, which item_stack_request
  // (craft, move, equip) requires. Client-requested moves still go through item_stack_request/response and are untouched.
  bot._client.on('inventory_transaction', packet => {
    const transaction = packet.transaction
    if (!transaction || transaction.transaction_type !== 'normal') return
    let changed = false
    for (const action of transaction.actions || []) {
      if (action.source_type !== 'container') continue
      // ContainerId 0 is the player inventory (slots 0-8 hotbar, 9-35 main); other windows report through their own packets.
      // The protocol names the field inventory_id ('inventory'); older definitions called it window_id (0).
      const inventory = action.inventory_id ?? action.window_id
      if (inventory !== 0 && inventory !== 'inventory') continue
      setInventorySlot(playerSlot(action.slot), action.new_item)
      changed = true
    }
    if (changed) syncLocalEquipment()
  })

  bot._client.on('player_hotbar', packet => {
    if (!packet.select_slot || packet.window_id !== 'inventory') return
    bot.quickBarSlot = packet.selected_slot
    syncLocalEquipment()
    bot.updateHeldItem()
  })

  bot._client.on('mob_equipment', packet => {
    const entity = bot.entities[Number(packet.runtime_entity_id)]
    if (!entity) return
    entity.setEquipment(0, fromNotch(packet.item))
    bot.emit('entityEquip', entity)
  })

  bot._client.on('mob_armor_equipment', packet => {
    const entity = bot.entities[Number(packet.runtime_entity_id)]
    if (!entity) return
    for (const [index, name] of ['helmet', 'chestplate', 'leggings', 'boots'].entries()) {
      entity.setEquipment(index + 1, fromNotch(packet[name]))
    }
    bot.emit('entityEquip', entity)
  })

  function setInventorySlot (slot, networkItem) {
    bot.inventory.updateSlot(slot, fromNotch(networkItem))
  }

  function fromNotch (networkItem) {
    if (!networkItem || networkItem.network_id === 0) return null
    // minecraft-data does not publish item definitions for the oldest Bedrock
    // registries. Keep those sessions usable without inventing item metadata.
    if (!bot.registry.itemsByName) return null
    const networkId = networkItem.network_id
    const item = Item.fromNotch({
      ...networkItem,
      network_id: networkToCanonical.get(networkId) ?? networkId
    })
    item.networkId = networkId
    // prismarine-item does not round-trip the block form's runtime id, but the server validates item-use/placement
    // transactions against its own item record, which carries it. Keep it so toNotch can reproduce the exact record.
    item.blockRuntimeId = networkItem.block_runtime_id
    return item
  }

  function toNotch (item) {
    const networkItem = Item.toNotch(item)
    if (item) {
      networkItem.network_id = item.networkId ?? canonicalToNetwork.get(item.type) ?? item.type
      if (item.blockRuntimeId != null) networkItem.block_runtime_id = item.blockRuntimeId
    }
    return networkItem
  }

  function registerItems (itemstates = []) {
    const itemsByName = bot.registry.itemsByName || {}
    for (const state of itemstates) {
      const item = itemsByName[state.name.replace(/^minecraft:/, '')]
      if (!item) continue
      networkToCanonical.set(state.runtime_id, item.id)
      canonicalToNetwork.set(item.id, state.runtime_id)
    }
  }

  function syncLocalEquipment () {
    if (!bot.entity) return
    bot.entity.setEquipment(0, bot.heldItem)
    for (let index = 0; index < ARMOR_SLOTS.length; index++) {
      bot.entity.setEquipment(index + 1, bot.inventory.slots[ARMOR_SLOTS[index]])
    }
  }

  function compatibleRuntimeId (runtimeId) {
    return bot._client.options?.version === '1.16.201' ? Number(runtimeId) : BigInt(runtimeId)
  }
}

function playerSlot (slot) {
  return slot < QUICK_BAR_COUNT ? QUICK_BAR_START + slot : slot
}

function windowSlot (windowId, slot) {
  if (windowId === 'inventory') return playerSlot(slot)
  if (windowId === 'armor' && slot < ARMOR_SLOTS.length) return ARMOR_SLOTS[slot]
  if (windowId === 'offhand' && slot === 0) return OFFHAND_SLOT
  return null
}
