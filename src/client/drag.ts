import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PinLanding, SuperPins } from './super-pins'

interface DragSource {
  id: SessionId
  origin: 'list' | 'top'
}

/** One native drag joins the two regions. A cross-region drop retires the stock list's marker. */
export function useSuperPinDrag(enabled: boolean, pins: SuperPins, canPin: (id: SessionId) => boolean) {
  const active = useRef<DragSource | null>(null)
  const cancelListDrag = useRef<(() => void) | undefined>(undefined)
  const visitedTop = useRef(false)
  const [source, setSource] = useState<DragSource | null>(null)
  const [overTop, setOverTop] = useState(false)
  const [overList, setOverList] = useState(false)
  const [marker, setMarker] = useState<PinLanding | undefined>(undefined)
  const revealFrame = useRef<number | null>(null)

  const cancelReveal = useCallback(() => {
    if (revealFrame.current === null) return
    cancelAnimationFrame(revealFrame.current)
    revealFrame.current = null
  }, [])
  useEffect(() => cancelReveal, [cancelReveal])

  function reset(): void {
    cancelReveal()
    active.current = null
    cancelListDrag.current = undefined
    visitedTop.current = false
    setSource(null)
    setOverTop(false)
    setOverList(false)
    setMarker(undefined)
  }

  useEffect(() => {
    if (!enabled && active.current !== null) {
      cancelListDrag.current?.()
      reset()
    }
  }, [enabled])

  function begin(id: SessionId, origin: DragSource['origin'], cancel?: () => void): void {
    if (!enabled || !canPin(id)) return
    reset()
    const next = { id, origin }
    active.current = next
    cancelListDrag.current = cancel
    // Blink can cancel dragstart if opening a drop zone moves the source row
    // away from the initial press. Show the zone after its source hit test.
    revealFrame.current = requestAnimationFrame(() => {
      revealFrame.current = null
      setSource(next)
    })
  }

  return {
    source,
    marker,
    overTop,
    overList,
    beginList(id: SessionId, cancel: () => void) { begin(id, 'list', cancel) },
    beginTop(id: SessionId) { begin(id, 'top') },
    endList(id: SessionId): boolean {
      if (active.current?.id !== id || active.current.origin !== 'list') return false
      // A normal row's explicit onDrop still wins after the pointer returns to the list.
      // The stock dragend fallback must never commit its stale marker after visiting the top.
      const allowFallback = !visitedTop.current
      reset()
      return allowFallback
    },
    endTop() { if (active.current?.origin === 'top') reset() },
    hoverTop(landing?: PinLanding): boolean {
      if (active.current === null) return false
      visitedTop.current = true
      setMarker(previous => previous?.id === landing?.id && previous?.half === landing?.half ? previous : landing)
      setOverTop(true)
      setOverList(false)
      return true
    },
    leaveTop() {
      setOverTop(false)
      setMarker(undefined)
    },
    dropTop(landing?: PinLanding): boolean {
      const session = active.current
      if (session === null) return false
      cancelListDrag.current?.()
      reset()
      if (canPin(session.id)) pins.place(session.id, landing)
      return true
    },
    hoverList(): boolean {
      if (active.current?.origin !== 'top') return false
      setOverList(true)
      setOverTop(false)
      setMarker(undefined)
      return true
    },
    leaveList() { setOverList(false) },
    dropList(): boolean {
      const session = active.current
      if (session?.origin !== 'top') return false
      reset()
      pins.unpin(session.id)
      return true
    },
  }
}

export type SuperPinDrag = ReturnType<typeof useSuperPinDrag>
