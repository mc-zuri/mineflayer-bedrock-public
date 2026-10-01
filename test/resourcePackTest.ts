// Answering resource packs, per protocol family, on a fake bot over a mock client:
// the answers must serialize like the vanilla client's (hash 1.8 - 1.9, bare result 1.10 - 1.20.2, uuid 1.20.3+)
import EventEmitter from 'events'
import assert from 'assert'
import mc from 'minecraft-protocol'
import type { States } from 'minecraft-protocol'
import prismarineRegistry from 'prismarine-registry'
import resourcePackModule from '../lib/plugins/resource_pack.ts'
import type { BotInternal } from '../lib/types/internal.ts'

const ACCEPTED = 3
const SUCCESSFULLY_LOADED = 0
const DECLINED = 1

describe('resource pack answers', () => {
  for (const version of ['1.8.8', '1.9.4', '1.10.2', '1.12.2', '1.20.2', '1.20.4', '26.1']) {
    const registry = prismarineRegistry(version)
    const family = registry.supportFeature('resourcePackUsesHash') ? 'hash' : registry.supportFeature('resourcePackUsesUUID') ? 'uuid' : 'plain'
    const url = 'https://example.invalid/pack.zip'
    const hash = '88b406352dc8a335b1050a4bf9577a878c812012'
    const uuid = '8ef4746b-93b7-3c32-9dcb-b375016c114d'

    function createBot () {
      const client = new EventEmitter() as unknown as BotInternal['_client']
      client.state = 'play' as States
      const writes: Array<{ name: string, params: { result?: number, hash?: string, uuid?: string } }> = []
      client.write = ((name: string, params: { result?: number }) => { writes.push({ name, params }) }) as BotInternal['_client']['write']
      const bot = new EventEmitter() as unknown as BotInternal
      bot._client = client
      bot.supportFeature = registry.supportFeature.bind(registry)
      resourcePackModule(bot)
      const serializer = mc.createSerializer({ state: 'play', isServer: false, version })
      // every answer has to go through the real serializer
      const serialized = () => writes.map(({ name, params }) => serializer.createPacketBuffer({ name, params }))
      return { bot, client: client as unknown as EventEmitter, writes, serialized }
    }

    function offer (client: EventEmitter) {
      if (family === 'uuid') {
        client.emit('add_resource_pack', { uuid, url, hash, forced: false })
      } else {
        client.emit('resource_pack_send', { url, hash })
      }
    }

    it(`${version} (${family}): offers emit resourcePack and wait for an answer`, () => {
      const { bot, client, writes } = createBot()
      // nothing offered yet: nothing to answer
      bot.acceptResourcePack()
      bot.denyResourcePack()
      assert.deepStrictEqual(writes, [])
      const events: unknown[][] = []
      bot.on('resourcePack', (...args: unknown[]) => { events.push(args) })
      offer(client)
      assert.deepStrictEqual(events, [[url, family === 'uuid' ? uuid : hash]])
      // in the play state the user decides
      assert.deepStrictEqual(writes, [])
    })

    it(`${version} (${family}): acceptResourcePack answers accepted then loaded`, () => {
      const { bot, client, writes, serialized } = createBot()
      offer(client)
      bot.acceptResourcePack()
      assert.deepStrictEqual(writes.map(w => [w.name, w.params.result]), [['resource_pack_receive', ACCEPTED], ['resource_pack_receive', SUCCESSFULLY_LOADED]])
      for (const { params } of writes) {
        if (family === 'hash') assert.strictEqual(params.hash, hash)
        if (family === 'uuid') assert.strictEqual(params.uuid, uuid)
      }
      const buffers = serialized()
      if (family === 'uuid') for (const buffer of buffers) assert(buffer.includes(Buffer.from(uuid.replace(/-/g, ''), 'hex')))
      if (family === 'hash') for (const buffer of buffers) assert(buffer.includes(Buffer.from(hash)))
    })

    // Before 1.10 the answer names the pack by its hash; the decline left it out, so the
    // packet could not be serialized and the decline never reached the server.
    it(`${version} (${family}): denyResourcePack answers declined`, () => {
      const { bot, client, writes, serialized } = createBot()
      offer(client)
      bot.denyResourcePack()
      assert.deepStrictEqual(writes.map(w => [w.name, w.params.result]), [['resource_pack_receive', DECLINED]])
      if (family === 'hash') assert.strictEqual(writes[0]!.params.hash, hash)
      if (family === 'uuid') assert.strictEqual(writes[0]!.params.uuid, uuid)
      assert.strictEqual(serialized().length, 1)
    })

    if (family === 'uuid') {
      it(`${version} (${family}): remove_resource_pack is accepted with and without a uuid`, () => {
        const { bot, client, writes } = createBot()
        offer(client)
        client.emit('remove_resource_pack', { uuid })
        client.emit('remove_resource_pack', {})
        // the latest offer can still be answered
        bot.acceptResourcePack()
        assert.strictEqual(writes.length, 2)
      })
    }
  }
})
