import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createRuntimeHandler,
  foldSessionRuntime,
  isSessionRuntime,
  isValidSessionId,
  MAX_RUNTIME_BATCH_IDS,
  RUNTIME_PATH,
} from '../lib/runtime.js'
import * as hostPlugin from '../index.js'

const turnStart = (seq: number, time: number, turn: number) => ({
  type: 'turn/start', seq, time, data: { turn },
})

const turnEnd = (seq: number, time: number, turn: number) => ({
  type: 'turn/end', seq, time, data: { turn, reason: { kind: 'completed' } },
})

test('validates session ids and runtime payloads', () => {
  assert.equal(isValidSessionId('session-1'), true)
  for (const invalid of ['', ' session-1', 'session-1 ', 'bad\0id']) {
    assert.equal(isValidSessionId(invalid), false, JSON.stringify(invalid))
  }

  assert.equal(isSessionRuntime({ completedMs: 0, runningSince: null }), true)
  assert.equal(isSessionRuntime({ completedMs: 1250, runningSince: 5000 }), true)
  for (const bad of [
    null,
    {},
    { completedMs: -1, runningSince: null },
    { completedMs: Number.NaN, runningSince: null },
    { completedMs: 10, runningSince: undefined },
    { completedMs: 10, runningSince: -5 },
    { completedMs: 10, runningSince: Number.POSITIVE_INFINITY },
  ]) {
    assert.equal(isSessionRuntime(bad), false, JSON.stringify(bad))
  }
})

test('folds completed turns, live open turns, cold sessions, and forked seeds accurately', () => {
  assert.deepEqual(foldSessionRuntime([], { live: true }), { completedMs: 0, runningSince: null })

  const multiTurn = [
    turnStart(0, 1_000, 0),
    { type: 'user/message', seq: 1, time: 1_100, data: { content: [] } },
    turnEnd(2, 3_500, 0),
    turnStart(3, 10_000, 1),
    turnEnd(4, 15_200, 1),
  ] as never
  assert.deepEqual(foldSessionRuntime(multiTurn, { live: false }), { completedMs: 7_700, runningSince: null })

  // Clock regression never subtracts runtime.
  const skewed = [turnStart(0, 5_000, 0), turnEnd(1, 4_000, 0)] as never
  assert.deepEqual(foldSessionRuntime(skewed, { live: false }), { completedMs: 0, runningSince: null })

  // Open tail turn ticks only for live sessions; cold sessions never tick up to Date.now().
  const activeTail = [...multiTurn, turnStart(5, 20_000, 2)] as never
  assert.deepEqual(foldSessionRuntime(activeTail, { live: true }), { completedMs: 7_700, runningSince: 20_000 })
  assert.deepEqual(foldSessionRuntime(activeTail, { live: false }), { completedMs: 7_700, runningSince: null })

  // Fork seed marker between turn/start and synthetic closer preserves turn duration.
  const forked = [
    turnStart(0, 2_000, 0),
    { type: 'session/end-seed', seq: 1, time: 4_500, data: { inherited: true } },
    { type: 'turn/end', seq: 2, time: 4_500, data: { turn: 0, reason: { kind: 'forked' } } },
  ] as never
  assert.deepEqual(foldSessionRuntime(forked, { live: true }), { completedMs: 2_500, runningSince: null })
})

test('runtime route validates ids, deduplicates batches, disposes leases, and isolates failures', async () => {
  const lifetime = new AbortController()
  const observedCalls: string[] = []
  let activeLeases = 0

  const handler = createRuntimeHandler({
    async observeSession(sessionId, options) {
      assert.equal(options?.projectionMode, 'none')
      observedCalls.push(sessionId)
      if (sessionId === 'missing') {
        throw Object.assign(new Error('not found'), { code: 'SESSION_QUERY_SESSION_NOT_FOUND' })
      }
      activeLeases += 1
      return {
        source: sessionId === 'live-session' ? 'live' : 'prepared',
        events: [turnStart(0, 1_000, 0), ...(sessionId === 'live-session' ? [] : [turnEnd(1, 4_000, 0)])],
        [Symbol.dispose]() { activeLeases -= 1 },
      } as never
    },
  }, lifetime.signal)

  const badEmpty = await handler(new Request(`http://localhost${RUNTIME_PATH}`))
  assert.equal(badEmpty.status, 400)

  const badBlank = await handler(new Request(`http://localhost${RUNTIME_PATH}?id=%20bad`))
  assert.equal(badBlank.status, 400)

  const tooMany = new URL(`http://localhost${RUNTIME_PATH}`)
  for (let i = 0; i <= MAX_RUNTIME_BATCH_IDS; i += 1) tooMany.searchParams.append('id', `s-${i}`)
  assert.equal((await handler(new Request(tooMany))).status, 400)

  const ok = await handler(new Request(`http://localhost${RUNTIME_PATH}?id=cold&id=live-session&id=missing&id=cold`))
  assert.equal(ok.status, 200)
  assert.equal(ok.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await ok.json(), {
    runtimes: {
      cold: { completedMs: 3_000, runningSince: null },
      'live-session': { completedMs: 0, runningSince: 1_000 },
    },
  })
  assert.deepEqual(observedCalls, ['cold', 'live-session', 'missing'])
  assert.equal(activeLeases, 0)
})

test('host plugin registers authenticated runtime route and aborts on disposal', async () => {
  assert.deepEqual(hostPlugin.inject, ['connection', 'sessionQuery'])
  const routes: Array<{ path: string; methods: readonly string[]; requestBody: string; fetch: (r: Request) => Promise<Response> }> = []
  let unregistered = 0
  let inFlightSignal: AbortSignal | undefined
  let resolveObserve!: () => void
  const observeGate = new Promise<void>(resolve => { resolveObserve = resolve })

  const effects: Array<() => Promise<void> | void> = []
  const ctx = {
    effect(fn: () => () => Promise<void> | void) { effects.push(fn()) },
    connection: {
      fetch: {
        register(route: typeof routes[number]) {
          routes.push(route)
          return async () => {
            routes.splice(routes.indexOf(route), 1)
            unregistered += 1
          }
        },
      },
    },
    sessionQuery: {
      async observeSession(_id: string, options?: { signal?: AbortSignal }) {
        inFlightSignal = options?.signal
        await observeGate
        throw Object.assign(new Error('aborted'), { code: 'SESSION_QUERY_ABORTED' })
      },
    },
  }

  hostPlugin.apply(ctx as never)
  assert.equal(routes.length, 1)
  assert.equal(routes[0].path, RUNTIME_PATH)
  assert.deepEqual(routes[0].methods, ['GET'])
  assert.equal(routes[0].requestBody, 'buffered')

  const pendingResponse = routes[0].fetch(new Request(`http://localhost${RUNTIME_PATH}?id=s1`))
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(inFlightSignal?.aborted, false)

  for (const dispose of effects) await dispose()
  assert.equal(inFlightSignal?.aborted, true)
  assert.equal(unregistered, 1)
  assert.equal(routes.length, 0)
  resolveObserve()
  const abortedResponse = await pendingResponse
  assert.equal(abortedResponse.status, 503)
})
