import type { ComponentProps, DragEvent } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import clsx from 'clsx'
import { HoverCardGroup } from '@deepseek-ai/dsh-client-ui-primitives'
// @deepseek-ai/dsh-client-ui-workspace 0.2.2-rc.5, src/client/rows/Rows.tsx: SessionNodeItem.
import { SessionNodeItem } from '@deepseek-ai/dsh-client-ui-workspace/src/client/rows/Rows.tsx'
import type { SessionNode } from '@deepseek-ai/dsh-client-ui-workspace/src/client/tree.ts'
import type { SuperPinDrag } from './drag'
import type { SuperPinTranslate } from './labels'
import css from './super-pin.module.css'

/** Use the stock session row so status, navigation, focus and menus behave the same in both regions. */
export function SuperPinArea({ rows, drag, label, currentId, ...rowProps }: Omit<
  ComponentProps<typeof SessionNodeItem>, 'node' | 'drag' | 'now' | 'onReveal' | 'currentId'
> & {
  rows: readonly SessionNode[]
  drag: SuperPinDrag
  label: SuperPinTranslate
  currentId: SessionId | undefined
}) {
  if (rows.length === 0 && drag.source?.origin !== 'list') return null
  const adding = drag.source?.origin === 'list'
  const now = Date.now()

  return (
    <section
      aria-label={label('section')}
      className={clsx(css.area, drag.overTop && css.over)}
      data-dsh-super-pin-area=""
      onDragOver={event => {
        // A row already handled its before/after marker. The header and empty area accept an append.
        if (event.defaultPrevented || !drag.hoverTop()) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      }}
      onDragLeave={event => { if (left(event)) drag.leaveTop() }}
      onDrop={event => {
        if (!event.defaultPrevented && drag.dropTop()) event.preventDefault()
      }}
    >
      <div className={clsx(css.heading, adding && css.hint)} role={adding ? 'status' : undefined}>
        {label(adding ? 'drop' : 'section')}
      </div>
      {rows.length > 0 && (
        <div
          className={css.rows}
          role="tree"
          aria-label={label('section')}
          onWheelCapture={event => {
            const list = event.currentTarget
            if (list.scrollHeight > list.clientHeight) event.stopPropagation()
          }}
        >
          <HoverCardGroup>
            {rows.map(row => (
              <SessionNodeItem
                {...rowProps}
                key={row.id}
                node={row}
                now={now}
                currentId={currentId}
                drag={{
                  start: () => drag.beginTop(row.id),
                  end: drag.endTop,
                  active: drag.source !== null,
                  marker: drag.marker?.id === row.id && drag.source?.id !== row.id ? drag.marker.half : null,
                  hover: half => { drag.hoverTop({ id: row.id, half }) },
                  drop: half => drag.dropTop({ id: row.id, half }),
                }}
              />
            ))}
          </HoverCardGroup>
        </div>
      )}
    </section>
  )
}

function left(event: DragEvent<HTMLElement>): boolean {
  return !(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
}

/** Both the visible return strip and the ordinary list accept a drag from the top. */
export function returnDropHandlers(drag: SuperPinDrag) {
  return {
    onDragOverCapture(event: DragEvent<HTMLElement>) {
      if (!drag.hoverList()) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
    },
    onDragLeave(event: DragEvent<HTMLElement>) { if (left(event)) drag.leaveList() },
    onDropCapture(event: DragEvent<HTMLElement>) {
      if (!drag.dropList()) return
      event.preventDefault()
      event.stopPropagation()
    },
  }
}

export function SuperPinReturnTarget({ drag, label }: { drag: SuperPinDrag; label: SuperPinTranslate }) {
  if (drag.source?.origin !== 'top') return null
  return (
    <div role="status" className={clsx(css.returnTarget, drag.overList && css.over)}
      data-dsh-super-pin-return="" {...returnDropHandlers(drag)}>
      {label('return')}
    </div>
  )
}
