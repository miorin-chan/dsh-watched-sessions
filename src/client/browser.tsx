import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { ContextMenuTarget } from '@deepseek-ai/dsh-client-ui-context-menu/client'
import { IconArchiveOutlineRegular, IconPinFillRegular, IconPinOutlineRegular, IconUnarchiveOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionRowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
// @deepseek-ai/dsh-client-ui-workspace 0.2.2-rc.5, src/client/rows/Rows.module.css: iconButton, pinnedAction, time, hoverTime.
import css from '@deepseek-ai/dsh-client-ui-workspace/src/client/rows/Rows.module.css'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import clsx from 'clsx'
import type { WatchedTranslate } from './labels'
import { formatDuration, runtimeElapsedMs, type RuntimeClient, type SessionRuntimeEntry } from './runtime'
import { WorkspaceBrowser, type WatchedBrowserProps } from './upstream/WorkspaceBrowser'
import watchedCss from './watched.module.css'

declare const __WATCHED_STYLES__: string

type RowTarget = Extract<ContextMenuTarget, { kind: 'session' }>
export type RunRowAction = (target: RowTarget, iconKey: string) => void

type BrowserProps = Omit<WatchedBrowserProps, 'renderSlot' | 'renderWatchedSlot' | '__renders'> & {
  runRowAction: RunRowAction
  runtime: RuntimeClient
}

type SessionRuntimeHookProps = {
  sessionId: SessionId
  runtime: RuntimeClient
  useSessions: BrowserProps['useSessions']
  useSessionStatus: BrowserProps['useSessionStatus']
  labelWatched: WatchedTranslate
}

function useSessionRuntime({
  sessionId, runtime, useSessions, useSessionStatus,
}: Omit<SessionRuntimeHookProps, 'labelWatched'>): { entry: SessionRuntimeEntry | undefined; now: number } {
  const summary = useSessions(state => state.byId[sessionId])
  const liveStatus = useSessionStatus(statuses => statuses.get(sessionId))
  const updatedAt = summary?.updatedAt ?? 0
  const running = liveStatus?.running ?? summary?.running ?? false
  const unread = liveStatus?.completionUnread ?? false
  const blank = summary?.blank ?? false
  const signature = `${updatedAt}:${running ? 1 : 0}:${unread ? 1 : 0}`

  useEffect(() => {
    if (blank) return
    return runtime.track(sessionId, signature, running)
  }, [blank, running, runtime, sessionId, signature])

  const entry = useSyncExternalStore(runtime.subscribe, () => runtime.getEntry(sessionId))
  const live = entry?.status === 'ready' && entry.runningSince !== null
  const subscribeClock = useCallback(
    (listener: () => void) => (live ? runtime.subscribeClock(listener) : () => {}),
    [live, runtime],
  )
  const now = useSyncExternalStore(subscribeClock, runtime.getNow)
  return { entry, now }
}

function SessionRuntimeBadge(props: SessionRuntimeHookProps) {
  const { entry, now } = useSessionRuntime(props)
  const text = entry?.status === 'ready'
    ? formatDuration(runtimeElapsedMs(entry, now), props.labelWatched)
    : entry?.status === 'error'
      ? '—'
      : '…'
  return (
    <span className={clsx(css.time, watchedCss.runtimeTime)} data-dsh-watch-runtime="">
      {text}
    </span>
  )
}

function SessionHoverRuntime(props: SessionRuntimeHookProps) {
  const { entry, now } = useSessionRuntime(props)
  if (entry?.status !== 'ready') return null
  const duration = formatDuration(runtimeElapsedMs(entry, now), props.labelWatched)
  return (
    <div className={clsx(css.hoverTime, watchedCss.hoverRuntime)} data-dsh-watch-hover-runtime="">
      {props.labelWatched('totalRuntime', { duration })}
    </div>
  )
}

/** The stock browser's child slot declarations remain with its registration. Reuse its structured actions here. */
export function WatchedBrowser(props: BrowserProps) {
  const { runtime, ...browserProps } = props
  const { runRowAction, t, labelWatched, useSessionAccess, useSessionStatus, useSessions, useWorkspaces, useWatchMode } = browserProps
  const watchModeEnabled = useWatchMode(enabled => enabled)
  const renderRowParts: WatchedBrowserProps['renderSlot'] = useCallback((name, owner) => {
    if (name !== 'sidebar.workspaces.session.row.action') return null
    if (!('sessionId' in owner) || typeof owner.sessionId !== 'string'
      || !('displayTitle' in owner) || typeof owner.displayTitle !== 'string') return null
    return <SessionActions sessionId={owner.sessionId as SessionRowOwnerProps['sessionId']}
      displayTitle={owner.displayTitle} useWorkspaces={useWorkspaces}
      useSessionAccess={useSessionAccess} t={t} runRowAction={runRowAction} />
  }, [runRowAction, t, useSessionAccess, useWorkspaces])
  const renderWatchedRowParts: WatchedBrowserProps['renderSlot'] = useCallback((name, owner) => {
    if (name === 'sidebar.workspaces.session.row.action') return renderRowParts(name, owner)
    if (!watchModeEnabled || !('sessionId' in owner) || typeof owner.sessionId !== 'string') return null
    const sessionId = owner.sessionId as SessionId
    if (name === 'sidebar.session.row.trailing') {
      return <SessionRuntimeBadge sessionId={sessionId} runtime={runtime}
        useSessions={useSessions} useSessionStatus={useSessionStatus} labelWatched={labelWatched} />
    }
    if (name === 'sidebar.session.row.hover') {
      return <SessionHoverRuntime sessionId={sessionId} runtime={runtime}
        useSessions={useSessions} useSessionStatus={useSessionStatus} labelWatched={labelWatched} />
    }
    return null
  }, [labelWatched, renderRowParts, runtime, useSessionStatus, useSessions, watchModeEnabled])
  return (
    <>
      <style>{__WATCHED_STYLES__}</style>
      <WorkspaceBrowser {...browserProps} renderSlot={renderRowParts} renderWatchedSlot={renderWatchedRowParts} />
    </>
  )
}

function SessionActions({ sessionId, displayTitle, useWorkspaces, useSessionAccess, t, runRowAction }: SessionRowOwnerProps & Pick<
  BrowserProps, 'useWorkspaces' | 'useSessionAccess' | 't' | 'runRowAction'
>) {
  const pinned = useWorkspaces(snapshot => snapshot.pinnedSessionIds.includes(sessionId))
  const archived = useWorkspaces(snapshot => snapshot.archivedSessionIds.includes(sessionId))
  const mayPin = useSessionAccess(sessionId, pinned ? 'workspace/unpinSession' : 'workspace/pinSession')
  const mayArchive = useSessionAccess(sessionId, archived ? 'workspace/unarchiveSession' : 'workspace/archiveSession')
  const target: RowTarget = { kind: 'session', value: { sessionId, displayTitle } }
  const Pin = pinned ? IconPinFillRegular : IconPinOutlineRegular
  const Archive = archived ? IconUnarchiveOutlineRegular : IconArchiveOutlineRegular
  return (
    <>
      {mayArchive && (
        <Tooltip label={t(archived ? 'actions.unarchive' : 'actions.archive')} side="bottom" align="end" delayMs={500} portal>
          <button type="button" className={css.iconButton}
            aria-label={t(archived ? 'menu.unarchiveSession' : 'menu.archiveSession')}
            onClick={() => { runRowAction(target, archived ? 'workspace.unarchive' : 'workspace.archive') }}>
            <Archive size={14} />
          </button>
        </Tooltip>
      )}
      {mayPin && !archived && (
        <Tooltip label={t(pinned ? 'actions.unpin' : 'actions.pin')} side="bottom" align="end" delayMs={500} portal>
          <button type="button" className={clsx(css.iconButton, pinned && css.pinnedAction)}
            aria-label={t(pinned ? 'menu.unpinSession' : 'menu.pinSession')}
            onClick={() => { runRowAction(target, pinned ? 'workspace.unpin' : 'workspace.pin') }}>
            <Pin size={14} />
          </button>
        </Tooltip>
      )}
    </>
  )
}
