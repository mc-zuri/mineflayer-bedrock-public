// Riding on Bedrock: the server links a rider to a vehicle with set_entity_link (the entities plugin keeps bot.vehicle,
// the passengers and the mount / dismount events); the bot mounts by using the vehicle and dismounts with an interact
// leave_vehicle. While the bot steers a boat, the physics engine predicts the boat as the client does (prismarine-
// physics' vehicle tick) and reports it; in any other vehicle the bot sits in its seat.
const { Vec3 } = require('vec3')

module.exports = inject

// set_entity_link's link types
const LINK_REMOVE = 0
const LINK_DRIVER = 1
// The boats the client predicts when it drives one.
const PREDICTED = new Set(['boat', 'chest_boat'])
// A seat when the rider carries none: a boat driver's.
const DEFAULT_SEAT = { x: 0, y: 1.0200101, z: 0 }

function inject (bot) {
  bot.vehicle = bot.vehicle ?? null
  bot.bedrockVehicle = null

  const byUniqueId = (id) => Object.values(bot.entities).find(e => e.uniqueId != null && String(e.uniqueId) === String(id))

  // The rotation in degrees as the wire carries it (mineflayer's entity yaw / pitch are radians the other way).
  const rawRotation = new Map()
  function trackRotation (runtimeId, yaw, pitch) {
    if (yaw != null && pitch != null) rawRotation.set(String(runtimeId), { yaw: Math.fround(yaw), pitch: Math.fround(pitch) })
  }
  bot._client.on('add_entity', p => trackRotation(p.runtime_id ?? p.runtime_entity_id, p.yaw, p.pitch))
  bot._client.on('move_entity', p => p.rotation && trackRotation(p.runtime_entity_id, p.rotation.yaw, p.rotation.pitch))

  function seatOf (entity) {
    const seat = bot.entity && bot.entity.metadata && (bot.entity.metadata.rider_seat_position ?? bot.entity.metadata[56])
    return seat && typeof seat.y === 'number' ? { x: seat.x, y: seat.y, z: seat.z } : { ...DEFAULT_SEAT }
  }

  // The engine's vehicle for an entity the bot rides: the server's position, velocity and rotation; predicted when the
  // bot drives a boat.
  function engineVehicle (entity, driver) {
    const rotation = rawRotation.get(String(entity.id)) || { yaw: 0, pitch: 0 }
    // where the client shows the vehicle: a boat's interpolation, else its last position
    const at = entity.bedrockShownPosition || entity.position
    const width = typeof entity.metadata?.boundingbox_width === 'number' ? entity.metadata.boundingbox_width : undefined
    const height = typeof entity.metadata?.boundingbox_height === 'number' ? entity.metadata.boundingbox_height : undefined
    return {
      id: BigInt(entity.uniqueId),
      kind: entity.name,
      pos: new Vec3(Math.fround(at.x), Math.fround(at.y), Math.fround(at.z)),
      vel: new Vec3(Math.fround(entity.velocity?.x ?? 0), Math.fround(entity.velocity?.y ?? 0), Math.fround(entity.velocity?.z ?? 0)),
      yaw: rotation.yaw,
      pitch: rotation.pitch,
      predicted: driver && PREDICTED.has(entity.name),
      seat: seatOf(entity),
      width,
      height
    }
  }

  // The engine's vehicle for the one the bot boards, and none once it leaves.
  bot._client.on('set_entity_link', ({ link }) => {
    if (!link || link.type === LINK_REMOVE || !bot.entity) return
    const rider = byUniqueId(link.rider_entity_id)
    const vehicle = byUniqueId(link.ridden_entity_id)
    if (rider !== bot.entity || !vehicle) return
    bot.bedrockVehicle = engineVehicle(vehicle, link.type === LINK_DRIVER)
    // a boat the bot drives starts where the client shows it on the first tick ridden (after that tick's
    // interpolation step); the input loop places it then
    if (bot.bedrockVehicle.predicted) bot.bedrockVehicle.placeFrom = vehicle
  })
  bot.on('dismount', () => { bot.bedrockVehicle = null })

  // A predicted vehicle is where the bot drives it: its entity follows the prediction, not the server's echoes of past
  // ticks (a boat left behind at its echo would push the rider who just stepped off it).
  function followPrediction () {
    const v = bot.bedrockVehicle
    if (!v || !v.predicted || !bot.vehicle) return
    bot.vehicle.position = new Vec3(v.pos.x, v.pos.y, v.pos.z)
    bot.vehicle.velocity = new Vec3(v.vel.x, v.vel.y, v.vel.z)
  }
  bot.on('physicsTick', followPrediction)

  // A vehicle the bot does not predict follows the server; a predicted one only takes the server's corrections.
  bot.on('entityMoved', entity => {
    const v = bot.bedrockVehicle
    if (!v || v.predicted || entity !== bot.vehicle) return
    const rotation = rawRotation.get(String(entity.id))
    v.pos.set(Math.fround(entity.position.x), Math.fround(entity.position.y), Math.fround(entity.position.z))
    if (rotation) { v.yaw = rotation.yaw; v.pitch = rotation.pitch }
  })

  bot.mount = (entity) => bot.useOn(entity)

  // The client leaves at once (the server confirms with set_entity_link): the physics stands the bot at the dismount
  // spot, and the leave request tells the server where (the eye position there).
  bot.dismount = () => {
    if (!bot.vehicle) return
    followPrediction()
    const vehicle = bot.vehicle
    bot.emit('bedrockDismount', vehicle)
    const eye = Math.fround(bot.entity.eyeHeight || 1.6200100183486938)
    const at = bot.entity.position
    bot._client.queue('interact', { action_id: 'leave_vehicle', target_entity_id: BigInt(vehicle.id), has_position: true, position: { x: Math.fround(at.x), y: Math.fround(Math.fround(at.y) + eye), z: Math.fround(at.z) } })
    if (Array.isArray(vehicle.passengers)) vehicle.passengers = vehicle.passengers.filter(p => p !== bot.entity)
    bot.entity.vehicle = null
    bot.vehicle = null
    bot.emit('dismount', vehicle)
  }
}
