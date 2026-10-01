import { performance } from 'perf_hooks'
import { createDoneTask, createTask } from '../promise_utils.ts'
import { Vec3 } from 'vec3'
import prismarineWorld from 'prismarine-world'
import type { Block } from 'prismarine-block'
import type { Item } from 'prismarine-item'
import type { BlockFace } from 'prismarine-world/types/iterators'
import type { BotInternal } from '../types/internal.ts'
import type { PrismarineWorldDefault, RaycastHitBlock } from '../types/vendor/prismarine-world.ts'

const BlockFaces = (prismarineWorld as PrismarineWorldDefault).iterators.BlockFace

export default inject

function inject (bot: BotInternal): void {
  // 26.3 inserted CHANGE_DESTROY_DIRECTION at id 1 of the player action enum, shifting the rest
  const playerActionShift = bot.registry.version['>=']('26.3') ? 1 : 0
  let swingInterval: ReturnType<typeof setInterval> | null = null
  let waitTimeout: ReturnType<typeof setTimeout> | null = null

  let diggingTask = createDoneTask()
  let stoppingForNewDigRequest = false

  bot.targetDigBlock = null
  bot.targetDigFace = null
  bot.lastDigTime = null

  async function dig (block: Block, forceLook?: boolean | 'ignore', digFace?: 'auto' | Vec3 | 'raycast'): Promise<void> {
    if (block === null || block === undefined) {
      throw new Error('dig was called with an undefined or null block')
    }

    if (!digFace || typeof digFace === 'function') {
      digFace = 'auto'
    }

    let waitTime = bot.digTime(block)
    if (waitTime === Infinity) {
      throw new Error(`dig time for ${block?.name ?? block} is Infinity`)
    }

    // The face is kept local until the look is done: a previous dig can finish during the await
    // and reads (then resets) bot.targetDigFace.
    let targetDigFace = 1 // Default (top)

    if (forceLook !== 'ignore') {
      if ((digFace as Vec3)?.x || (digFace as Vec3)?.y || (digFace as Vec3)?.z) {
        // Determine the block face the bot should mine
        if ((digFace as Vec3).x) {
          targetDigFace = (digFace as Vec3).x > 0 ? BlockFaces.EAST : BlockFaces.WEST
        } else if ((digFace as Vec3).y) {
          targetDigFace = (digFace as Vec3).y > 0 ? BlockFaces.TOP : BlockFaces.BOTTOM
        } else if ((digFace as Vec3).z) {
          targetDigFace = (digFace as Vec3).z > 0 ? BlockFaces.SOUTH : BlockFaces.NORTH
        }
        await bot.lookAt(
          block.position.offset(0.5, 0.5, 0.5).offset((digFace as Vec3).x * 0.5, (digFace as Vec3).y * 0.5, (digFace as Vec3).z * 0.5),
          forceLook
        )
      } else if (digFace === 'raycast') {
        // Check faces that could be seen from the current position. If the delta is smaller then 0.5 that means the
        // bot can most likely not see the face as the block is 1 block thick
        // this could be false for blocks that have a smaller bounding box than 1x1x1
        const dx = bot.entity.position.x - (block.position.x + 0.5)
        const dy = bot.entity.position.y + bot.entity.eyeHeight - (block.position.y + 0.5)
        const dz = bot.entity.position.z - (block.position.z + 0.5)
        // Check y first then x and z
        const visibleFaces: { [axis: string]: number } = {
          y: Math.sign(Math.abs(dy) > 0.5 ? dy : 0),
          x: Math.sign(Math.abs(dx) > 0.5 ? dx : 0),
          z: Math.sign(Math.abs(dz) > 0.5 ? dz : 0)
        }
        const validFaces: Array<{ face: BlockFace, targetPos: Vec3 }> = []
        const closerBlocks: RaycastHitBlock[] = []
        for (const i in visibleFaces) {
          if (!visibleFaces[i]) continue // skip as this face is not visible
          // target position on the target block face. -> 0.5 + (current face) * 0.5
          const targetPos = block.position.offset(
            0.5 + (i === 'x' ? visibleFaces[i] * 0.5 : 0),
            0.5 + (i === 'y' ? visibleFaces[i] * 0.5 : 0),
            0.5 + (i === 'z' ? visibleFaces[i] * 0.5 : 0)
          )
          const startPos = bot.entity.position.offset(0, bot.entity.eyeHeight, 0)
          const rayBlock = bot.world.raycast(startPos, targetPos.clone().subtract(startPos).normalize(), 5)
          if (rayBlock) {
            if (startPos.distanceTo(rayBlock.intersect!) < startPos.distanceTo(targetPos)) {
              // Block is closer then the raycasted block
              closerBlocks.push(rayBlock)
              // continue since if distance is ever less, then we did not intersect the block we wanted,
              // meaning that the position of the intersected block is not what we want.
              continue
            }
            const rayPos = rayBlock.position
            if (
              rayPos.x === block.position.x &&
              rayPos.y === block.position.y &&
              rayPos.z === block.position.z
            ) {
              validFaces.push({
                face: rayBlock.face!,
                targetPos: rayBlock.intersect!
              })
            }
          }
        }

        if (validFaces.length > 0) {
          // Chose closest valid face
          let closest: { face: BlockFace, targetPos: Vec3 } | undefined
          let distSqrt = 999
          for (const i in validFaces) {
            const tPos = validFaces[i]!.targetPos
            const cDist = new Vec3(tPos.x, tPos.y, tPos.z).distanceSquared(
              bot.entity.position.offset(0, bot.entity.eyeHeight, 0)
            )
            if (distSqrt > cDist) {
              closest = validFaces[i]
              distSqrt = cDist
            }
          }
          await bot.lookAt(closest!.targetPos, forceLook)
          targetDigFace = closest!.face
        } else if (closerBlocks.length === 0 && block.shapes.length === 0) {
          // no other blocks were detected and the block has no shapes.
          // The block in question is replaceable (like tall grass) so we can just dig it
          // TODO: do AABB + ray intercept check to this position for digFace.
          await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), forceLook)
        } else {
          // Block is obstructed return error?
          throw new Error('Block not in view')
        }
      } else {
        await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), forceLook)
      }
    }

    // the look can take ticks: the bot may have landed, jumped or entered water meanwhile, and the
    // server times the break with the bot's state from now on
    waitTime = bot.digTime(block)
    if (waitTime === Infinity) {
      throw new Error(`dig time for ${block?.name ?? block} is Infinity`)
    }

    bot.targetDigFace = targetDigFace

    // In vanilla the client will cancel digging the current block once the other block is at the crosshair.
    // Todo: don't wait until lookAt is at middle of the block, but at the edge of it.
    if (bot.targetDigBlock) {
      stoppingForNewDigRequest = true
      bot.stopDigging()
      stoppingForNewDigRequest = false
      bot.targetDigFace = targetDigFace // stopDigging reset it
    }

    diggingTask = createTask()
    bot._client.write('block_dig', {
      status: 0, // start digging
      location: block.position,
      face: bot.targetDigFace!, // default face is 1 (top)
      sequence: bot._nextSequence()
    })
    waitTimeout = setTimeout(finishDigging, waitTime)
    bot.targetDigBlock = block
    bot.swingArm()

    swingInterval = setInterval(() => {
      bot.swingArm()
    }, 350)

    function finishDigging (): void {
      clearInterval(swingInterval)
      clearTimeout(waitTimeout)
      swingInterval = null
      waitTimeout = null
      // an instant break (creative, insta-mine) is done with the start action: vanilla sends no finish
      if (bot.targetDigBlock && waitTime > 0) {
        bot._client.write('block_dig', {
          status: 2 + playerActionShift, // finish digging
          location: bot.targetDigBlock.position,
          face: bot.targetDigFace!, // always the same as the start face
          sequence: bot._nextSequence()
        })
      }
      bot.targetDigBlock = null
      bot.targetDigFace = null
      bot.lastDigTime = performance.now()
      bot._updateBlockState(block.position, 0)
    }

    const eventName: `blockUpdate:${string}` = `blockUpdate:${block.position}`
    bot.on(eventName, onBlockUpdate)

    bot.stopDigging = () => {
      if (!bot.targetDigBlock) return

      // Replicate the odd vanilla cancellation face value.
      // When the cancellation is because of a new dig request on another block it's the same as the new dig start face. In all other cases it's 0.
      // (bot.targetDigFace is already the new dig's face then)
      const stoppedBecauseOfNewDigRequest = stoppingForNewDigRequest
      const cancellationDiggingFace = stoppedBecauseOfNewDigRequest ? bot.targetDigFace! : 0

      bot.removeListener(eventName, onBlockUpdate)
      clearInterval(swingInterval)
      clearTimeout(waitTimeout)
      swingInterval = null
      waitTimeout = null
      bot._client.write('block_dig', {
        status: 1 + playerActionShift, // cancel digging
        location: bot.targetDigBlock.position,
        face: cancellationDiggingFace,
        sequence: 0
      })
      const block = bot.targetDigBlock
      bot.targetDigBlock = null
      bot.targetDigFace = null
      bot.lastDigTime = performance.now()
      bot.emit('diggingAborted', block)
      bot.stopDigging = noop
      diggingTask.cancel(new Error('Digging aborted'))
    }

    function onBlockUpdate (_oldBlock: Block | null, newBlock: Block | null): void {
      // vanilla server never actually interrupt digging, but some server send block update when you start digging
      // so ignore block update if not air
      // All block update listeners receive (null, null) when the world is unloaded. So newBlock can be null.
      if (newBlock?.type !== 0) return
      bot.removeListener(eventName, onBlockUpdate)
      clearInterval(swingInterval)
      clearTimeout(waitTimeout)
      swingInterval = null
      waitTimeout = null
      bot.targetDigBlock = null
      bot.targetDigFace = null
      bot.lastDigTime = performance.now()
      bot.emit('diggingCompleted', newBlock)
      diggingTask.finish()
    }

    await diggingTask.promise
  }

  bot.on('death', () => {
    try {
      bot.removeAllListeners('diggingAborted')
      bot.removeAllListeners('diggingCompleted')
      bot.stopDigging()
    } catch (_) {}
  })

  function canDigBlock (block: Block): boolean {
    return (
      block &&
      block.diggable &&
      block.position.offset(0.5, 0.5, 0.5).distanceTo(bot.entity.position.offset(0, 1.65, 0)) <= 5.1
    )
  }

  // prismarine-item returns the raw enchantments component of a 1.20.5+ item ({ enchantments: [{ id, level }] })
  // instead of [{ name, lvl }]
  function enchantsOf (item: Item): Item['enchants'] {
    const enchants = item.enchants as Item['enchants'] | { enchantments: Array<{ id: number, level: number }> }
    if (Array.isArray(enchants)) return enchants
    return enchants.enchantments.map(({ id, level }) => ({ name: bot.registry.enchantments[id]?.name as string, lvl: level }))
  }

  function digTime (block: Block): number {
    let type: number | null = null
    let enchantments: Item['enchants'] = []

    // Retrieve currently held item ID and active enchantments from heldItem
    const currentlyHeldItem = bot.heldItem
    if (currentlyHeldItem) {
      type = currentlyHeldItem.type
      enchantments = enchantsOf(currentlyHeldItem)
    }

    // Append helmet enchantments (because Aqua Affinity actually affects dig speed)
    const headEquipmentSlot = bot.getEquipmentDestSlot('head')
    const headEquippedItem = bot.inventory.slots[headEquipmentSlot]
    if (headEquippedItem) {
      const helmetEnchantments = enchantsOf(headEquippedItem)
      enchantments = enchantments.concat(helmetEnchantments)
    }

    const creative = bot.game.gameMode === 'creative'
    return block.digTime(
      type,
      creative,
      ['water', 'flowing_water'].includes(bot._getBlockAtEyeLevel()?.name as string),
      !bot.entity.onGround,
      enchantments,
      bot.entity.effects
    )
  }

  bot._getBlockAtEyeLevel = () => bot.entity.position && bot.blockAt(bot.entity.position.offset(0, bot.entity.eyeHeight, 0))
  bot.dig = dig
  bot.stopDigging = noop
  bot.canDigBlock = canDigBlock
  bot.digTime = digTime
}

function noop (err?: Error): void {
  if (err) throw err
}
