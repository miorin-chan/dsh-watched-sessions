import type { ComponentProps, DragEvent, ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import clsx from 'clsx'
import { HoverCardGroup } from '@deepseek-ai/dsh-client-ui-primitives'
// @deepseek-ai/dsh-client-ui-workspace 0.2.2-rc.5, src/client/rows/Rows.tsx: SessionNodeItem.
import { SessionNodeItem } from '@deepseek-ai/dsh-client-ui-workspace/src/client/rows/Rows.tsx'
import type { SessionNode } from '@deepseek-ai/dsh-client-ui-workspace/src/client/tree.ts'
// @deepseek-ai/dsh-client-ui-workspace 0.2.2-rc.5, src/client/rows/WorkspaceBrowser.module.css: sectionLabel.
import nativeCss from '@deepseek-ai/dsh-client-ui-workspace/src/client/rows/WorkspaceBrowser.module.css'
import type { WatchDrag } from './drag'
import type { WatchedLabel, WatchedTranslate } from './labels'
import { NEXT_VIEW, type WatchedView } from './watched'
import css from './watched.module.css'

// DSH IconTriangleRightFillRegular artwork (sprite `dsw-icon-triangle-right-fill-regular`), the disclosure
// arrow of native workspace rows. Copied with its button styling from @miorin/dsh-workspace-list-toggle
// b557d14, src/client/index.tsx: TRIANGLE.
const TRIANGLE = 'M5.5 4.5C5.5 4.40714 5.52586 4.31612 5.57467 4.23713C5.62349 4.15815 5.69334 4.09431 5.77639 4.05279C5.85945 4.01126 5.95242 3.99368 6.0449 4.00202C6.13738 4.01036 6.22572 4.04429 6.3 4.1L10.967 7.6C11.0291 7.64657 11.0795 7.70697 11.1142 7.77639C11.1489 7.84582 11.167 7.92238 11.167 8C11.167 8.07762 11.1489 8.15418 11.1142 8.22361C11.0795 8.29303 11.0291 8.35343 10.967 8.4L6.3 11.9C6.22572 11.9557 6.13738 11.9896 6.0449 11.998C5.95242 12.0063 5.85945 11.9887 5.77639 11.9472C5.69334 11.9057 5.62349 11.8419 5.57467 11.7629C5.52586 11.6839 5.5 11.5929 5.5 11.5V4.5Z'

/** The button names the view a click moves to. */
const NEXT_LABEL = { all: 'collapse', collapsed: 'attention', attention: 'expand' } as const satisfies Record<WatchedView, WatchedLabel>

/** Collapsed folds stay mounted so their height can animate; `inert` keeps their rows out of focus and hit tests. */
function Fold({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={clsx(css.fold, className)} data-open={open ? '' : undefined} {...(open ? {} : { inert: '' })}>
      <div className={css.foldInner}>{children}</div>
    </div>
  )
}

function EyeIcon({ off = false }: { off?: boolean }) {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.2" strokeLinejoin="round">
      <path d="M1.75 8C3.1 5.4 5.35 3.9 8 3.9S12.9 5.4 14.25 8C12.9 10.6 10.65 12.1 8 12.1S3.1 10.6 1.75 8Z" />
      <circle cx="8" cy="8" r="2" />
      {off && <path d="M2.75 2.75 13.25 13.25" strokeLinecap="round" />}
    </svg>
  )
}

/** Use the stock session row so status, navigation, focus and menus behave the same in both regions. */
export function WatchedArea({ rows, view, attention, onCycleView, drag, label, currentId, ...rowProps }: Omit<
  ComponentProps<typeof SessionNodeItem>, 'node' | 'drag' | 'now' | 'onReveal' | 'currentId'
> & {
  rows: readonly SessionNode[]
  view: WatchedView
  attention: ReadonlySet<SessionId>
  onCycleView: () => void
  drag: WatchDrag
  label: WatchedTranslate
  currentId: SessionId | undefined
}) {
  const adding = drag.source?.origin === 'list'
  const shown = (id: SessionId) => view !== 'attention' || attention.has(id)
  const quiet = view === 'attention' && rows.every(row => !shown(row.id))
  const next = label(NEXT_LABEL[view])
  const now = Date.now()

  return (
    <section
      aria-label={label('section')}
      className={clsx(css.area, (rows.length > 0 || adding) && css.areaOpen,
        drag.overTop && drag.marker === undefined && !adding && css.over)}
      data-dsh-watched-sessions-area=""
      onDragOver={event => {
        // A row already handled its before/after marker. The header and drop row accept an append.
        if (event.defaultPrevented || !drag.hoverTop()) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      }}
      onDragLeave={event => { if (left(event)) drag.leaveTop() }}
      onDrop={event => {
        if (!event.defaultPrevented && drag.dropTop()) event.preventDefault()
      }}
    >
      <Fold open={rows.length > 0}>
        <div className={css.header} data-dsh-watched-sessions-header="">
          <span className={clsx(nativeCss.sectionLabel, css.label)}>{label('section')}</span>
          <button
            type="button"
            className={css.disclosure}
            data-view={view}
            aria-expanded={view !== 'collapsed'}
            aria-label={next}
            title={next}
            onClick={onCycleView}
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"
              stroke="currentColor" strokeWidth="1" strokeLinejoin="round">
              <path d={TRIANGLE} />
            </svg>
          </button>
          <span className={css.count} aria-hidden="true">{rows.length}</span>
        </div>
        <Fold open={view !== 'collapsed'}>
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
                <Fold key={row.id} open={shown(row.id)}>
                  <SessionNodeItem
                    {...rowProps}
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
                </Fold>
              ))}
            </HoverCardGroup>
          </div>
          <Fold open={quiet && !adding}>
            <div className={css.note}>{label('empty')}</div>
          </Fold>
        </Fold>
      </Fold>
      <Fold open={adding}>
        <div className={clsx(css.dropRow, adding && drag.overTop && drag.marker === undefined && css.over)}
          role={adding ? 'status' : undefined}>
          <span className={css.dropIcon}><EyeIcon /></span>
          <span className={css.dropLabel}>{label('drop')}</span>
        </div>
      </Fold>
    </section>
  )
}

function left(event: DragEvent<HTMLElement>): boolean {
  return !(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
}

/** Both the floating return hint and the ordinary list accept a drag from the top. */
export function returnDropHandlers(drag: WatchDrag) {
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

/** Tint the ordinary list while it accepts a session dragged out of the watched section. */
export function watchedReturnClass(drag: WatchDrag): string | undefined {
  if (drag.source?.origin !== 'top') return undefined
  return clsx(css.returnList, drag.overList && css.returnListOver)
}

/** The hint floats over the top of the list, so starting a drag never shifts the rows under the pointer. */
export function WatchedReturnTarget({ drag, label }: { drag: WatchDrag; label: WatchedTranslate }) {
  if (drag.source?.origin !== 'top') return null
  return (
    <div className={css.returnAnchor}>
      <div role="status" className={clsx(css.returnTarget, drag.overList && css.over)}
        data-dsh-watched-sessions-return="" {...returnDropHandlers(drag)}>
        <span className={css.dropIcon}><EyeIcon off /></span>
        <span className={css.dropLabel}>{label('return')}</span>
      </div>
    </div>
  )
}
