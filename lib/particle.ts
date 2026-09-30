import { Vec3 } from 'vec3'
import type { Registry } from 'prismarine-registry'
import type { Particle as ParticleInstance } from './types/mineflayer.ts'
import type { ClientboundPackets } from './types/protocol.ts'

export default loader

function loader (registry: Registry) {
  class Particle implements ParticleInstance {
    declare id: number
    declare name?: string
    declare position: Vec3
    declare offset: Vec3
    declare count: number
    declare movementSpeed: number
    declare longDistanceRender: boolean

    constructor (id: number | string, position: Vec3, offset: Vec3, count = 1, movementSpeed = 0, longDistanceRender = false) {
      // the registry entry below replaces a particle name with its numeric id
      this.id = id as number
      Object.assign(this, registry.particles[id as number] || registry.particlesByName[id])
      this.position = position
      this.offset = offset
      this.count = count
      this.movementSpeed = movementSpeed
      this.longDistanceRender = longDistanceRender
    }

    static fromNetwork (packet: ClientboundPackets['world_particles']) {
      if (registry.supportFeature('updatedParticlesPacket')) {
        // TODO: We add extra data that's inside packet.particle.data that varies by the particle's .type
        return new Particle(
          packet.particle!.type,
          new Vec3(packet.x, packet.y, packet.z),
          new Vec3(packet.offsetX, packet.offsetY, packet.offsetZ),
          packet.amount,
          packet.velocityOffset,
          packet.longDistance
        )
      } else {
        return new Particle(
          packet.particleId!,
          new Vec3(packet.x, packet.y, packet.z),
          new Vec3(packet.offsetX, packet.offsetY, packet.offsetZ),
          packet.particles,
          packet.particleData,
          packet.longDistance
        )
      }
    }
  }

  return Particle
}
