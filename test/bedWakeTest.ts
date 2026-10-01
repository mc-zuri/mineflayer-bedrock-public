// bot.wake() on a fake bot: the entity_action packet it writes, run through the real protocol
// serializer and read back as the server would.
import EventEmitter from 'events'
import assert from 'assert'
import prismarineRegistry from 'prismarine-registry'
import mc from 'minecraft-protocol'
import bedPlugin from '../lib/plugins/bed.ts'
import type { BotInternal } from '../lib/types/internal.ts'

describe('bed plugin wake', () => {
  // 1.21.6 dropped the sneak actions from entity_action (leave bed went from id 2 to 0) and names the ids
  for (const [version, expected] of [['1.8.8', 2], ['1.20.4', 2], ['1.21.5', 2], ['1.21.6', 'leave_bed'], ['26.1', 'leave_bed']] as const) {
    it(`sends the leave bed action (${version})`, async () => {
      const registry = prismarineRegistry(version)
      const bot = new EventEmitter() as unknown as BotInternal
      bot.registry = registry as BotInternal['registry']
      bot.supportFeature = registry.supportFeature.bind(registry) as BotInternal['supportFeature']
      const writes: Array<{ name: string, params: unknown }> = []
      bot._client = Object.assign(new EventEmitter(), {
        write: (name: string, params: unknown) => { writes.push({ name, params }) }
      }) as unknown as BotInternal['_client']
      bot.entity = { id: 7 } as BotInternal['entity']
      bedPlugin(bot)
      bot.isSleeping = true
      await bot.wake()

      assert.strictEqual(writes.length, 1)
      assert.strictEqual(writes[0]!.name, 'entity_action')
      const serializer = mc.createSerializer({ state: mc.states.PLAY, isServer: false, version })
      const buffer = serializer.createPacketBuffer({ name: 'entity_action', params: writes[0]!.params })
      const deserializer = mc.createDeserializer({ state: mc.states.PLAY, isServer: true, version })
      const { data } = deserializer.parsePacketBuffer(buffer) as { data: { params: { actionId: number | string } } }
      assert.strictEqual(data.params.actionId, expected)
    })
  }
})
