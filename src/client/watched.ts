import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

export const STORAGE_KEY = 'dsh.watched-sessions.v1'

export type WatchLanding = { id: SessionId; half: 'before' | 'after' }

/** The section header cycles all → collapsed → attention, like the session list toggle. */
export const NEXT_VIEW = { all: 'collapsed', collapsed: 'attention', attention: 'all' } as const

export type WatchedView = keyof typeof NEXT_VIEW

export interface MenuMove {
  id: SessionId
  to: 'top' | 'list'
  title: string
}

interface WatchedSnapshot {
  ids: readonly SessionId[]
  view: WatchedView
  menuMove?: MenuMove
}

export function canWatch(list: SessionListState, archived: readonly SessionId[], id: SessionId): boolean {
  const session = list.byId[id]
  return session?.id === id && !session.blank && session.origin !== 'subagent' && !archived.includes(id)
}

/** The destination is expressed in terms of a visible row, independently of hidden sessions. */
export function moveWatched(
  ids: readonly SessionId[], id: SessionId, landing?: WatchLanding,
): readonly SessionId[] {
  if (landing?.id === id) return ids
  const next = ids.filter(watched => watched !== id)
  const anchor = landing === undefined ? -1 : next.indexOf(landing.id)
  const index = anchor < 0 ? next.length : anchor + (landing?.half === 'after' ? 1 : 0)
  next.splice(index, 0, id)
  return next
}

function sameIds(a: readonly SessionId[], b: readonly SessionId[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

function decodeIds(value: string | null): readonly SessionId[] {
  if (value === null) return []
  try {
    const items: unknown = JSON.parse(value)
    if (Array.isArray(items)) {
      return [...new Set(items.filter((item): item is SessionId => typeof item === 'string' && item.length > 0))]
    }
  } catch {
    // A stale view preference can be replaced by the next change.
  }
  return []
}

/**
 * The ordered IDs persist as a view preference of this client.
 * The header view lasts for the page, so a reload shows every watched session again.
 */
export function createWatched(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined) {
  let snapshot: WatchedSnapshot = { ids: [], view: 'all' }
  const listeners = new Set<() => void>()

  function read(): readonly SessionId[] {
    try {
      return storage === undefined ? snapshot.ids : decodeIds(storage.getItem(STORAGE_KEY))
    } catch {
      return snapshot.ids
    }
  }

  function publish(next: WatchedSnapshot): void {
    if (sameIds(next.ids, snapshot.ids) && next.view === snapshot.view && next.menuMove === snapshot.menuMove) return
    snapshot = next
    for (const listener of listeners) listener()
  }

  /** A newly watched session must stay visible, so adding one reopens the full section. */
  function update(change: (current: readonly SessionId[]) => readonly SessionId[], menuMove?: MenuMove): void {
    const current = read()
    const next = change(current)
    const changed = !sameIds(next, current)
    if (changed) {
      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        storage = undefined
      }
    }
    const added = next.some(id => !current.includes(id))
    publish({
      ids: changed ? next : snapshot.ids,
      view: added ? 'all' : snapshot.view,
      menuMove: changed ? menuMove : snapshot.menuMove,
    })
  }

  snapshot = { ids: read(), view: 'all' }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    sync() { publish({ ...snapshot, ids: read() }) },
    cycleView() { publish({ ...snapshot, view: NEXT_VIEW[snapshot.view] }) },
    watch(id: SessionId, title: string) {
      update(current => current.includes(id) ? current : [...current, id], { id, title, to: 'top' })
    },
    place(id: SessionId, landing?: WatchLanding) { update(current => moveWatched(current, id, landing)) },
    unwatch(id: SessionId, title?: string) {
      update(current => current.filter(watched => watched !== id), title === undefined ? undefined : { id, title, to: 'list' })
    },
    moveBy(id: SessionId, offset: -1 | 1, isVisible: (id: SessionId) => boolean) {
      update(current => {
        const visible = current.filter(isVisible)
        const from = visible.indexOf(id)
        const anchor = from < 0 ? undefined : visible[from + offset]
        return anchor === undefined ? current : moveWatched(current, id, { id: anchor, half: offset < 0 ? 'before' : 'after' })
      })
    },
    removeArchived(ids: readonly SessionId[]) {
      if (ids.some(id => snapshot.ids.includes(id))) update(current => current.filter(id => !ids.includes(id)))
    },
  }
}

export type Watched = ReturnType<typeof createWatched>
