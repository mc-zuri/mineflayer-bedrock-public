import assert from 'assert'
import prismarineWorld from 'prismarine-world'
import type { TestFunction } from './plugins/testCommon.ts'
import type { PrismarineWorldDefault, RaycastHitBlock } from '../../lib/types/vendor/prismarine-world.ts'

const { BlockFace } = (prismarineWorld as PrismarineWorldDefault).iterators

export default (): TestFunction => async (bot) => {
  const { position } = bot.entity
  await bot.lookAt(position.offset(0, 3, 0), true)

  let block: RaycastHitBlock | null | undefined = bot.blockAtCursor()
  assert.strictEqual(block, null)

  block = bot.blockInSight()
  assert.strictEqual(block, undefined)

  await bot.lookAt(position.offset(0, -3, 0), true)

  block = bot.blockAtCursor()
  const relBlock: RaycastHitBlock = bot.blockAt(position.offset(0, -1, 0))! // under the bot: loaded
  relBlock.face = BlockFace.TOP

  assert.deepStrictEqual(block!.position, relBlock.position)
  assert.deepStrictEqual(block!.face, relBlock.face)

  block = bot.blockInSight()
  assert.deepStrictEqual(block!.position, relBlock.position)
  assert.deepStrictEqual(block!.face, relBlock.face)
}
