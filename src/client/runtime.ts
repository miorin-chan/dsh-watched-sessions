import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { isSessionRuntime, RUNTIME_PATH, type SessionRuntime } from '../lib/runtime.js'
import type { WatchedTranslate } from './labels.js'

const DEFAULT_BATCH_LIMIT = 1
const DEFAULT_MAX_CONCURRENT = 4
const FLUSH_DELAY_MS = 16
const DEFAULT_FETCH_TIMEOUT_MS = 20_000
const TICK_INTERVAL_MS = 1_000
const STATUS_RACE_RETRY_BASE_MS = 400
const MAX_STATUS_RACE_RETRIES = 4
const DEFAULT_ERROR_RETRY_BASE_MS = 1_000
const MAX_ERROR_RETRIES = 4

type PageTransportFetch = (input: string, init: RequestInit) => Promise<Response>

interface PageTransportGlobal {
  __DSH_TRANSPORT__?: { fetch?: PageTransportFetch }
}

export type SessionRuntimeEntry =
  | { readonly status: 'loading' }
  | ({ readonly status: 'ready' } & SessionRuntime)
  | { readonly status: 'error' }

interface TrackedState {
  count: number
  signature: string
  fetchedSignature?: string
  running: boolean
  statusRetries: number
  errorRetries: number
}

interface InFlightRequest {
  readonly controller: AbortController
  resetAborted: boolean
}

export interface RuntimeClientOptions {
  readonly fetch?: typeof globalThis.fetch
  readonly baseURI?: () => string
  readonly now?: () => number
  readonly batchLimit?: number
  readonly maxConcurrent?: number
  readonly timeoutMs?: number
  readonly errorRetryBaseMs?: number
  readonly onError?: (error: unknown) => void
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

function runtimeUrl(baseURI: string, ids: readonly SessionId[]): string {
  const url = new URL(RUNTIME_PATH.slice(1), baseURI)
  for (const id of ids) url.searchParams.append('id', id)
  return url.href
}

function relativeRuntimePath(ids: readonly SessionId[]): string {
  const params = new URLSearchParams()
  for (const id of ids) params.append('id', id)
  return `${RUNTIME_PATH.slice(1)}?${params.toString()}`
}

function defaultBaseURI(): string {
  if (typeof document !== 'undefined' && typeof document.baseURI === 'string' && document.baseURI !== '') {
    return document.baseURI
  }
  return 'http://localhost/'
}

function retryDelayMs(baseMs: number, attempt: number): number {
  return baseMs * 2 ** Math.max(0, attempt - 1)
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
  const usePageTransport = options.fetch === undefined
  const readBaseURI = options.baseURI ?? defaultBaseURI
  const readNow = options.now ?? (() => Date.now())
  const batchLimit = Math.max(1, Math.floor(options.batchLimit ?? DEFAULT_BATCH_LIMIT))
  const maxConcurrent = Math.max(1, Math.floor(options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT))
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS)
  const errorRetryBaseMs = Math.max(0, options.errorRetryBaseMs ?? DEFAULT_ERROR_RETRY_BASE_MS)

  const warnedErrors = new Set<string>()
  const reportError = options.onError ?? ((error: unknown) => {
    const key = error instanceof Error ? `${error.name}:${error.message}` : String(error)
    if (warnedErrors.has(key)) return
    warnedErrors.add(key)
    console.warn('[dsh-watched-sessions] Failed to read session runtime:', error)
  })

  const entries = new Map<SessionId, SessionRuntimeEntry>()
  const tracked = new Map<SessionId, TrackedState>()
  const pendingIds = new Set<SessionId>()
  const inFlightIds = new Map<SessionId, number>()
  const latestSeq = new Map<SessionId, number>()
  const listeners = new Set<() => void>()
  const clockListeners = new Set<() => void>()
  const retryTimers = new Map<SessionId, ReturnType<typeof setTimeout>>()
  const inFlightControllers = new Set<InFlightRequest>()

  let disposed = false
  let nextSeq = 1
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

  async function requestRuntimes(ids: readonly SessionId[], signal: AbortSignal): Promise<Response> {
    const transportFetch = usePageTransport ? (globalThis as PageTransportGlobal).__DSH_TRANSPORT__?.fetch : undefined
    if (transportFetch !== undefined) {
      return transportFetch(relativeRuntimePath(ids), { method: 'GET', signal, cache: 'no-store' })
    }
    return fetchImpl(runtimeUrl(readBaseURI(), ids), {
      method: 'GET',
      signal,
      credentials: 'same-origin',
      cache: 'no-store',
    })
  }

  async function fetchBatch(ids: readonly SessionId[]): Promise<void> {
    if (disposed || ids.length === 0) return
    const sentSignatures = new Map<SessionId, string>()
    const requestSeqs = new Map<SessionId, number>()
    for (const id of ids) {
      const seq = nextSeq++
      requestSeqs.set(id, seq)
      inFlightIds.set(id, seq)
      latestSeq.set(id, seq)
      const state = tracked.get(id)
      if (state !== undefined) sentSignatures.set(id, state.signature)
    }

    const controller = new AbortController()
    const flight: InFlightRequest = { controller, resetAborted: false }
    inFlightControllers.add(flight)

    let timedOut = false
    const timeoutTimer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    let dirty = false
    try {
      const response = await requestRuntimes(ids, controller.signal)
      if (!response.ok) throw new Error(`Session runtime request failed (${response.status})`)
      const data: unknown = await response.json()
      if (!isRuntimeResponse(data)) throw new Error('Invalid session runtime response')
      if (disposed || flight.resetAborted) return
      warnedErrors.clear()

      for (const [id, seq] of requestSeqs) {
        if (latestSeq.get(id) !== seq) continue
        const raw = Object.hasOwn(data.runtimes, id) ? data.runtimes[id] : undefined
        const current = tracked.get(id)
        const sent = sentSignatures.get(id)
        if (raw !== undefined) {
          if (raw.runningSince !== null) currentNow = Math.max(currentNow, readNow())
          entries.set(id, { status: 'ready', completedMs: raw.completedMs, runningSince: raw.runningSince })
          dirty = true
          if (current === undefined) continue
          current.errorRetries = 0
          if (sent === undefined || current.signature !== sent) {
            current.fetchedSignature = undefined
            pendingIds.add(id)
            continue
          }
          current.fetchedSignature = sent
          const expectsRunning = current.running
          const actualRunning = raw.runningSince !== null
          if (expectsRunning !== actualRunning && current.statusRetries < MAX_STATUS_RACE_RETRIES) {
            current.statusRetries += 1
            scheduleRetry(id, current.statusRetries * STATUS_RACE_RETRY_BASE_MS)
          }
        } else {
          const previous = entries.get(id)
          if (previous === undefined || previous.status === 'loading') {
            entries.set(id, { status: 'error' })
            dirty = true
          }
          if (current === undefined) continue
          if (sent === undefined || current.signature !== sent) {
            current.fetchedSignature = undefined
            pendingIds.add(id)
            continue
          }
          if (current.errorRetries < MAX_ERROR_RETRIES) {
            current.errorRetries += 1
            scheduleRetry(id, retryDelayMs(errorRetryBaseMs, current.errorRetries))
          }
        }
      }
    } catch (error) {
      if (disposed || flight.resetAborted || (!timedOut && controller.signal.aborted)) return
      reportError(error)
      for (const [id, seq] of requestSeqs) {
        if (latestSeq.get(id) !== seq) continue
        const previous = entries.get(id)
        if (previous === undefined || previous.status === 'loading') {
          entries.set(id, { status: 'error' })
          dirty = true
        }
        const current = tracked.get(id)
        if (current === undefined) continue
        const sent = sentSignatures.get(id)
        if (sent !== undefined && current.signature !== sent) {
          current.fetchedSignature = undefined
          pendingIds.add(id)
          continue
        }
        if (current.fetchedSignature !== current.signature && current.errorRetries < MAX_ERROR_RETRIES) {
          current.errorRetries += 1
          scheduleRetry(id, retryDelayMs(errorRetryBaseMs, current.errorRetries))
        }
      }
    } finally {
      clearTimeout(timeoutTimer)
      inFlightControllers.delete(flight)
      for (const [id, seq] of requestSeqs) {
        if (inFlightIds.get(id) === seq) inFlightIds.delete(id)
      }
      if (dirty && !disposed && !flight.resetAborted) notifyEntries()
      if (!disposed && pendingIds.size > 0 && inFlightControllers.size < maxConcurrent) scheduleFlush(0)
    }
  }

  async function flush(): Promise<void> {
    if (disposed || pendingIds.size === 0) return
    while (!disposed && inFlightControllers.size < maxConcurrent) {
      const batch: SessionId[] = []
      for (const id of pendingIds) {
        if (inFlightIds.has(id)) continue
        batch.push(id)
        if (batch.length >= batchLimit) break
      }
      if (batch.length === 0) break
      for (const id of batch) pendingIds.delete(id)
      void fetchBatch(batch)
    }
  }

  return {
    track(id: SessionId, signature: string, running: boolean): () => void {
      if (disposed) return () => {}
      const existing = tracked.get(id)
      const currentEntry = entries.get(id)
      let needsFetch = false
      if (existing === undefined) {
        tracked.set(id, { count: 1, signature, running, statusRetries: 0, errorRetries: 0 })
        needsFetch = true
      } else {
        existing.count += 1
        existing.running = running
        const signatureChanged = existing.signature !== signature
        const strandedLoading = currentEntry?.status === 'loading' && !inFlightIds.has(id) && !pendingIds.has(id)
        const unscheduledError = currentEntry?.status === 'error'
          && existing.fetchedSignature !== signature
          && !inFlightIds.has(id)
          && !pendingIds.has(id)
          && !retryTimers.has(id)
        if (signatureChanged || currentEntry === undefined || strandedLoading || unscheduledError) {
          existing.signature = signature
          existing.statusRetries = 0
          existing.errorRetries = 0
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

    reset(): void {
      if (disposed) return
      if (flushTimer !== undefined) {
        clearTimeout(flushTimer)
        flushTimer = undefined
      }
      for (const timer of retryTimers.values()) clearTimeout(timer)
      retryTimers.clear()
      for (const flight of inFlightControllers) {
        flight.resetAborted = true
        flight.controller.abort()
      }
      inFlightControllers.clear()
      inFlightIds.clear()
      pendingIds.clear()
      warnedErrors.clear()

      let dirty = false
      for (const [id, state] of tracked) {
        state.fetchedSignature = undefined
        state.statusRetries = 0
        state.errorRetries = 0
        const current = entries.get(id)
        if (current === undefined || current.status === 'error') {
          entries.set(id, { status: 'loading' })
          dirty = true
        }
        pendingIds.add(id)
      }
      if (dirty) notifyEntries()
      if (pendingIds.size > 0) scheduleFlush(0)
    },

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
      for (const flight of inFlightControllers) flight.controller.abort()
      inFlightControllers.clear()
      inFlightIds.clear()
      latestSeq.clear()
      pendingIds.clear()
      tracked.clear()
      entries.clear()
      warnedErrors.clear()
      listeners.clear()
      clockListeners.clear()
    },
  }
}

export type RuntimeClient = ReturnType<typeof createRuntimeClient>
