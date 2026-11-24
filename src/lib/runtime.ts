import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'

export const RUNTIME_PATH = '/api/watched-sessions/runtime'
export const MAX_RUNTIME_BATCH_IDS = 100
const OBSERVE_CONCURRENCY = 4

export interface SessionRuntime {
  readonly completedMs: number
  readonly runningSince: number | null
}

export interface RuntimeResponse {
  readonly runtimes: Readonly<Record<string, SessionRuntime>>
}

export interface RuntimeHandlerOptions {
  readonly onError?: (sessionId: SessionId, error: unknown) => void
}

const HEADERS = { 'Cache-Control': 'no-store' }

function isSessionNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND'
}

export function isValidSessionId(value: string): value is SessionId {
  return value.length > 0 && value === value.trim() && !value.includes('\0')
}

export function isSessionRuntime(value: unknown): value is SessionRuntime {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (typeof record.completedMs !== 'number' || !Number.isFinite(record.completedMs) || record.completedMs < 0) {
    return false
  }
  return record.runningSince === null
    || (typeof record.runningSince === 'number' && Number.isFinite(record.runningSince) && record.runningSince >= 0)
}

/**
 * Sum closed turn durations across one chronological session event log and
 * expose the active turn start timestamp only for a live session.
 */
export function foldSessionRuntime(
  events: readonly SessionEvent[],
  options: { readonly live: boolean },
): SessionRuntime {
  let completedMs = 0
  let openTurn: { readonly turn: number; readonly startedAt: number } | null = null

  for (const event of events) {
    if (event.type === 'turn/start') {
      openTurn = { turn: event.data.turn, startedAt: event.time }
    } else if (event.type === 'turn/end') {
      if (openTurn !== null && openTurn.turn === event.data.turn) {
        completedMs += Math.max(0, event.time - openTurn.startedAt)
      }
      openTurn = null
    }
  }

  return {
    completedMs,
    runningSince: options.live && openTurn !== null ? openTurn.startedAt : null,
  }
}

/**
 * Create the Host HTTP handler that computes per-session total runtime
 * across a deduplicated batch of session IDs.
 */
export function createRuntimeHandler(
  sessionQuery: Pick<Context['sessionQuery'], 'observeSession'>,
  lifetime: AbortSignal,
  options?: RuntimeHandlerOptions,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const rawIds = new URL(request.url).searchParams.getAll('id')
    const ids: SessionId[] = []
    const seen = new Set<string>()
    for (const rawId of rawIds) {
      if (!isValidSessionId(rawId)) {
        return Response.json({ error: 'invalid-session-ids' }, { status: 400, headers: HEADERS })
      }
      if (!seen.has(rawId)) {
        seen.add(rawId)
        ids.push(rawId)
      }
    }
    if (ids.length === 0 || ids.length > MAX_RUNTIME_BATCH_IDS) {
      return Response.json({ error: 'invalid-session-ids' }, { status: 400, headers: HEADERS })
    }

    const signal = AbortSignal.any([request.signal, lifetime])
    const runtimes: Record<string, SessionRuntime> = {}
    let cursor = 0

    const worker = async (): Promise<void> => {
      for (;;) {
        signal.throwIfAborted()
        const index = cursor
        if (index >= ids.length) return
        cursor += 1
        const id = ids[index]
        try {
          const observed = await sessionQuery.observeSession(id, { signal, projectionMode: 'none' })
          try {
            signal.throwIfAborted()
            runtimes[id] = foldSessionRuntime(observed.events, { live: observed.source === 'live' })
          } finally {
            observed[Symbol.dispose]()
          }
        } catch (error) {
          if (signal.aborted) throw error
          if (!isSessionNotFoundError(error)) options?.onError?.(id, error)
          // Per-session lookup or corruption errors leave that entry absent without failing siblings.
        }
      }
    }

    try {
      const workerCount = Math.min(OBSERVE_CONCURRENCY, ids.length)
      await Promise.all(Array.from({ length: workerCount }, () => worker()))
      signal.throwIfAborted()
      return Response.json({ runtimes } satisfies RuntimeResponse, { headers: HEADERS })
    } catch {
      if (signal.aborted) return new Response(null, { status: 503, headers: HEADERS })
      return Response.json({ error: 'runtime-unavailable' }, { status: 500, headers: HEADERS })
    }
  }
}
