/* eslint-env mocha */
// Offline test for the Bedrock inventory plugin's outbound path: selecting a hotbar slot must emit a mob_equipment
// packet that serialises against the real protocol and addresses the player by runtime id (entity.id), not the unique
// id. Serialising the emitted packet guards the same varint-overflow class of bug the interaction test covers.
const assert = require('assert')
const { EventEmitter } = require('events')
const { createSerializer } = require('bedrock-protocol/src/transforms/serializer')
const registryLoader = require('prismarine-registry')
const injectInventory = require('../../lib/bedrock_plugins/inventory')
const { bedrockTestedVersions } = require('../../lib/version')

function makeBot (version) {
  const bot = new EventEmitter()
  bot.registry = registryLoader('bedrock_' + version)
  bot._warn = () => {}
  const sent = []
  bot._client = new EventEmitter()
  bot._client.queue = (name, params) => sent.push({ name, params })
  injectInventory(bot)
  bot.entity = { id: 77, setEquipment () {} }
  return { bot, sent }
}

for (const version of bedrockTestedVersions) {
  describe(`bedrock ${version} inventory plugin`, function () {
    const serializer = createSerializer(version)

    it('setQuickBarSlot emits a serializable mob_equipment with the runtime id', function () {
      const { bot, sent } = makeBot(version)
      bot.setQuickBarSlot(3)
      assert.strictEqual(bot.quickBarSlot, 3)
      const eq = sent.find(p => p.name === 'mob_equipment')
      assert.ok(eq, 'mob_equipment should be sent')
      assert.strictEqual(eq.params.slot, 3)
      assert.strictEqual(Number(eq.params.runtime_entity_id), 77, 'addresses the player by runtime id')
      assert.doesNotThrow(() => serializer.createPacketBuffer(eq), 'mob_equipment must serialize')
    })

    it('sets up an inventory window and a heldItem accessor', function () {
      const { bot } = makeBot(version)
      assert.ok(bot.inventory, 'inventory window exists')
      assert.strictEqual(bot.QUICK_BAR_START, 36)
      assert.doesNotThrow(() => { const _ = bot.heldItem }) // eslint-disable-line no-unused-vars
    })

    it('moveInventoryItem emits a serializable item_stack_request and applies an ok response', function () {
      const { bot, sent } = makeBot(version)
      const serializer = createSerializer(version)
      bot.inventory.updateSlot(36, { name: 'dirt', type: 3, count: 64, stackId: 4 }) // bedrock hotbar slot 0
      const rid = bot.moveInventoryItem(0, 2) // hotbar 0 -> hotbar 2 (empty) => place
      const req = sent.find(p => p.name === 'item_stack_request')
      assert.ok(req, 'item_stack_request should be sent')
      assert.strictEqual(req.params.requests[0].actions[0].type_id, 'place')
      assert.strictEqual(req.params.requests[0].actions[0].source.slot_type.container_id, 'hotbar')
      assert.doesNotThrow(() => serializer.createPacketBuffer(req), 'item_stack_request must serialize')
      // apply an ok response and confirm the item moved locally (slot 36 -> slot 38)
      bot._client.emit('item_stack_response', { responses: [{ status: 'ok', request_id: rid, containers: [{ slot_type: { container_id: 'hotbar' }, slots: [{ slot: 0, count: 0 }, { slot: 2, count: 64, item_stack_id: 20 }] }] }] })
      assert.ok(!bot.inventory.slots[36], 'source slot cleared')
      assert.ok(bot.inventory.slots[38] && bot.inventory.slots[38].name === 'dirt', 'item moved to hotbar slot 2')
    })

    it('applies a normal inventory_transaction (ground pickup) with its server stack id', function () {
      const { bot } = makeBot(version)
      // BDS reports a ground pickup as a normal inventory_transaction whose container action carries the new item with
      // its authoritative stack id, rather than an inventory_slot/content update. The item must land in the player
      // inventory with that stack id so it can be used in a later item_stack_request (craft/move) without a resync.
      bot._client.emit('inventory_transaction', {
        transaction: {
          transaction_type: 'normal',
          actions: [
            { source_type: 'container', window_id: 0, slot: 0, old_item: { network_id: 0, count: 0 }, new_item: { network_id: 3, count: 2, metadata: 0, has_stack_id: true, stack_id: 5, block_runtime_id: 0, extra: { has_nbt: 0, can_place_on: [], can_destroy: [] } } },
            { source_type: 'world_interaction', slot: 1, old_item: { network_id: 3, count: 2 }, new_item: { network_id: 0, count: 0 } }
          ]
        }
      })
      const picked = bot.inventory.slots[36] // bedrock inventory slot 0 -> mineflayer hotbar slot 0
      assert.ok(picked && picked.name === 'dirt', 'picked-up item lands in the inventory')
      assert.strictEqual(picked.count, 2, 'count preserved')
      assert.strictEqual(picked.stackId, 5, 'carries the server stack id')
    })

    it('applies the action by its inventory_id, the name the protocol gives the field', function () {
      const { bot } = makeBot(version)
      bot._client.emit('inventory_transaction', {
        transaction: {
          transaction_type: 'normal',
          actions: [
            { source_type: 'container', inventory_id: 'inventory', slot: 0, old_item: { network_id: 0, count: 0 }, new_item: { network_id: 3, count: 2, metadata: 0, has_stack_id: true, stack_id: 5, block_runtime_id: 0, extra: { has_nbt: 0, can_place_on: [], can_destroy: [] } } }
          ]
        }
      })
      assert.strictEqual(bot.inventory.slots[36].count, 2)
      assert.strictEqual(bot.inventory.slots[36].stackId, 5)
    })

    it('ignores a non-normal inventory_transaction', function () {
      const { bot } = makeBot(version)
      bot._client.emit('inventory_transaction', {
        transaction: { transaction_type: 'item_use', actions: [{ source_type: 'container', window_id: 0, slot: 0, new_item: { network_id: 3, count: 1, has_stack_id: true, stack_id: 9 } }] }
      })
      assert.ok(!bot.inventory.slots[36], 'non-normal transactions do not touch the inventory')
    })

    it('rejects an out-of-range hotbar slot', function () {
      const { bot } = makeBot(version)
      assert.throws(() => bot.setQuickBarSlot(9))
      assert.throws(() => bot.setQuickBarSlot(-1))
    })

    it('equip to hand selects a hotbar item', async function () {
      const { bot } = makeBot(version)
      bot.entity = { id: 77, setEquipment () {}, position: { x: 0, y: 64, z: 0 } }
      bot.inventory.updateSlot(38, { name: 'iron_sword', type: 308, count: 1, stackId: 2 }) // hotbar slot 2
      await bot.equip('iron_sword', 'hand')
      assert.strictEqual(bot.quickBarSlot, 2, 'selected the sword hotbar slot')
    })

    it('equip to armor sends a place into the armor container and wears it on the ok response', async function () {
      const { bot, sent } = makeBot(version)
      bot.entity = { id: 77, setEquipment () {}, position: { x: 0, y: 64, z: 0 } }
      bot.currentWindow = { id: 0 } // pretend the inventory screen is open
      bot.inventory.updateSlot(36, { name: 'iron_helmet', type: 298, count: 1, stackId: 4 }) // hotbar slot 0
      // auto-ok the item_stack_request
      bot._client.queue = (name, params) => { sent.push({ name, params }); if (name === 'item_stack_request') { const r = params.requests[0]; setImmediate(() => bot._client.emit('item_stack_response', { responses: [{ request_id: r.request_id, status: 'ok', containers: [{ slot_type: { container_id: 'armor' }, slots: [{ slot: 0, count: 1 }] }] }] })) } }
      await bot.equip('iron_helmet', 'head')
      await new Promise(resolve => setTimeout(resolve, 50))
      const req = sent.find(p => p.name === 'item_stack_request')
      assert.strictEqual(req.params.requests[0].actions[0].destination.slot_type.container_id, 'armor')
      assert.strictEqual(req.params.requests[0].actions[0].destination.slot, 0, 'head is armor slot 0')
      assert.ok(bot.inventory.slots[5] && bot.inventory.slots[5].name === 'iron_helmet', 'helmet worn in the head slot (5)')
      assert.ok(!bot.inventory.slots[36], 'source hotbar slot cleared')
    })

    it('toss drops from the item slot and shrinks the stack on the ok response', async function () {
      const { bot, sent } = makeBot(version)
      bot.entity = { id: 77, setEquipment () {}, position: { x: 0, y: 64, z: 0 } }
      bot.inventory.updateSlot(36, { name: 'dirt', type: 3, count: 20, stackId: 9 }) // hotbar slot 0
      const serializer = createSerializer(version)
      bot._client.queue = (name, params) => { sent.push({ name, params }); if (name === 'item_stack_request') { const r = params.requests[0]; setImmediate(() => bot._client.emit('item_stack_response', { responses: [{ request_id: r.request_id, status: 'ok', containers: [] }] })) } }
      await bot.toss('dirt', null, 5)
      await new Promise(resolve => setTimeout(resolve, 30))
      const req = sent.find(p => p.name === 'item_stack_request')
      assert.strictEqual(req.params.requests[0].actions[0].type_id, 'drop')
      assert.strictEqual(req.params.requests[0].actions[0].count, 5)
      assert.doesNotThrow(() => serializer.createPacketBuffer(req), 'drop item_stack_request must serialize')
      assert.strictEqual(bot.inventory.slots[36].count, 15, 'stack shrank by the dropped count')
    })

    it('equip off-hand sends a normal inventory_transaction into the offhand window (119)', async function () {
      const { bot, sent } = makeBot(version)
      bot.entity = { id: 77, setEquipment () {}, position: { x: 0, y: 64, z: 0 } }
      bot.inventory.updateSlot(36, { name: 'shield', type: 355, count: 1, stackId: 1 }) // hotbar slot 0
      await bot.equip('shield', 'off-hand')
      const tx = sent.find(p => p.name === 'inventory_transaction')
      assert.ok(tx, 'inventory_transaction should be sent')
      assert.strictEqual(tx.params.transaction.transaction_type, 'normal')
      const dest = tx.params.transaction.actions.find(a => a.window_id === 119)
      assert.ok(dest && dest.new_item.network_id, 'moves the item into the offhand window (119)')
      const from = tx.params.transaction.actions.find(a => a.window_id === 0)
      assert.ok(from && from.slot === 0, 'takes from the player inventory window (0) at the source slot')
      assert.ok(bot.inventory.slots[45] && bot.inventory.slots[45].name === 'shield', 'shield worn in the off-hand slot (45)')
      assert.ok(!bot.inventory.slots[36], 'source hotbar slot cleared')
      // (wire serialization of the transaction is covered by the live BDS test, which uses real inventory Items)
    })

    it('depositItem emits a serializable place into the container container_id', function () {
      const { bot, sent } = makeBot(version)
      bot.currentWindow = { id: 5, type: 'container', slots: [] }
      bot.inventory.updateSlot(36, { name: 'dirt', type: 3, count: 10, stackId: 7 })
      bot.depositItem(0, 0, 10) // hotbar slot 0 -> container slot 0
      const req = sent.find(p => p.name === 'item_stack_request')
      assert.ok(req, 'item_stack_request should be sent')
      const action = req.params.requests[0].actions[0]
      assert.strictEqual(action.type_id, 'place')
      assert.strictEqual(action.source.slot_type.container_id, 'hotbar')
      assert.strictEqual(action.destination.slot_type.container_id, 'container')
      assert.strictEqual(action.source.stack_id, 7)
      assert.doesNotThrow(() => serializer.createPacketBuffer(req), 'item_stack_request must serialize')
    })

    it('withdrawItem takes from the container into a player slot and serializes', function () {
      const { bot, sent } = makeBot(version)
      bot.currentWindow = { id: 5, type: 'container', slots: [{ name: 'dirt', type: 3, count: 4, stackId: 27 }] }
      bot.withdrawItem(0, 9, 4) // container slot 0 -> inventory slot 9 (main slot 0)
      const req = sent.find(p => p.name === 'item_stack_request')
      const action = req.params.requests[0].actions[0]
      assert.strictEqual(action.source.slot_type.container_id, 'container')
      assert.strictEqual(action.source.stack_id, 27)
      assert.strictEqual(action.destination.slot_type.container_id, 'inventory')
      assert.doesNotThrow(() => serializer.createPacketBuffer(req), 'item_stack_request must serialize')
    })

    it('depositItem/withdrawItem throw when no container is open', function () {
      const { bot } = makeBot(version)
      bot.currentWindow = null
      assert.throws(() => bot.depositItem(0, 0))
      assert.throws(() => bot.withdrawItem(0, 9))
    })
  })
}
