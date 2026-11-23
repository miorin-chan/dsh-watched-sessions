import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

export interface AttentionContext {
  list: SessionListState
  statuses: SessionStatusSnapshot
  pinned: ReadonlySet<SessionId>
  current?: SessionId | undefined
  drafts?: ReadonlySet<string>
}

/**
 * The "Needs attention" view applies the session list toggle's criterion, so both lists agree.
 * Adapted from @miorin/dsh-workspace-list-toggle b557d14, src/client/attention.ts: sessionVisibility.
 */
export function needsAttention(id: SessionId, { list, statuses, pinned, current, drafts }: AttentionContext): boolean {
  const session = list.byId[id]
  if (session === undefined) return false
  const status = statuses.get(id)
  const pending = status?.pendingInteraction?.kind
  return id === current || pinned.has(id) || (drafts?.has(id) ?? false)
    || pending === 'approval' || pending === 'plan-review' || pending === 'question'
    || (status?.running ?? session.running) || (status?.completionUnread ?? false)
    || (list.projectionsBySession[id]?.values.subagentCatalog?.some(
      child => statuses.get(child.id)?.running ?? list.byId[child.id]?.running ?? false,
    ) ?? false)
}
