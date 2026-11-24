import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { isSessionRuntime, RUNTIME_PATH, type SessionRuntime } from '../lib/runtime.js'
import type { WatchedTranslate } from './labels.js'

const BATCH_LIMIT = 50
const FLUSH_DELAY_MS = 16
const FETCH_TIMEOUT_MS = 15_000
const TICK_INTERVAL_MS = 1_000
const RETRY_BASE_MS = 400
const MAX_RETRIES = 4

export type SessionRuntimeEntry =
  | { readonly status: 'loading' }
  | ({ readonly status: 'ready' } & SessionRuntime)
  | { readonly status: 'error' }

interface TrackedState {
  count: number
  signature: string
  fetchedSignature?: string
  running: boolean
  retries: number
}

export interface RuntimeClientOptions {
  readonly fetch?: typeof globalThis.fetch
  readonly baseURI?: () => string
  readonly now?: () => number
}

/** Format a non-negative duration in milliseconds into compact localized units. */
export function formatDuration(ms: number, label: WatchedTranslate): string {
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0
  const totalSeconds = Math.floor(safeMs / 1000)
  if (totalSeconds < 60) return label('durationS', { s: totalSeconds })
  if (totalSeconds < 3600) {
    const m = Math.floor(totalSeconds / 60)
    const s = totalSeconds % 60
    return s === 0 ? label('durationM', { m }) : label('durationMS', { m, s })
  }
  if (totalSeconds < 86400) {
    const h = Math.floor(totalSeconds / 3600)
    const m = Math.floor((totalSeconds % 3600) / 60)
    return m === 0 ? label('durationH', { h }) : label('durationHM', { h, m })
  }
  const d = Math.floor(totalSeconds / 86400)
  const h = Math.floor((totalSeconds % 86400) / 3600)
  return h === 0 ? label('durationD', { d }) : label('durationDH', { d, h })
}

/** Return total elapsed runtime for a resolved entry at `now`. */
export function runtimeElapsedMs(entry: Extract<SessionRuntimeEntry, { status: 'ready' }>, now: number): number {
  return entry.runningSince === null ? entry.completedMs : entry.completedMs + Math.max(0, now - entry.runningSince)
}

function runtimeUrl(baseURI: string, ids: readonly SessionId[]): URL {
  const url = new URL(RUNTIME_PATH.slice(1), baseURI)
  for (const id of ids) url.searchParams.append('id', id)
  return url
}

function isRuntimeResponse(value: unknown): value is { readonly runtimes: Record<string, SessionRuntime> } {
  if (value === null || typeof value !== 'object' || !('runtimes' in value)) return false
  const { runtimes } = value as { runtimes: unknown }
  if (runtimes === null || typeof runtimes !== 'object' || Array.isArray(runtimes)) return false
  return Object.values(runtimes).every(isSessionRuntime)
}

/**
 * Batch, cache, and tick total running durations for rendered session rows.
 * Issues zero Host requests unless a subscriber calls `track`.
 */
export function createRuntimeClient(options: RuntimeClientOptions = {}) {
  const fetchImpl = options.fetch ?? ((...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args))
  const readBaseURI = options.baseURI ?? (() => document.baseURI)
  const readNow = options.now ?? (() => Date.now())

  const entries = new Map<SessionId, SessionRuntimeEntry>()
  const tracked = new Map<SessionId, TrackedState>()
  const pendingIds = new Set<SessionId>()
  const listeners = new Set<() => void>()
  const clockListeners = new Set<() => void>()
  const retryTimers = new Map<SessionId, ReturnType<typeof setTimeout>>()
  const inFlightControllers = new Set<AbortController>()

  let disposed = false
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  let clockInterval: ReturnType<typeof setInterval> | undefined
  let currentNow = readNow()

  function notifyEntries(): void {
    for (const listener of listeners) listener()
  }

  function notifyClock(): void {
    for (const listener of clockListeners) listener()
  }

  function clearRetry(id: SessionId): void {
    const timer = retryTimers.get(id)
    if (timer === undefined) return
    clearTimeout(timer)
    retryTimers.delete(id)
  }

  function scheduleFlush(delayMs = FLUSH_DELAY_MS): void {
    if (disposed || pendingIds.size === 0 || flushTimer !== undefined) return
    flushTimer = setTimeout(() => {
      flushTimer = undefined
      void flush()
    }, delayMs)
  }

  function scheduleRetry(id: SessionId, delayMs: number): void {
    if (disposed || retryTimers.has(id)) return
    const timer = setTimeout(() => {
      retryTimers.delete(id)
      if (disposed || !tracked.has(id)) return
      pendingIds.add(id)
      scheduleFlush(0)
    }, delayMs)
    retryTimers.set(id, timer)
  }

  async function fetchBatch(ids: readonly SessionId[]): Promise<void> {
    if (disposed || ids.length === 0) return
    const sentSignatures = new Map<SessionId, string>()
    for (const id of ids) {
      const state = tracked.get(id)
      if (state !== undefined) sentSignatures.set(id, state.signature)
    }

    const controller = new AbortController()
    inFlightControllers.add(controller)
    const signal = typeof AbortSignal.timeout === 'function'
      ? AbortSignal.any([controller.signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)])
      : controller.signal

    let dirty = false
    try {
      const response = await fetchImpl(runtimeUrl(readBaseURI(), ids), { signal })
      if (!response.ok) throw new Error(`Session runtime request failed (${response.status})`)
      const data: unknown = await response.json()
      if (!isRuntimeResponse(data)) throw new Error('Invalid session runtime response')
      if (disposed) return

      for (const id of ids) {
        const raw = Object.hasOwn(data.runtimes, id) ? data.runtimes[id] : undefined
        const nextEntry: SessionRuntimeEntry = raw === undefined
          ? { status: 'error' }
          : { status: 'ready', completedMs: raw.completedMs, runningSince: raw.runningSince }
        if (nextEntry.status === 'ready' && nextEntry.runningSince !== null) {
          currentNow = Math.max(currentNow, readNow())
        }
        entries.set(id, nextEntry)
        dirty = true

        const current = tracked.get(id)
        if (current === undefined) continue
        const sent = sentSignatures.get(id)
        if (current.signature !== sent) {
          current.fetchedSignature = undefined
          pendingIds.add(id)
          continue
        }
        current.fetchedSignature = sent
        if (nextEntry.status === 'ready') {
          const expectsRunning = current.running
          const actualRunning = nextEntry.runningSince !== null
          if (expectsRunning !== actualRunning && current.retries < MAX_RETRIES) {
            current.retries += 1
            scheduleRetry(id, current.retries * RETRY_BASE_MS)
          }
        }
      }
    } catch {
      if (disposed || controller.signal.aborted) return
      for (const id of ids) {
        const previous = entries.get(id)
        if (previous === undefined || previous.status === 'loading') {
          entries.set(id, { status: 'error' })
          dirty = true
        }
      }
    } finally {
      inFlightControllers.delete(controller)
      if (dirty && !disposed) notifyEntries()
      if (!disposed && pendingIds.size > 0) scheduleFlush(0)
    }
  }

  async function flush(): Promise<void> {
    if (disposed || pendingIds.size === 0) return
    const batch = [...pendingIds].slice(0, BATCH_LIMIT)
    for (const id of batch) pendingIds.delete(id)
    if (pendingIds.size > 0) scheduleFlush(0)
    await fetchBatch(batch)
  }

  return {
    track(id: SessionId, signature: string, running: boolean): () => void {
      if (disposed) return () => {}
      const existing = tracked.get(id)
      let needsFetch = false
      if (existing === undefined) {
        tracked.set(id, { count: 1, signature, running, retries: 0 })
        needsFetch = true
      } else {
        existing.count += 1
        existing.running = running
        if (existing.signature !== signature || (entries.get(id)?.status === 'error' && existing.fetchedSignature !== signature)) {
          existing.signature = signature
          existing.retries = 0
          clearRetry(id)
          needsFetch = true
        }
      }

      const currentState = tracked.get(id)!
      if (needsFetch && currentState.fetchedSignature !== signature) {
        if (entries.get(id) === undefined) {
          entries.set(id, { status: 'loading' })
          notifyEntries()
        }
        pendingIds.add(id)
        scheduleFlush()
      }

      let active = true
      return () => {
        if (!active) return
        active = false
        const state = tracked.get(id)
        if (state === undefined) return
        state.count -= 1
        if (state.count <= 0) {
          tracked.delete(id)
          pendingIds.delete(id)
          clearRetry(id)
        }
      }
    },

    getEntry: (id: SessionId): SessionRuntimeEntry | undefined => entries.get(id),

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },

    subscribeClock(listener: () => void): () => void {
      if (disposed) return () => {}
      clockListeners.add(listener)
      if (clockInterval === undefined) {
        currentNow = Math.max(currentNow, readNow())
        clockInterval = setInterval(() => {
          currentNow = Math.max(currentNow, readNow())
          notifyClock()
        }, TICK_INTERVAL_MS)
      }
      return () => {
        clockListeners.delete(listener)
        if (clockListeners.size === 0 && clockInterval !== undefined) {
          clearInterval(clockInterval)
          clockInterval = undefined
        }
      }
    },

    getNow: (): number => currentNow,

    dispose(): void {
      if (disposed) return
      disposed = true
      if (flushTimer !== undefined) {
        clearTimeout(flushTimer)
        flushTimer = undefined
      }
      if (clockInterval !== undefined) {
        clearInterval(clockInterval)
        clockInterval = undefined
      }
      for (const timer of retryTimers.values()) clearTimeout(timer)
      retryTimers.clear()
      for (const controller of inFlightControllers) controller.abort()
      inFlightControllers.clear()
      pendingIds.clear()
      tracked.clear()
      entries.clear()
      listeners.clear()
      clockListeners.clear()
    },
  }
}

export type RuntimeClient = ReturnType<typeof createRuntimeClient>
