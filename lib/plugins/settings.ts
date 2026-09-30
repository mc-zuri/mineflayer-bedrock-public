import assert from 'assert'
import type { BotOptions, GameSettings } from '../types/mineflayer.ts'
import type { BotInternal } from '../types/internal.ts'

export default inject

const chatToBits: Record<string, number> = {
  enabled: 0,
  commandsOnly: 1,
  disabled: 2
}

const handToBits: Record<string, number> = {
  left: 0,
  right: 1
}

const viewDistanceToBits: Record<string, number> = {
  far: 12,
  normal: 10,
  short: 8,
  tiny: 6
}

function inject (bot: BotInternal, options: BotOptions): void {
  function setSettings (settings: Partial<GameSettings>) {
    extend(bot.settings, settings)

    // chat
    const chatBits = chatToBits[bot.settings.chat]
    assert.ok(chatBits != null, `invalid chat setting: ${bot.settings.chat}`)

    // view distance
    let viewDistanceBits: number | null = null
    if (typeof bot.settings.viewDistance === 'string') {
      viewDistanceBits = viewDistanceToBits[bot.settings.viewDistance]
    } else if (typeof bot.settings.viewDistance === 'number' && bot.settings.viewDistance > 0) { // Make sure view distance is a valid # || should be 2 or more
      viewDistanceBits = bot.settings.viewDistance
    }
    assert.ok(viewDistanceBits != null, `invalid view distance setting: ${bot.settings.viewDistance}`)

    // hand
    const handBits = handToBits[bot.settings.mainHand]
    assert.ok(handBits != null, `invalid main hand: ${bot.settings.mainHand}`)

    // skin
    // cape is inverted, not used at all (legacy?)
    // bot.settings.showCape = !!bot.settings.showCape
    const skinParts = (bot.settings.skinParts.showCape as unknown as number) << 0 |
          (bot.settings.skinParts.showJacket as unknown as number) << 1 |
          (bot.settings.skinParts.showLeftSleeve as unknown as number) << 2 |
          (bot.settings.skinParts.showRightSleeve as unknown as number) << 3 |
          (bot.settings.skinParts.showLeftPants as unknown as number) << 4 |
          (bot.settings.skinParts.showRightPants as unknown as number) << 5 |
          (bot.settings.skinParts.showHat as unknown as number) << 6

    // write the packet
    bot._client.write('settings', {
      locale: bot.settings.locale || 'en_US',
      viewDistance: viewDistanceBits!,
      chatFlags: chatBits,
      chatColors: bot.settings.colorsEnabled,
      skinParts,
      mainHand: handBits,
      enableTextFiltering: bot.settings.enableTextFiltering,
      enableServerListing: bot.settings.enableServerListing,
      particleStatus: bot.settings.particleStatus
    })
  }

  bot.settings = {
    chat: options.chat || 'enabled',
    colorsEnabled: options.colorsEnabled == null
      ? true
      : options.colorsEnabled,
    viewDistance: options.viewDistance || 'far',
    difficulty: options.difficulty == null
      ? 2
      : options.difficulty,
    skinParts: options.skinParts == null
      ? {
          showCape: true,
          showJacket: true,
          showLeftSleeve: true,
          showRightSleeve: true,
          showLeftPants: true,
          showRightPants: true,
          showHat: true
        }
      : options.skinParts,
    mainHand: options.mainHand || 'right',
    enableTextFiltering: options.enableTextFiltering || false,
    enableServerListing: options.enableServerListing || true,
    particleStatus: 'all'
  }

  bot._client.on('login', () => {
    setSettings({})
  })

  bot.setSettings = setSettings
}

const hasOwn = {}.hasOwnProperty
function extend<T extends object> (obj: T, src: Partial<T>): T {
  for (const key in src) {
    if (hasOwn.call(src, key)) obj[key] = src[key]!
  }
  return obj
}
