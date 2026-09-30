import { Vec3 } from 'vec3'

const CHUNK_SIZE = new Vec3(16, 16, 16)

class Location {
  declare floored: Vec3
  declare blockPoint: Vec3
  declare chunkCorner: Vec3
  declare blockIndex: number
  declare biomeBlockIndex: number
  declare chunkYIndex: number

  constructor (absoluteVector: Vec3) {
    this.floored = absoluteVector.floored()
    this.blockPoint = this.floored.modulus(CHUNK_SIZE)
    this.chunkCorner = this.floored.minus(this.blockPoint)
    this.blockIndex = this.blockPoint.x + CHUNK_SIZE.x * this.blockPoint.z + CHUNK_SIZE.x * CHUNK_SIZE.z * this.blockPoint.y
    this.biomeBlockIndex = this.blockPoint.x + CHUNK_SIZE.x * this.blockPoint.z
    this.chunkYIndex = Math.floor(absoluteVector.y / 16)
  }
}
export default Location
