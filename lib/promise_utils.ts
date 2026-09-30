import type TypedEmitter from 'typed-emitter'
import type { PacketMeta } from 'minecraft-protocol'
import type { BotEvents } from './types/mineflayer.ts'
import type { ClientboundPackets, ClientEvents, TypedClient } from './types/protocol.ts'

export interface Task<T = void> {
  done: boolean
  promise: Promise<T>
  cancel: (err?: unknown) => void
  finish: (result: T) => void
}

/** anything with node EventEmitter-style addListener/removeListener */
export interface Emitter {
  addListener (event: any, listener: (...args: any[]) => void): unknown
  removeListener (event: any, listener: (...args: any[]) => void): unknown
}

type BotEmitter = Pick<TypedEmitter<BotEvents>, 'addListener' | 'removeListener'> & { _client: unknown }

export interface OnceOptions<T extends unknown[]> {
  timeout?: number
  checkCondition?: (...data: T) => unknown
  signal?: AbortSignal
}

function sleep (ms: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

function createTask<T = void> (): Task<T> {
  const task = {
    done: false
  } as Task<T>
  task.promise = new Promise<T>((resolve, reject) => {
    task.cancel = (err) => {
      if (!task.done) {
        task.done = true
        reject(err)
      }
    }
    task.finish = (result) => {
      if (!task.done) {
        task.done = true
        resolve(result)
      }
    }
  })
  return task
}

function createDoneTask (): Task<void> {
  const task: Task<void> = {
    done: true,
    promise: Promise.resolve(),
    cancel: () => {},
    finish: () => {}
  }
  return task
}

/**
 * Similar to the 'once' function from the 'events' module, but allows you to add a condition for when you want to
 * actually handle the event, as well as a timeout. The listener is additionally removed if a timeout occurs, instead
 * of with 'once' where a listener might stay forever if it never triggers.
 * Note that timeout and checkCondition, both optional, are in the third parameter as an object.
 * @param emitter - The event emitter to listen to
 * @param event - The name of the event you want to listen for
 * @param [timeout=0] - An amount, in milliseconds, for which to wait before considering the promise failed. <0 = none.
 * @param [checkCondition] - A function which matches the same signature of an event emitter handler, and should return something truthy if you want the event to be handled. If this is not provided, all events are handled.
 * @param [signal] - An AbortSignal which, when aborted, removes the listener and rejects the promise with the signal's reason.
 * @returns {Promise} A promise which will either resolve to an *array* of values in the handled event, or will reject on timeout if applicable. This may never resolve if no timeout is set and the event does not fire.
 */
function onceWithCleanup<K extends keyof ClientboundPackets> (emitter: TypedClient, event: K, options?: OnceOptions<[ClientboundPackets[K], PacketMeta]>): Promise<[ClientboundPackets[K], PacketMeta]>
function onceWithCleanup<K extends keyof ClientEvents> (emitter: TypedClient, event: K, options?: OnceOptions<Parameters<ClientEvents[K]>>): Promise<Parameters<ClientEvents[K]>>
function onceWithCleanup<K extends keyof BotEvents> (emitter: BotEmitter, event: K, options?: OnceOptions<Parameters<BotEvents[K]>>): Promise<Parameters<BotEvents[K]>>
function onceWithCleanup<T extends unknown[] = any[]> (emitter: Emitter, event: string | symbol, options?: OnceOptions<T>): Promise<T>
function onceWithCleanup (emitter: Emitter, event: string | symbol, { timeout = 0, checkCondition = undefined, signal = undefined }: OnceOptions<any[]> = {}): Promise<any[]> {
  const task = createTask<any[]>()

  const onEvent = (...data: any[]) => {
    if (typeof checkCondition === 'function') {
      let matches
      try {
        matches = checkCondition(...data)
      } catch (err) {
        // checkCondition runs inside emit(), which for client events is the socket
        // read path: throwing there unwinds it and the client silently stops
        // receiving packets. Reject the promise instead, so the caller sees it.
        task.cancel(err)
        return
      }
      if (!matches) return
    }

    task.finish(data)
  }

  emitter.addListener(event, onEvent)

  let onAbort: (() => void) | undefined
  if (signal) {
    const abortError = () => signal.reason instanceof Error
      ? signal.reason
      : new Error(`Waiting for event ${String(event)} was aborted`)
    if (signal.aborted) {
      task.cancel(abortError())
    } else {
      onAbort = () => task.cancel(abortError())
      signal.addEventListener('abort', onAbort, { once: true })
    }
  }

  if (typeof timeout === 'number' && timeout > 0) {
    // For some reason, the call stack gets lost if we don't create the error outside of the .then call
    const timeoutError = new Error(`Event ${String(event)} did not fire within timeout of ${timeout}ms`)
    sleep(timeout).then(() => {
      if (!task.done) {
        task.cancel(timeoutError)
      }
    })
  }

  task.promise.catch(() => {}).finally(() => {
    emitter.removeListener(event, onEvent)
    if (onAbort) signal!.removeEventListener('abort', onAbort)
  })

  return task.promise
}

function once<K extends keyof ClientboundPackets> (emitter: TypedClient, event: K, timeout?: number): Promise<[ClientboundPackets[K], PacketMeta]>
function once<K extends keyof ClientEvents> (emitter: TypedClient, event: K, timeout?: number): Promise<Parameters<ClientEvents[K]>>
function once<K extends keyof BotEvents> (emitter: BotEmitter, event: K, timeout?: number): Promise<Parameters<BotEvents[K]>>
function once<T extends unknown[] = any[]> (emitter: Emitter, event: string | symbol, timeout?: number): Promise<T>
function once (emitter: Emitter, event: string | symbol, timeout = 20000): Promise<any[]> {
  return onceWithCleanup(emitter, event, { timeout })
}

function withTimeout<T> (promise: Promise<T>, timeout: number): Promise<T> {
  return Promise.race([
    promise,
    sleep(timeout).then(() => {
      throw new Error('Promise timed out.')
    })
  ])
}

export {
  once,
  sleep,
  createTask,
  createDoneTask,
  onceWithCleanup,
  withTimeout
}
