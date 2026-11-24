import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-session-query'
import { createRuntimeHandler, RUNTIME_PATH } from '../lib/runtime.js'

export const inject = ['connection', 'sessionQuery']

export function apply(ctx: Context): void {
  ctx.effect(() => {
    const lifetime = new AbortController()
    const handle = createRuntimeHandler(ctx.sessionQuery, lifetime.signal)
    // Connection admits exact Fetch routes only for authenticated owner peers.
    const unregister = ctx.connection.fetch.register({
      path: RUNTIME_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: handle,
    })
    return async () => {
      lifetime.abort()
      await unregister()
    }
  }, 'dsh-watched-sessions: authenticated runtime route')
}
