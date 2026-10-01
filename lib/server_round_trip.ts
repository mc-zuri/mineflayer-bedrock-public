import type { BotInternal } from './types/internal.ts'

// The server answers client_command stats requests in the order it received
// them, so each statistics packet belongs to the oldest pending request.
// Anything written before that request has been processed by then, and what
// the server sent while processing it has arrived before the statistics.
// Shared by the plugins that use it: each statistics packet answers one
// request, whichever plugin made it.
const pendingStatsRequests = new WeakMap<BotInternal['_client'], Array<{ answered: () => void }>>()

function pendingFor (bot: BotInternal): Array<{ answered: () => void }> {
  let pending = pendingStatsRequests.get(bot._client)
  if (!pending) {
    const queue: Array<{ answered: () => void }> = []
    pending = queue
    pendingStatsRequests.set(bot._client, queue)
    bot._client.on('statistics', () => {
      const oldest = queue.shift()
      if (oldest) oldest.answered()
    })
  }
  return pending
}

// Timing out resolves as success: a server that never answers stats
// degrades to a fixed wait, never a hang.
export function confirmServerProcessed (bot: BotInternal, timeoutMs: number): Promise<void> {
  const pending = pendingFor(bot)
  return new Promise<void>((resolve) => {
    const request = {
      answered () {
        clearTimeout(timer)
        resolve()
      }
    }
    const timer = setTimeout(() => {
      const i = pending.indexOf(request)
      if (i !== -1) pending.splice(i, 1)
      resolve()
    }, timeoutMs)
    pending.push(request)
    bot._client.write('client_command', bot.supportFeature('respawnIsPayload') ? { payload: 1 } : { actionId: 1 })
  })
}
