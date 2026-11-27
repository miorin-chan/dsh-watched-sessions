import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  owningGroupKey, UNGROUPED_KEY, type ArchivedFilter, type GroupNode,
} from '@deepseek-ai/dsh-client-ui-workspace/src/client/tree.ts'

export interface OrdinaryListScope {
  readonly excludedIds: ReadonlySet<SessionId>
  readonly archiveFilter: ArchivedFilter
}

/** Exclude watched sessions from the ordinary tree's current-selection highlight and auto-expansion. */
export function ordinaryCurrent(
  main: SessionId | undefined,
  excluded: ReadonlySet<SessionId>,
  panelActive: boolean,
): SessionId | undefined {
  return panelActive || (main !== undefined && excluded.has(main)) ? undefined : main
}

/**
 * Filter watched sessions out of derived workspace groups while keeping the
 * underlying accounts intact for ordering and restoration.
 */
export function excludeWatchedGroups(
  nativeGroups: readonly GroupNode[],
  workspaces: readonly WorkspaceView[],
  excluded: ReadonlySet<SessionId>,
  main: SessionId | undefined,
): GroupNode[] {
  if (excluded.size === 0) return [...nativeGroups]
  const clearCurrent = main !== undefined && excluded.has(main)
  const liftedCounts = new Map<string, number>()
  for (const id of excluded) {
    const key = owningGroupKey(workspaces, id)
    liftedCounts.set(key, (liftedCounts.get(key) ?? 0) + 1)
  }
  return nativeGroups.flatMap((group) => {
    const count = liftedCounts.get(group.key)
    const containsCurrent = clearCurrent ? false : group.containsCurrent
    if (count === undefined) return [containsCurrent === group.containsCurrent ? group : { ...group, containsCurrent }]
    const sessionCount = Math.max(0, group.sessionCount - count)
    if (group.key === UNGROUPED_KEY && sessionCount === 0) return []
    return [{
      ...group,
      containsCurrent,
      sessionCount,
      sessions: group.sessions.filter(row => !excluded.has(row.id)),
    }]
  })
}

/** The active WorkspaceBrowser publishes the same partition it passes to its lists. */
export function createOrdinaryListScope() {
  let snapshot: OrdinaryListScope | undefined
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    publish(next: OrdinaryListScope | undefined) {
      const previous = snapshot
      if (next === previous || (next && previous && next.archiveFilter === previous.archiveFilter
        && next.excludedIds.size === previous.excludedIds.size
        && [...next.excludedIds].every(id => previous.excludedIds.has(id)))) return
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
}

export type OrdinaryListScopeSource = ReturnType<typeof createOrdinaryListScope>
