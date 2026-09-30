import { onceWithCleanup } from '../promise_utils.ts'
import type { Block } from 'prismarine-block'
import type { Vec3 } from 'vec3'
import type { BotInternal, PlaceOptions } from '../types/internal.ts'

export default inject

function inject (bot: BotInternal): void {
  // Placements in flight per destination. The server's replies carry no
  // request id, so a reply can only be attributed when a single call is
  // waiting on that destination.
  const inFlight = new Map<string, number>()

  async function placeBlockWithOptions (referenceBlock: Block, faceVector: Vec3, options: PlaceOptions): Promise<void> {
    const dest = referenceBlock.position.plus(faceVector)
    const oldBlock = bot.blockAt(dest)

    await bot._genericPlace(referenceBlock, faceVector, options)

    // Whether or not it placed anything, the server answers block_place with a
    // block update for the reference block, then one for the block across the
    // face. Updates for dest that arrive before the reference one are stale
    // (sent before the server saw our packet) and say nothing about the result.
    // With several placements in flight the reply cannot be told apart, so a
    // call only settles on a type change and all of them share the outcome.
    const key = dest.toString()
    inFlight.set(key, (inFlight.get(key) ?? 0) + 1)
    let acked = false
    const onAck = () => { acked = true }
    bot.on(`blockUpdate:${referenceBlock.position}`, onAck)
    const [, newBlock] = await onceWithCleanup<[Block | null, Block | null]>(bot, `blockUpdate:${dest}`, {
      timeout: 5000,
      // oldBlock and newBlock are both null when the world unloads
      checkCondition: (oldBlock, newBlock) => !oldBlock || !newBlock || oldBlock.type !== newBlock.type || (acked && inFlight.get(key) === 1)
    }).catch((err) => {
      throw acked ? err : new Error(`Server did not answer the placement at ${dest}: ${err.message}`)
    }).finally(() => {
      bot.removeListener(`blockUpdate:${referenceBlock.position}`, onAck)
      if (inFlight.get(key) === 1) inFlight.delete(key)
      else inFlight.set(key, inFlight.get(key)! - 1)
    })

    if (!newBlock) return
    if (newBlock.type === oldBlock!.type) { // oldBlock is null only if dest is in an unloaded chunk
      throw new Error(`Server refused to place ${bot.heldItem?.name ?? 'block'} at ${dest}: the block is still ${newBlock.name}`)
    }
    bot.emit('blockPlaced', oldBlock!, newBlock)
  }

  async function placeBlock (referenceBlock: Block, faceVector: Vec3) {
    await placeBlockWithOptions(referenceBlock, faceVector, { swingArm: 'right' })
  }

  bot.placeBlock = placeBlock
  bot._placeBlockWithOptions = placeBlockWithOptions
}
