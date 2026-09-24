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

  // the engine's state of each boat the bot has driven, by entity id
  const boatStates = new Map()
  bot.on('entityGone', entity => boatStates.delete(String(entity.id)))

  const byUniqueId = (id) => Object.values(bot.entities).find(e => e.uniqueId != null && String(e.uniqueId) === String(id))

  // The rotation in degrees as the wire carries it (mineflayer's entity yaw / pitch are radians the other way).
  const rawRotation = new Map()
  function trackRotation (runtimeId, yaw, pitch) {
    if (yaw != null && pitch != null) rawRotation.set(String(runtimeId), { yaw: Math.fround(yaw), pitch: Math.fround(pitch) })
  }
  bot._client.on('add_entity', p => trackRotation(p.runtime_id ?? p.runtime_entity_id, p.yaw, p.pitch))
  bot._client.on('move_entity', p => p.rotation && trackRotation(p.runtime_entity_id, p.rotation.yaw, p.rotation.pitch))
  // a delta carries its angles as signed bytes, 256 to the turn
  const byteAngle = (value) => Math.fround(((value << 24) >> 24) * 1.40625)
  bot._client.on('move_entity_delta', p => {
    const f = p.flags || {}
    if (!f.has_rot_x && !f.has_rot_y) return
    const was = rawRotation.get(String(p.runtime_entity_id)) || { yaw: 0, pitch: 0 }
    trackRotation(p.runtime_entity_id, f.has_rot_y ? byteAngle(p.rot_y) : was.yaw, f.has_rot_x ? byteAngle(p.rot_x) : was.pitch)
  })

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
      entityId: entity.id,
      pos: new Vec3(Math.fround(at.x), Math.fround(at.y), Math.fround(at.z)),
      // a boat the bot drives starts at rest, as the client takes it over; one the server moves keeps its velocity
      vel: driver && PREDICTED.has(entity.name) ? new Vec3(0, 0, 0) : new Vec3(Math.fround(entity.velocity?.x ?? 0), Math.fround(entity.velocity?.y ?? 0), Math.fround(entity.velocity?.z ?? 0)),
      yaw: rotation.yaw,
      pitch: rotation.pitch,
      predicted: driver && PREDICTED.has(entity.name),
      seat: seatOf(entity),
      // its buoyancy data, as the latest metadata has it
      get buoyancyData () { return typeof entity.metadata?.buoyancy_data === 'string' ? entity.metadata.buoyancy_data : undefined },
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
    // a boat keeps its own state (the wave timer, the paddles) from one ride to the next
    const kept = boatStates.get(String(vehicle.id))
    // the link sets the boat's turn rate
    bot.bedrockVehicle.angularVelocity = Math.fround(link.angular_velocity ?? 0)
    if (kept && bot.bedrockVehicle.predicted) bot.bedrockVehicle.boat = { ...kept, yRotD: bot.bedrockVehicle.angularVelocity }
    // a boat the bot drives starts where the client shows it on the first tick ridden (after that tick's
    // interpolation step); the input loop places it then
    if (bot.bedrockVehicle.predicted) bot.bedrockVehicle.placeFrom = vehicle
  })
  // what the bot left a boat with: its state (the heading is the server's latest)
  function keepBoatState () {
    const v = bot.bedrockVehicle
    if (v && v.boat && v.entityId != null) boatStates.set(String(v.entityId), v.boat)
  }
  bot.on('dismount', () => {
    keepBoatState()
    bot.bedrockVehicle = null
  })

  // A predicted vehicle is where the bot drives it: its entity follows the prediction, not the server's echoes of past
  // ticks (a boat left behind at its echo would push the rider who just stepped off it).
  function followPrediction () {
    const v = bot.bedrockVehicle
    if (!v || !v.predicted || !bot.vehicle) return
    bot.vehicle.position = new Vec3(v.pos.x, v.pos.y, v.pos.z)
    bot.vehicle.velocity = new Vec3(v.vel.x, v.vel.y, v.vel.z)
  }
  bot.on('physicsTick', followPrediction)

  // A vehicle the bot does not predict follows the server (its position where the client shows it, which the input
  // loop takes each tick); a predicted one only takes the server's corrections.
  // It also keeps the server's last position, which a dismount leaves from.
  bot.on('entityMoved', entity => {
    const v = bot.bedrockVehicle
    if (!v || v.predicted || entity !== bot.vehicle) return
    const rotation = rawRotation.get(String(entity.id))
    if (rotation) { v.yaw = rotation.yaw; v.pitch = rotation.pitch }
    const at = { x: Math.fround(entity.position.x), y: Math.fround(entity.position.y), z: Math.fround(entity.position.z) }
    v.serverPos = at
  })

  bot.mount = (entity) => bot.useOn(entity)

  // The client leaves at once (the server confirms with set_entity_link): the physics stands the bot at the dismount
  // spot, and the leave request tells the server where (the eye position there).
  // (`byRider` false: the server took the bot off; `alpha`: the frame's progress into the next tick, where known)
  bot.dismount = ({ byRider = true, alpha } = {}) => {
    if (!bot.vehicle) return
    followPrediction()
    keepBoatState()
    const vehicle = bot.vehicle
    bot.emit('bedrockDismount', vehicle, byRider, alpha)
    const eye = Math.fround(bot.entity.eyeHeight || 1.6200100183486938)
    const at = bot.entity.position
    bot._client.queue('interact', { action_id: 'leave_vehicle', target_entity_id: BigInt(vehicle.id), has_position: true, position: { x: Math.fround(at.x), y: Math.fround(Math.fround(at.y) + eye), z: Math.fround(at.z) } })
    if (Array.isArray(vehicle.passengers)) vehicle.passengers = vehicle.passengers.filter(p => p !== bot.entity)
    bot.entity.vehicle = null
    bot.vehicle = null
    bot.emit('dismount', vehicle)
  }
}
