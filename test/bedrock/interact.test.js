/* eslint-env mocha */
// Offline guard for the Bedrock interaction plugin: every packet bot.swingArm / activateItem / deactivateItem /
// attack / useOn produces must serialize against the real protocol, and must address entities by their runtime id
// (a BigInt) rather than the persistent unique id. Passing the unique id (a large negative Number) used to crash the
// native varint writer with no catchable error, so serializing each emitted packet here is the regression that
// catches that whole class of bug without needing a live server.
const assert = require('assert')
const { createSerializer } = require('bedrock-protocol/src/transforms/serializer')
const injectInteract = require('../../lib/bedrock_plugins/interact')
const registryLoader = require('prismarine-registry')
const { bedrockTestedVersions } = require('../../lib/version')

function makeBot () {
  const sent = []
  const bot = {
    quickBarSlot: 0,
    heldItem: null,
    entities: { 5: { id: 5, uniqueId: -123456789n, position: { x: 1, y: 64, z: 2 } } },
    entity: { id: 321, uniqueId: -21474836399, position: { x: 0, y: 64, z: 0 }, eyeHeight: 1.62 },
    _client: { entityId: 321n, queue (name, params) { sent.push({ name, params }) } }
  }
  injectInteract(bot)
  return { bot, sent }
}

for (const version of bedrockTestedVersions) {
  describe(`bedrock ${version} interactions serialize`, function () {
    const serializer = createSerializer(version)
    const check = (pkt) => assert.doesNotThrow(() => serializer.createPacketBuffer(pkt), `${pkt.name} should serialize`)

    it('swingArm emits a serializable animate using the runtime id', function () {
      const { bot, sent } = makeBot()
      bot.swingArm()
      assert.strictEqual(sent.length, 1)
      assert.strictEqual(sent[0].name, 'animate')
      assert.strictEqual(sent[0].params.runtime_entity_id, 321n, 'must use _client.entityId, not entity.uniqueId')
      check(sent[0])
      assert.strictEqual(bot.missedSwing, true, 'a swing on its own is a swing at nothing (missed_swing)')
    })

    it('the swing of an item use is not a swing at nothing', function () {
      const { bot } = makeBot()
      bot.activateItem()
      assert.strictEqual(bot.missedSwing, undefined)
    })

    it('activateItem emits a serializable item_use plus a swing', function () {
      const { bot, sent } = makeBot()
      bot.activateItem()
      const names = sent.map(p => p.name)
      assert.deepStrictEqual(names, ['inventory_transaction', 'animate'])
      assert.strictEqual(sent[0].params.transaction.transaction_type, 'item_use')
      sent.forEach(check)
    })

    it('deactivateItem emits a serializable item_release transaction (fires a bow)', function () {
      const { bot, sent } = makeBot()
      bot.deactivateItem()
      assert.strictEqual(sent[0].name, 'inventory_transaction')
      assert.strictEqual(sent[0].params.transaction.transaction_type, 'item_release')
      assert.strictEqual(sent[0].params.transaction.transaction_data.action_type, 'release')
      check(sent[0])
    })

    it('attack targets the entity runtime id and serializes', function () {
      const { bot, sent } = makeBot()
      bot.attack(bot.entities[5])
      assert.strictEqual(sent[0].name, 'inventory_transaction')
      const data = sent[0].params.transaction.transaction_data
      assert.strictEqual(sent[0].params.transaction.transaction_type, 'item_use_on_entity')
      assert.strictEqual(data.entity_runtime_id, 5n, 'must use entity.id (runtime), not uniqueId')
      assert.strictEqual(data.action_type, 'attack')
      sent.forEach(check)
    })

    it('useOn reports mouse-over then sends an interact transaction, all serializable', function () {
      const { bot, sent } = makeBot()
      bot.useOn(bot.entities[5])
      assert.strictEqual(sent[0].name, 'interact')
      assert.strictEqual(sent[0].params.action_id, 'mouse_over_entity')
      assert.strictEqual(sent[0].params.target_entity_id, 5n, 'mouse-over must use the entity runtime id')
      assert.strictEqual(sent[1].name, 'inventory_transaction')
      assert.strictEqual(sent[1].params.transaction.transaction_data.action_type, 'interact')
      sent.forEach(check)
    })

    it('useOn throws on an unknown entity rather than sending', function () {
      const { bot, sent } = makeBot()
      assert.throws(() => bot.useOn(999))
      assert.strictEqual(sent.length, 0)
    })

    it('openInventory sends a serializable interact open_inventory targeting the player', function () {
      const { bot, sent } = makeBot()
      bot.openInventory()
      assert.strictEqual(sent[0].name, 'interact')
      assert.strictEqual(sent[0].params.action_id, 'open_inventory')
      assert.strictEqual(sent[0].params.target_entity_id, 321n, 'must target the player runtime id')
      check(sent[0])
    })

    it('setMouseOverEntity(null) clears the hover with target 0', function () {
      const { bot, sent } = makeBot()
      bot.setMouseOverEntity(null)
      assert.strictEqual(sent[0].params.action_id, 'mouse_over_entity')
      assert.strictEqual(sent[0].params.target_entity_id, 0n)
      check(sent[0])
    })

    it('placeBlock emits a serializable click_block with empty actions', async function () {
      const { Vec3 } = require('vec3')
      const { bot, sent } = makeBot()
      bot.registry = registryLoader('bedrock_' + version)
      bot.quickBarSlot = 0
      bot.heldItem = { name: 'dirt', type: 3, count: 64, networkId: 3 }
      bot._bedrockItemToNotch = (it) => ({ network_id: it.networkId, count: it.count, metadata: 0, has_stack_id: true, stack_id: 1, block_runtime_id: -2108756090 })
      bot.lookAt = async () => {}
      bot.entity.position = new Vec3(0, 64, 0)
      bot.entity.eyeHeight = 1.62
      const ref = { position: new Vec3(0, 63, 0), stateId: -567203660 }
      await bot.placeBlock(ref, { x: 0, y: 1, z: 0 })
      const tx = sent.find(p => p.name === 'inventory_transaction')
      assert.ok(tx, 'inventory_transaction should be sent')
      assert.strictEqual(tx.params.transaction.transaction_data.action_type, 'click_block')
      assert.deepStrictEqual(tx.params.transaction.actions, [], 'actions must be empty so the server recomputes the inventory change')
      check(tx)
    })

    it('attack throws on an unknown entity rather than sending', function () {
      const { bot, sent } = makeBot()
      assert.throws(() => bot.attack(999))
      assert.strictEqual(sent.length, 0)
    })

    it('consume sends a serializable item_use click_air and resolves on completed_using_item', async function () {
      const { EventEmitter } = require('events')
      const sent = []
      const bot = new EventEmitter()
      bot.quickBarSlot = 0
      bot.heldItem = { name: 'apple', type: 260, count: 3, networkId: 288 }
      bot.entity = { id: 321, position: { x: 0, y: 64, z: 0 }, eyeHeight: 1.62 }
      bot._bedrockItemToNotch = (it) => ({ network_id: it.networkId, count: it.count, metadata: 0, has_stack_id: false, block_runtime_id: 0 })
      bot._client = new EventEmitter()
      bot._client.entityId = 321n
      bot._client.queue = (name, params) => sent.push({ name, params })
      injectInteract(bot)

      const promise = bot.consume()
      const tx = sent.find(p => p.name === 'inventory_transaction')
      assert.ok(tx, 'consume should send an item_use transaction')
      assert.strictEqual(tx.params.transaction.transaction_data.action_type, 'click_air')
      assert.deepStrictEqual(tx.params.transaction.actions, [])
      assert.strictEqual(tx.params.transaction.transaction_data.held_item.network_id, 288)
      check(tx)

      bot._client.emit('completed_using_item', { used_item_id: 288, use_method: 'eat' })
      const info = await promise
      assert.strictEqual(info.useMethod, 'eat')
      assert.strictEqual(info.itemId, 288)
    })

    it('consume rejects when nothing is held', async function () {
      const { EventEmitter } = require('events')
      const bot = new EventEmitter()
      bot.heldItem = null
      bot.entity = { id: 1, position: { x: 0, y: 64, z: 0 }, eyeHeight: 1.62 }
      bot._client = new EventEmitter()
      bot._client.entityId = 1n
      bot._client.queue = () => {}
      injectInteract(bot)
      await assert.rejects(() => bot.consume(), /no item is held/)
    })
  })
}
