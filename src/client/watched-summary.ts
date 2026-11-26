import type { Context } from '@deepseek-ai/cordis'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WatchMode } from './watch-mode'
import { visibleWatchedIds, type Watched } from './watched'

interface WatchedSummary {
  readonly ids: readonly SessionId[]
  readonly watchMode: boolean
}

/** Read-only cross-plugin state, independent of the sidebar's current view. */
export function createWatchedSummary(
  watched: Watched, mode: WatchMode,
  sessions: Context['sessions']['list'], workspaces: Context['workspaces']['list'],
): HostObservable<WatchedSummary> {
  let snapshot: WatchedSummary = { ids: [], watchMode: false }
  let lastSaved: readonly SessionId[] | undefined
  let lastList: ReturnType<typeof sessions.getSnapshot> | undefined
  let lastArchived: readonly SessionId[] | undefined
  return {
    getSnapshot() {
      const { ids: saved } = watched.getSnapshot()
      const list = sessions.getSnapshot()
      const archived = workspaces.getSnapshot().archivedSessionIds
      const watchMode = mode.getSnapshot()
      let ids = snapshot.ids
      if (saved !== lastSaved || list !== lastList || archived !== lastArchived) {
        lastSaved = saved
        lastList = list
        lastArchived = archived
        const visible = visibleWatchedIds(list, archived, saved)
        if (visible.length !== ids.length || visible.some((id, i) => id !== ids[i])) ids = visible
      }
      if (ids !== snapshot.ids || watchMode !== snapshot.watchMode) snapshot = { ids, watchMode }
      return snapshot
    },
    subscribe(listener) {
      const stops = [watched, mode, sessions, workspaces].map(source => source.subscribe(listener))
      return () => { for (const stop of stops) stop() }
    },
  }
}
