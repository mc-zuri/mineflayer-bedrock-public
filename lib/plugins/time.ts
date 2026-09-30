import nbt from 'prismarine-nbt'
import type { BotInternal } from '../types/internal.ts'
import type { Int64 } from '../types/protocol.ts'

export default inject

function inject (bot: BotInternal): void {
  bot.time = {
    doDaylightCycle: null,
    bigTime: null,
    time: null,
    timeOfDay: null,
    day: null,
    isDay: null,
    moonPhase: null,
    bigAge: null,
    age: null,
    clocks: {}
  }
  // 26.1+: update_time identifies clocks by their minecraft:world_clock registry index, and a
  // dimension follows the clock its dimension type names as default_clock
  let clockNames: string[] = []
  const defaultClocks: { [dimension: string]: string | undefined } = {}
  bot._client.on('registry_data', (packet) => {
    if (packet.id === 'minecraft:world_clock') {
      clockNames = packet.entries!.map(entry => entry.key.replace('minecraft:', ''))
    } else if (packet.id === 'minecraft:dimension_type') {
      for (const entry of packet.entries!) {
        const defaultClock = entry.value && nbt.simplify(entry.value).default_clock
        defaultClocks[entry.key.replace('minecraft:', '')] = defaultClock?.replace('minecraft:', '')
      }
    }
  })
  bot._client.on('update_time', (packet) => {
    const age = longToBigInt(packet.age)
    let time: bigint
    let doDaylightCycle: boolean
    if (packet.clockUpdates) {
      for (const update of packet.clockUpdates) {
        bot.time.clocks[clockNames[update.id] ?? String(update.id)] = update
      }
      const clock = bot.time.clocks[defaultClocks[bot.game.dimension] ?? bot.game.dimension]
      time = BigInt(clock?.totalTicks ?? 0)
      doDaylightCycle = clock?.rate! > 0
    } else {
      time = longToBigInt(packet.time!)
      doDaylightCycle = (packet.tickDayTime !== undefined) ? !!packet.tickDayTime : time >= 0n
    }
    // When doDaylightCycle is false, we need to take the absolute value of time
    const finalTime = doDaylightCycle ? time : (time < 0n ? -time : time)

    bot.time.doDaylightCycle = doDaylightCycle
    bot.time.bigTime = finalTime
    bot.time.time = Number(finalTime)
    bot.time.timeOfDay = bot.time.time % 24000
    bot.time.day = Math.floor(bot.time.time / 24000)
    bot.time.isDay = bot.time.timeOfDay >= 0 && bot.time.timeOfDay < 13000
    bot.time.moonPhase = bot.time.day % 8
    bot.time.bigAge = age
    bot.time.age = Number(age)

    bot.emit('time')
  })
  bot.on('physicsTick', () => {
    for (const clock of Object.values(bot.time.clocks)) {
      clock.partialTick += clock.rate
      const fullTicks = Math.floor(clock.partialTick)
      clock.partialTick -= fullTicks
      clock.totalTicks += fullTicks
    }
  })
}

function longToBigInt (arr: Int64): bigint {
  return BigInt.asIntN(64, (BigInt(arr[0]) << 32n)) | BigInt(arr[1])
}
