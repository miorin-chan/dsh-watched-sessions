import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

export const STORAGE_KEY = 'dsh.super-pin.v1'

export type PinLanding = { id: SessionId; half: 'before' | 'after' }

export interface MenuMove {
  id: SessionId
  to: 'top' | 'list'
  title: string
}

interface PinSnapshot {
  ids: readonly SessionId[]
  menuMove?: MenuMove
}

export function canSuperPin(list: SessionListState, archived: readonly SessionId[], id: SessionId): boolean {
  const session = list.byId[id]
  return session?.id === id && !session.blank && session.origin !== 'subagent' && !archived.includes(id)
}

/** The destination is expressed in terms of a visible row, independently of hidden pins. */
export function movePin(
  pins: readonly SessionId[], id: SessionId, landing?: PinLanding,
): readonly SessionId[] {
  if (landing?.id === id) return pins
  const next = pins.filter(pin => pin !== id)
  const anchor = landing === undefined ? -1 : next.indexOf(landing.id)
  const index = anchor < 0 ? next.length : anchor + (landing?.half === 'after' ? 1 : 0)
  next.splice(index, 0, id)
  return next
}

function decodePins(value: string | null): readonly SessionId[] {
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

export function createSuperPins(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined) {
  let snapshot: PinSnapshot = { ids: [] }
  const listeners = new Set<() => void>()

  function read(): readonly SessionId[] {
    try {
      return storage === undefined ? snapshot.ids : decodePins(storage.getItem(STORAGE_KEY))
    } catch {
      return snapshot.ids
    }
  }

  function publish(next: readonly SessionId[], menuMove?: MenuMove): void {
    if (next.length === snapshot.ids.length && next.every((id, i) => id === snapshot.ids[i])) return
    snapshot = { ids: next, menuMove }
    for (const listener of listeners) listener()
  }

  function update(change: (current: readonly SessionId[]) => readonly SessionId[], menuMove?: MenuMove): void {
    const current = read()
    const next = change(current)
    const changed = next.length !== current.length || next.some((id, i) => id !== current[i])
    if (changed) {
      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        storage = undefined
      }
    }
    publish(next, changed ? menuMove : undefined)
  }

  snapshot = { ids: read() }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    sync() { publish(read()) },
    pin(id: SessionId, title: string) {
      update(current => current.includes(id) ? current : [...current, id], { id, title, to: 'top' })
    },
    place(id: SessionId, landing?: PinLanding) { update(current => movePin(current, id, landing)) },
    unpin(id: SessionId, title?: string) {
      update(current => current.filter(pin => pin !== id), title === undefined ? undefined : { id, title, to: 'list' })
    },
    moveBy(id: SessionId, offset: -1 | 1, isVisible: (id: SessionId) => boolean) {
      update(current => {
        const visible = current.filter(isVisible)
        const from = visible.indexOf(id)
        const anchor = from < 0 ? undefined : visible[from + offset]
        return anchor === undefined ? current : movePin(current, id, { id: anchor, half: offset < 0 ? 'before' : 'after' })
      })
    },
    removeArchived(ids: readonly SessionId[]) {
      if (ids.some(id => snapshot.ids.includes(id))) update(current => current.filter(id => !ids.includes(id)))
    },
  }
}

export type SuperPins = ReturnType<typeof createSuperPins>
