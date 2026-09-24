/* eslint-env mocha */
// Offline test for the Bedrock movement controls in client_input: setControlState records intent, the per-tick
// player_auth_input carries the matching local-frame move_vector and input flags (and serializes), and a
// correct_player_move_prediction applies the server's authoritative position to bot.entity. Server-authoritative
// movement itself is verified live; this guards the packet the client sends and the correction it applies.
const assert = require('assert')
const { Vec3 } = require('vec3')
const { EventEmitter } = require('events')
const { createSerializer } = require('bedrock-protocol/src/transforms/serializer')
const registryLoader = require('prismarine-registry')
const injectInput = require('../../lib/bedrock_plugins/client_input')
const { bedrockTestedVersions } = require('../../lib/version')

function makeBot (version, { manualTicks = false } = {}) {
  const bot = new EventEmitter()
  bot.registry = registryLoader('bedrock_' + version)
  const sent = []
  bot._client = new EventEmitter()
  bot._client.manualTicks = manualTicks
  bot._client.queue = (name, params) => sent.push({ name, params })
  bot.entity = { position: new Vec3(0, 64, 0), eyeHeight: 1.62, yaw: 0, pitch: 0 }
  // the packet comes from the physics engine now, which reads the player's state through PlayerState
  bot.inventory = { slots: new Array(46).fill(null) }
  bot.game = { gameMode: 'survival' }
  injectInput(bot)
  return { bot, sent }
}

for (const version of bedrockTestedVersions) {
  describe(`bedrock ${version} movement controls`, function () {
    const serializer = createSerializer(version)

    afterEach(function () { /* timers are unref'd; nothing to clean */ })

    it('setControlState / getControlState / clearControlStates and unknown control throws', function () {
      const { bot } = makeBot(version)
      assert.strictEqual(bot.getControlState('forward'), false)
      bot.setControlState('forward', true)
      assert.strictEqual(bot.getControlState('forward'), true)
      bot.clearControlStates()
      assert.strictEqual(bot.getControlState('forward'), false)
      assert.throws(() => bot.setControlState('teleport', true))
    })

    it('the auth-input tick carries the move_vector and input flags for the active controls, and serializes', function () {
      const { bot, sent } = makeBot(version)
      bot.setControlState('forward', true)
      bot.setControlState('sprint', true)
      bot.emit('spawn') // starts the input loop; send() runs once synchronously
      const pkt = sent.find(p => p.name === 'player_auth_input')
      assert.ok(pkt, 'a player_auth_input is sent')
      assert.deepStrictEqual(pkt.params.move_vector, { x: 0, z: 1 }, 'forward is +z in the local frame')
      assert.deepStrictEqual(pkt.params.raw_move_vector, { x: 0, z: 1 })
      const flags = Array.isArray(pkt.params.input_data) ? pkt.params.input_data : Object.keys(pkt.params.input_data).filter(k => pkt.params.input_data[k])
      assert.ok(flags.includes('up'), 'forward sets the up flag')
      assert.ok(flags.includes('sprinting'), 'sprint sets the sprinting flag')
      assert.doesNotThrow(() => serializer.createPacketBuffer(pkt), 'player_auth_input must serialize')
      bot._client.emit('close')
    })

    it('installs correct_player_move_prediction on the next tick (feet from eye level)', function () {
      const { bot } = makeBot(version, { manualTicks: true })
      bot._client.emit('correct_player_move_prediction', { prediction_type: 'player', position: { x: 10, y: 65.62001, z: -4 }, delta: { x: 0, y: 0, z: 0 }, on_ground: false, tick: 5n })
      assert.strictEqual(bot.entity.position.x, 0, 'the client installs it at the start of its next tick')
      bot.bedrockTick(6)
      assert.strictEqual(bot.entity.position.x, 10)
      assert.strictEqual(bot.entity.position.z, -4)
      // feet 64: the eye 65.62001 less the client's 1.62001 offset (the engine holds a player over unloaded ground)
      assert.ok(Math.abs(bot.entity.position.y - 64) < 1e-4, `${bot.entity.position.y}`)
    })
  })
}
