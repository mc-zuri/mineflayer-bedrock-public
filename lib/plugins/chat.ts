import { onceWithCleanup } from '../promise_utils.ts'
import prismarineChat from 'prismarine-chat'
import type { ChatMessage as ChatMessageInstance } from 'prismarine-chat'
import type { Vec3 } from 'vec3'
import type { BotOptions, chatPatternOptions } from '../types/mineflayer.ts'
import type { BotInternal } from '../types/internal.ts'
import type { ChatLoader } from '../types/vendor/prismarine-chat.ts'

const USERNAME_REGEX = '(?:\\(.{1,15}\\)|\\[.{1,15}\\]|.){0,5}?(\\.?\\w+)' // a leading '.': Geyser / Floodgate (Bedrock) players
const LEGACY_VANILLA_CHAT_REGEX = new RegExp(`^${USERNAME_REGEX}\\s?[>:\\-»\\]\\)~]+\\s(.*)$`)

export default inject

interface ChatPatternState {
  name: string
  patterns: RegExp[]
  position: number
  matches: string[]
  messages: ChatMessageInstance[]
  deprecated?: boolean
  repeat: boolean
  parse: boolean
}

function inject (bot: BotInternal, options: BotOptions): void {
  const CHAT_LENGTH_LIMIT = options.chatLengthLimit ?? (bot.supportFeature('lessCharsInChat') ? 100 : 256)
  let endReason: string | undefined
  bot._client.once('end', (reason) => { endReason = reason })
  const defaultChatPatterns = options.defaultChatPatterns ?? true

  const ChatMessage = (prismarineChat as unknown as ChatLoader)(bot.registry)
  // chat.pattern.type will emit an event for bot.on() of the same type, eg chatType = whisper will trigger bot.on('whisper')
  const _patterns: { [index: number]: ChatPatternState | undefined } = {}
  let _length = 0
  // deprecated
  bot.chatAddPattern = (patternValue: RegExp, typeValue: string) => {
    return bot.addChatPattern(typeValue, patternValue, { deprecated: true })
  }

  bot.addChatPatternSet = (name: string, patterns: RegExp[], opts: Partial<chatPatternOptions> = {}) => {
    if (!patterns.every(p => p instanceof RegExp)) throw new Error('Pattern parameter should be of type RegExp')
    const { repeat = true, parse = false } = opts
    _patterns[_length++] = {
      name,
      patterns,
      position: 0,
      matches: [],
      messages: [],
      repeat,
      parse
    }
    return _length
  }

  bot.addChatPattern = (name: string, pattern: RegExp, opts: Partial<chatPatternOptions> & { deprecated?: boolean } = {}) => {
    if (!(pattern instanceof RegExp)) throw new Error('Pattern parameter should be of type RegExp')
    const { repeat = true, deprecated = false, parse = false } = opts
    _patterns[_length] = {
      name,
      patterns: [pattern],
      position: 0,
      matches: [],
      messages: [],
      deprecated,
      repeat,
      parse
    }
    return _length++ // increment length after we give it back to the user
  }

  bot.removeChatPattern = (name: string | number) => {
    if (typeof name === 'number') {
      _patterns[name] = undefined
    } else {
      const matchingPatterns = Object.entries(_patterns).filter(pattern => pattern[1]?.name === name)
      matchingPatterns.forEach(([indexString]) => {
        _patterns[+indexString] = undefined
      })
    }
  }

  function findMatchingPatterns (msg: string) {
    const found: number[] = []
    for (const [indexString, pattern] of Object.entries(_patterns)) {
      if (!pattern) continue
      const { position, patterns } = pattern
      if (patterns[position]!.test(msg)) {
        found.push(+indexString)
      }
    }
    return found
  }

  bot.on('messagestr', (msg, _, originalMsg) => {
    const foundPatterns = findMatchingPatterns(msg)

    for (const ix of foundPatterns) {
      _patterns[ix]!.matches.push(msg)
      _patterns[ix]!.messages.push(originalMsg)
      _patterns[ix]!.position++

      if (_patterns[ix]!.deprecated) {
        // the pattern just matched this message
        const [, ...matches] = _patterns[ix]!.matches[0]!.match(_patterns[ix]!.patterns[0]!)!
        // deprecated patterns emit under the user's chat type name
        ;(bot.emit as (event: string, ...args: unknown[]) => boolean)(_patterns[ix]!.name, ...matches, _patterns[ix]!.messages[0]!.translate, ..._patterns[ix]!.messages)
        _patterns[ix]!.messages = [] // clear out old messages
      } else { // regular parsing
        if (_patterns[ix]!.patterns.length > _patterns[ix]!.matches.length) continue // the set waits for its remaining messages
        if (_patterns[ix]!.parse) {
          const matches = _patterns[ix]!.patterns.map((pattern, i) => {
            const [, ...matches] = _patterns[ix]!.matches[i]!.match(pattern)! // delete full message match
            return matches
          })
          bot.emit(`chat:${_patterns[ix]!.name}`, matches)
        } else {
          bot.emit(`chat:${_patterns[ix]!.name}`, _patterns[ix]!.matches)
        }
        // these are possibly null-ish if the user deletes them as soon as the event for the match is emitted
      }
      if (_patterns[ix]?.repeat) {
        _patterns[ix].position = 0
        _patterns[ix].matches = []
      } else {
        _patterns[ix] = undefined
      }
    }
  })

  addDefaultPatterns()

  bot._client.on('playerChat', (data) => {
    const message = data.formattedMessage
    const verified = data.verified
    let msg: ChatMessageInstance
    if (bot.supportFeature('clientsideChatFormatting')) {
      const parameters = {
        sender: data.senderName ? JSON.parse(data.senderName) : undefined,
        target: data.targetName ? JSON.parse(data.targetName) : undefined,
        content: message ? JSON.parse(message) : { text: data.plainMessage }
      }
      const registryIndex = (data.type as { chatType?: number }).chatType != null ? (data.type as { chatType: number }).chatType : data.type as number
      msg = ChatMessage.fromNetwork(registryIndex, parameters)

      if (data.unsignedContent) {
        msg.unsigned = ChatMessage.fromNetwork(registryIndex, { sender: parameters.sender, target: parameters.target, content: JSON.parse(data.unsignedContent) })
      }
    } else {
      msg = ChatMessage.fromNotch(message!)
    }
    bot.emit('message', msg, 'chat', data.sender, verified)
    bot.emit('messagestr', msg.toString(), 'chat', msg, data.sender, verified)
  })

  bot._client.on('systemChat', (data) => {
    const msg = ChatMessage.fromNotch(data.formattedMessage)
    const chatPositions: Record<1 | 2, string> = {
      1: 'system',
      2: 'game_info'
    }
    bot.emit('message', msg, chatPositions[data.positionId], null)
    bot.emit('messagestr', msg.toString(), chatPositions[data.positionId], msg, null)
    if (data.positionId === 2) bot.emit('actionBar', msg, null)
  })

  let send = (message: string) => bot._client.chat(message)
  if (bot.supportFeature('chatCommandsQueuedToMainThread')) {
    // 1.19.0 rejects a queued command as out-of-order if a chat message overtakes
    // it; a tab_complete reply proves every earlier command has been processed.
    let sendChain = Promise.resolve()
    let commandPending = false
    send = (message: string) => {
      const isCommand = message.startsWith('/')
      sendChain = sendChain.then(async () => {
        if (!isCommand && commandPending) {
          commandPending = false
          await tabComplete('/', false, false).catch(() => {})
        }
        bot._client.chat(message)
        if (isCommand) commandPending = true
      })
    }
  }

  function chatWithHeader (header: string, message: string | number) {
    if (typeof message === 'number') message = message.toString()
    if (typeof message !== 'string') {
      throw new Error('Chat message type must be a string or number: ' + typeof message)
    }
    // minecraft-protocol only attaches client.chat once the login packet puts it in the play state.
    if (typeof bot._client.chat !== 'function') {
      if (endReason !== undefined) {
        throw new Error(`bot.chat() called after the client disconnected before entering the play state (${endReason})`)
      }
      throw new Error('bot.chat() called before the client entered the play state; wait for the "login" or "spawn" event')
    }

    if (!header && message.startsWith('/')) {
      // Do not try and split a command without a header
      send(message)
      return
    }

    const lengthLimit = CHAT_LENGTH_LIMIT - header.length
    message.split('\n').forEach((subMessage) => {
      if (!subMessage) return
      let i: number
      let smallMsg: string
      for (i = 0; i < subMessage.length; i += lengthLimit) {
        smallMsg = header + subMessage.substring(i, i + lengthLimit)
        send(smallMsg)
      }
    })
  }

  // 1.13+: like vanilla's pending suggestions id, the server echoes it in its answer
  let tabCompleteId = -1
  async function tabComplete (text: string, assumeCommand = false, sendBlockInSight = true, timeout = 5000) {
    if (bot.supportFeature('tabCompleteHasAToolTip')) { // 1.13+: only the text and an id
      const transactionId = ++tabCompleteId
      bot._client.write('tab_complete', { transactionId, text })
      const [packet] = await onceWithCleanup(bot._client, 'tab_complete', {
        timeout,
        checkCondition: (packet) => packet.transactionId === transactionId
      })
      return packet.matches
    }

    let position: Vec3 | undefined

    if (sendBlockInSight) {
      const block = bot.blockAtCursor()

      if (block) {
        position = block.position
      }
    }

    bot._client.write('tab_complete', {
      text,
      assumeCommand, // 1.9 - 1.12
      lookedAtBlock: position, // 1.9 - 1.12
      block: position // 1.8
    })

    const [packet] = await onceWithCleanup(bot._client, 'tab_complete', { timeout })
    return packet.matches
  }

  bot.whisper = (username: string, message: string) => {
    chatWithHeader(`/tell ${username} `, message)
  }
  bot.chat = (message: string) => {
    chatWithHeader('', message)
  }

  bot.tabComplete = tabComplete

  function addDefaultPatterns () {
    // 1.19 changes the chat format to move <sender> prefix from message contents to a separate field.
    // TODO: new chat lister to handle this
    if (!defaultChatPatterns) return
    bot.addChatPattern('whisper', new RegExp(`^${USERNAME_REGEX} whispers(?: to you)?:? (.*)$`), { deprecated: true })
    bot.addChatPattern('whisper', new RegExp(`^\\[${USERNAME_REGEX} -> \\w+\\s?\\] (.*)$`), { deprecated: true })
    bot.addChatPattern('chat', LEGACY_VANILLA_CHAT_REGEX, { deprecated: true })
  }

  function awaitMessage (...args: Array<string | RegExp | Array<string | RegExp> | number>) {
    const timeout = typeof args[args.length - 1] === 'number' ? args.pop() as number : 20000
    return new Promise<string>((resolve, reject) => {
      const resolveMessages = (args as Array<string | RegExp | Array<string | RegExp>>).flatMap(x => x)
      const timeoutHandle = setTimeout(() => {
        bot.off('messagestr', messageListener)
        reject(new Error(`Timeout waiting for message after ${timeout}ms`))
      }, timeout)

      function messageListener (msg: string) {
        if (resolveMessages.some(x => x instanceof RegExp ? x.test(msg) : msg === x)) {
          clearTimeout(timeoutHandle)
          resolve(msg)
          bot.off('messagestr', messageListener)
        }
      }
      bot.on('messagestr', messageListener)
    })
  }
  bot.awaitMessage = awaitMessage
}
