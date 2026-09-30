// Members of the pc registry that prismarine-registry's d.ts (1.x) does not declare.
import type { Sound } from 'minecraft-data'
import type { AnonymousNbt } from '../protocol.ts'

/** a dimension_type registry entry as loadDimensionCodec stores it */
export interface RegistryDimension {
  /** without the minecraft: prefix */
  name: string
  minY: number
  height: number
}

declare module 'prismarine-registry' {
  interface RegistryPc {
    // minecraft-data sounds.json, indexed
    sounds: { [id: number]: Sound }
    soundsByName: { [name: string]: Sound }
    soundsArray: Sound[]
    // set by loadDimensionCodec (1.16.2+ login dimension codec, 1.20.2+ registry_data); undefined before
    dimensionsById?: { [id: number]: RegistryDimension }
    dimensionsByName?: { [name: string]: RegistryDimension }
    dimensionsArray?: RegistryDimension[]
    /** the codec is any anonymous NBT compound (1.20.2 – 1.20.4 registry_data); 1.20.5+ one registry_data packet ({ id, entries }) */
    loadDimensionCodec (codec: AnonymousNbt | { id?: string, entries?: Array<{ key: string, value?: unknown }> }): void
  }
}
