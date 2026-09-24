/* eslint-env mocha */
// The sub-chunk requests the Bedrock blocks plugin sends for a column announced in request mode: one per section from
// the bottom up to and including the announced highest section, each offset written under both of the names the
// protocol versions use for it (dx/dy/dz, and x/y/z on 1.18 and from 1.26.50). A request whose offsets are all read
// as 0 fetches the bottom section again and again, and the column is never complete.
const assert = require('assert')
const { EventEmitter } = require('events')
const registryLoader = require('prismarine-registry')
const injectBlocks = require('../../lib/bedrock_plugins/blocks')

function makeBot () {
  const bot = new EventEmitter()
  bot.registry = registryLoader('bedrock_1.26.20')
  // the runtime block table comes with a real start_game; the requests do not read it
  bot.registry.blocksByRuntimeId = bot.registry.blocksByRuntimeId || {}
  bot.version = '1.26.20'
  bot._warn = () => {}
  bot.game = { minY: -64, height: 384 }
  bot._client = new EventEmitter()
  bot._client.sent = []
  bot._client.queue = (name, params) => bot._client.sent.push({ name, params })
  injectBlocks(bot)
  bot._client.emit('start_game', { dimension: 0, block_network_ids_are_hashes: false })
  return bot
}

describe('bedrock sub-chunk requests', function () {
  it('asks for every section up to the highest one, each at its own offset', function () {
    const bot = makeBot()
    if (!bot._bedrockWorldSupport.supported) this.skip()
    bot._client.emit('level_chunk', { x: 2, z: -3, sub_chunk_count: -2, highest_subchunk_count: 3, cache_enabled: false, dimension: 0, payload: Buffer.alloc(0) })
    const request = bot._client.sent.find(p => p.name === 'subchunk_request')
    assert.ok(request, 'a subchunk_request was queued')
    assert.deepStrictEqual(request.params.origin, { x: 2, y: -4, z: -3 })
    assert.deepStrictEqual(request.params.requests.map(r => [r.x, r.y, r.z]), [[0, 0, 0], [0, 1, 0], [0, 2, 0], [0, 3, 0]])
    assert.deepStrictEqual(request.params.requests.map(r => [r.dx, r.dy, r.dz]), [[0, 0, 0], [0, 1, 0], [0, 2, 0], [0, 3, 0]])
  })

  it('asks for the whole height when the count is unlimited', function () {
    const bot = makeBot()
    if (!bot._bedrockWorldSupport.supported) this.skip()
    bot._client.emit('level_chunk', { x: 0, z: 0, sub_chunk_count: -1, cache_enabled: false, dimension: 0, payload: Buffer.alloc(0) })
    const request = bot._client.sent.find(p => p.name === 'subchunk_request')
    assert.strictEqual(request.params.requests.length, 24)
  })
})
