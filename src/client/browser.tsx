import { useCallback } from 'react'
import type { ContextMenuTarget } from '@deepseek-ai/dsh-client-ui-context-menu/client'
import { IconArchiveOutlineRegular, IconPinFillRegular, IconPinOutlineRegular, IconUnarchiveOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionRowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
// @deepseek-ai/dsh-client-ui-workspace 0.2.2-rc.5, src/client/rows/Rows.module.css: iconButton, pinnedAction.
import css from '@deepseek-ai/dsh-client-ui-workspace/src/client/rows/Rows.module.css'
import { WorkspaceBrowser, type SuperPinBrowserProps } from './upstream/WorkspaceBrowser'
import clsx from 'clsx'

declare const __SUPER_PIN_STYLES__: string

type RowTarget = Extract<ContextMenuTarget, { kind: 'session' }>
export type RunRowAction = (target: RowTarget, iconKey: string) => void

type BrowserProps = Omit<SuperPinBrowserProps, 'renderSlot' | '__renders'> & { runRowAction: RunRowAction }

/** The stock browser's child slot declarations remain with its registration. Reuse its structured actions here. */
export function SuperPinBrowser(props: BrowserProps) {
  const { runRowAction, t, useSessionAccess, useWorkspaces } = props
  const renderRowParts: SuperPinBrowserProps['renderSlot'] = useCallback((name, owner) => {
    if (name !== 'sidebar.workspaces.session.row.action'
      || !('sessionId' in owner) || typeof owner.sessionId !== 'string'
      || !('displayTitle' in owner) || typeof owner.displayTitle !== 'string') return null
    return <SessionActions sessionId={owner.sessionId as SessionRowOwnerProps['sessionId']}
      displayTitle={owner.displayTitle} useWorkspaces={useWorkspaces}
      useSessionAccess={useSessionAccess} t={t} runRowAction={runRowAction} />
  }, [runRowAction, t, useSessionAccess, useWorkspaces])
  return (
    <>
      <style>{__SUPER_PIN_STYLES__}</style>
      <WorkspaceBrowser {...props} renderSlot={renderRowParts} />
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
