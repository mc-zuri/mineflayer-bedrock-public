# TypeScript migration

mineflayer's sources and tests are TypeScript that Node runs directly by
[type stripping](https://nodejs.org/api/typescript.html) (Node >= 22.18). There is no build step:
removing the types gives back the JavaScript the project had before, apart from the bug fixes
listed below.

## How it works

- `tsconfig.json`: `erasableSyntaxOnly` (no enums, namespaces, parameter properties, `import =`),
  `verbatimModuleSyntax` (type-only imports use `import type`), `strict`, `noImplicitAny`,
  `module: preserve` so the default imports of the CommonJS prismarine-* packages type as Node
  runs them. Relative imports keep their `.ts` extension.
- Type checker: TypeScript 7 (`npm run typecheck`, the `typescript7` alias of `typescript@^7`).
  `typescript` 6.0 stays installed only because typescript-eslint has no TypeScript 7 support yet.
- Lint: `neostandard` (standard style with TypeScript support).
- ES modules: `index.ts` also exports the module as `'module.exports'` (so `require('mineflayer')`
  returns the same object as before, Node >= 22.12) and as `default` (so
  `import mineflayer from 'mineflayer'` keeps working).
- Class fields are declared with `declare` so stripping does not turn them into real fields.

## Types

- `lib/types/mineflayer.ts`: the public API (`index.d.ts` re-exports it). It is a type-only module
  so it is type checked - as a `.d.ts`, `skipLibCheck` skipped it and it had drifted from the code.
- `lib/types/internal.ts`: `BotInternal`, the plugins' view of the bot - the public `Bot` with a
  packet-typed `_client` and the `_underscore` helpers plugins share.
- `lib/types/protocol.ts`: the packets mineflayer reads and writes, merged by hand across every
  tested version (1.8.8 - 26.1): a field every version has is required, a field only some versions
  have is optional with its version range, a field whose type changed is a union. The per-version
  reference shapes were generated with
  [mc-zuri/types-minecraft-data](https://github.com/mc-zuri/types-minecraft-data) and checked
  against minecraft-protocol's runtime representations (an i64 is a `[high, low]` array whose
  `valueOf()` is the bigint, positions are `{ x, y, z }` numbers, text is JSON before 1.20.3 and
  NBT after). `TypedClient` has no catch-all overload, so listening to a packet name no version has
  is a compile error - that is how several dead listeners were found.
- `lib/types/vendor/*.ts`: augmentations for dependencies whose typings are missing or wrong.

## Bugs fixed

Every bug is its own commit; the commit message explains the bug, how it showed up and since when.
Most lib fixes come with a regression test (`test/coreTest.ts`, `test/entitiesTest.ts`,
`test/worldTest.ts`, `test/inventoryTest.ts`, `test/internalTest.ts`) that fails without the fix.
"tests" are tests that could not fail or did not test what they claimed.

### anvil

| commit | bug |
| --- | --- |
| `7fb3ea17` | combine checked the xp level against the wrong cost |
| `2dc49508` | rename in creative waited for an experience event that never comes |

### bed

| commit | bug |
| --- | --- |
| `da22f5bf` | sleep threw a TypeError when a bed neighbour was not loaded |
| `80f3232a` | sleep did not see monsters nearby on 1.17 and 1.18 |

### blocks

| commit | bug |
| --- | --- |
| `7495d4f5` | drop a read of map_chunk_bulk.heightmaps, a field it never had |
| `a130698b` | a world switch skipped positions with several blockUpdate listeners |
| `b4d1f9a4` | decide a respawn world switch by the world name, like vanilla |

### boss_bar

| commit | bug |
| --- | --- |
| `753c21a2` | drop listeners for packets no version has |

### bossbar

| commit | bug |
| --- | --- |
| `ed2f88c5` | flags getter shifted the flag bits twice |

### chat

| commit | bug |
| --- | --- |
| `05c04ed4` | tabComplete sent no transaction id on 1.13+ and no looked-at block on 1.8 |

### craft

| commit | bug |
| --- | --- |
| `9656d56d` | reject with the original error |

### creative

| commit | bug |
| --- | --- |
| `62ad77fe` | rejected creative slot sets went unnoticed on 1.21.3+ |
| `39982a47` | stopFlying before startFlying set gravity to null |

### digging

| commit | bug |
| --- | --- |
| `44397b6c` | a dig overlapping the previous one's finish started with face null |
| `f608485c` | stopDigging sent the dig's face instead of 0 (down) |
| `844f9fd0` | a dig that interrupted another started with face null |

### entities

| commit | bug |
| --- | --- |
| `d33e27aa` | dismount when the vehicle entity is destroyed |
| `eacdafc2` | hand swap status threw assigning the getter-only heldItem |
| `0b13822c` | player gamemode updates were ignored before 1.19.3 |
| `4399f501` | two attach_entity handlers corrupted vehicle.passengers |
| `bf780d76` | bot never dismounted on 1.9+ when it got off a vehicle |
| `3b900603` | entity velocities were 8000 times too small on 1.21.9+ |
| `5e87b578` | entity_teleport misread on 1.21.3+ (rotation, relative flags, velocity) |
| `2f4e1b6a` | attach_entity leash packets were treated as riding |
| `05396376` | 1.17 - 1.20.4 entity attributes were stored under "undefined" |
| `afd66c72` | apply the 1.21.3+ entity_teleport rotate-delta flag |
| `4e169b3f` | bot.vehicle was undefined until the first mount/dismount |

### esm

| commit | bug |
| --- | --- |
| `58fe2eb2` | keep `import mineflayer from 'mineflayer'` working |

### explosion

| commit | bug |
| --- | --- |
| `c503d8ff` | getExplosionDamages armor attribute lookup |

### fishing

| commit | bug |
| --- | --- |
| `0bcadebf` | find the bobber whatever the plugin order |
| `7926ef99` | only accept the bot's own bobber |

### game

| commit | bug |
| --- | --- |
| `40a6cd99` | bot.game.hardcore |
| `82b883fc` | read the 1.21.6+ difficulty name |
| `60233d61` | end credits client_command used a field no version has |
| `a6027b22` | a peaceful difficulty in login / respawn was ignored (1.8 - 1.13) |
| `75608781` | a registry_data entry without a value crashed the registry load |

### inventory

| commit | bug |
| --- | --- |
| `08813e9e` | wait out the dig click timeout on the clock digging uses |
| `397e517d` | transfer defaults an omitted sourceEnd / destEnd |
| `c406f721` | no windowClose(null) for a close_window with no window open |
| `db5edfd1` | consume with an empty hand rejects with a clear error |
| `a61a5a20` | only stop using the held item when it actually changes |
| `5b217494` | match 1.21.2+ set_cooldown by cooldown group |
| `cd95c6d6` | a merchant window click without a selected trade |
| `13a44dd7` | a server-side window close did not emit the window's close event |
| `73413489` | the click action number wrap tripped the transaction queue assert |
| `2fc27d85` | transfer compared the cursor nbt with the nbt option by reference |

### physics

| commit | bug |
| --- | --- |
| `dc53ca38` | apply the 1.21.2+ position packet velocity and its flags |

### place_block

| commit | bug |
| --- | --- |
| `2f8655d0` | a destination in an unloaded chunk threw a TypeError |

### place_entity

| commit | bug |
| --- | --- |
| `51e01aaa` | the first unrelated entity spawn made placeEntity fail |
| `5c70cdd7` | boats placed on 1.21.2+ and chest boats were never found |

### ray_trace

| commit | bug |
| --- | --- |
| `327826c1` | blockAtCursor returned null at pitch 0 or yaw 0 |

### resource_pack

| commit | bug |
| --- | --- |
| `a87bda23` | denyResourcePack on 1.20.3+ wrote a uuid-less answer |
| `c8e50665` | drop the unreachable UUID branch of resource_pack_send |

### scoreboard

| commit | bug |
| --- | --- |
| `f5966605` | track scores on 1.20.3+ |
| `bc7afd40` | read the objective title from NBT on 1.20.3+ |

### settings

| commit | bug |
| --- | --- |
| `d16bb92e` | enableServerListing: false was ignored |

### team

| commit | bug |
| --- | --- |
| `ab8c0617` | teamRemoved emitted undefined |
| `d5e4303b` | read the team color before 1.13 |
| `99c635de` | friendlyFire and the team rules on 1.21.5+ |

### time

| commit | bug |
| --- | --- |
| `19b1af9a` | 26.1 world clocks were looked up by dimension type id |

### title

| commit | bug |
| --- | --- |
| `b364fda0` | 1.11 - 1.16 title actions |
| `655bf01d` | styled titles on 1.20.3+ emitted the NBT value |

### villager

| commit | bug |
| --- | --- |
| `11f198c3` | a trade without a second input has inputItem2 null |
| `785259df` | predict the trading slots as Item instances |

### tests

| commit | bug |
| --- | --- |
| `5197edb6` | switchWorld respawn wrote a property on a string dimension |
| `37caddfc` | packet trace timing parsed the trace file path as a number |
| `bae69985` | commandBlock passed false as setCommandBlock options |
| `a438c3de` | RUNNER_DEBUG packet logging dropped keep_alive and pong answers |
| `b399b554` | heldItem compared undefined with undefined |
| `89a37b45` | placeEntity boat test gave a boat item that does not exist on 1.13+ |
| `4b279ca7` | construct Vec3 from the class and call bot.supportFeature with one argument |
| `53b08830` | exampleInventory removed commands from the shared list on every 1.8 run |
| `d9135381` | trade did not await its 'trade is blocked' assertion |
| `3a48981c` | drop the chat test's branch for a feature that does not exist |
| `619798d8` | the despawn test destroyed an entity that never existed |
| `e4aa3426` | the metadata test compared entity.metadata with itself |
| `0f4f4a89` | the bed test's sleep assertions could never fail it |
| `b6f3cfe9` | placeEntity's boat test expected the boat entity on 1.21.2+, run it again |
| `469257ef` | the boat placement test spawned a 'boat' where 1.21.2+ has oak_boat |
| `fe74eace` | the chat test read reply fields no serverbound chat packet has |
| `7cf92507` | drop the version constant the bed test no longer reads |

## Known limitations

- 26.3 is not supported yet: minecraft-protocol has no `vecDelta` type, which its movement packets use.
- 1.21.5+ `window_click` sends component hashes of 0 instead of vanilla's CRC32C hashes of the
  components' persistent codec form; the server resends mismatching slots, so the result corrects
  itself (see the comment in `lib/plugins/inventory.ts`).
- The `kicked` event's reason is a JSON string before 1.20.3 and NBT after (documented in
  `docs/api.md`; unchanged to keep the event API).
- prismarine-registry's `loadDimensionCodec` throws on a `registry_data` entry without a value; mineflayer
  now fills such entries before calling it, the upstream package is unchanged.
- Some third-party typings cannot be corrected with module augmentation (a property's existing type
  cannot change): prismarine-windows `Window.title` (a ChatMessage for server windows),
  prismarine-recipe shapes (nullable), prismarine-entity `vehicle` (nullable). The code casts there.
- Publishing: Node does not strip types inside `node_modules`, so a published package needs a build
  step that emits JavaScript and `.d.ts` files.
