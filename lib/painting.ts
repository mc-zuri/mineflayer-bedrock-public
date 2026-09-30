import type { Vec3 } from 'vec3'
import type { Painting as PaintingInstance } from './types/mineflayer.ts'

function Painting (this: PaintingInstance, id: number, pos: Vec3, name: string | number, direction: Vec3) {
  this.id = id
  this.position = pos
  this.name = name
  this.direction = direction
}
export default Painting as unknown as typeof PaintingInstance
