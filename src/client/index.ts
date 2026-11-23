/**
 * The sidebar's supported single-slot registration lets this bundle host a
 * version-pinned copy of WorkspaceBrowser. Read the published registration
 * snapshot to share the native store and injected actions. The contract is
 * pinned to 0.2.2-rc.5 and the original registration is never modified.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { MenuAction } from '@deepseek-ai/dsh-client-ui-context-menu/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceBrowserInjected } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { createWorkspaceViewStore } from '@deepseek-ai/dsh-client-ui-workspace/src/client/stores.ts'
import { WatchedBrowser, type RunRowAction } from './browser'
import { connectDrafts, type DraftSource } from './drafts'
import { needsAttention } from './attention'
import { LABELS, NS } from './labels'
import { canWatch, createWatched, STORAGE_KEY, type Watched } from './watched'

const BROWSER_SLOT = 'sidebar.workspaces'
const NATIVE_VIEW_PERSIST = 'dsh.workspace.view.v5'
const NATIVE_ACTIONS = [
  'settleWorkspaceAction', 'startSession', 'open', 'searchSessions', 'requestSessionRename', 'notifyArchivedNotOpenable',
  'renameWorkspace', 'deleteWorkspace', 'insertWorkspaceBefore', 'unarchiveSession', 'createWorkspace',
  'requestSearch', 'requestAddWorkspace', 'closeAddWorkspace', 'setDirectoryBusy',
] as const satisfies readonly (keyof WorkspaceBrowserInjected)[]
const NATIVE_HOOKS = [
  'workspaceActionRequest', 'contextMenuTarget', 'directoryFlow', 'hostInfo', 'workspaceShortcuts', 'shortcuts',
] as const satisfies readonly (keyof WorkspaceBrowserInjected['hooks'])[]

type ViewStore = ReturnType<typeof createWorkspaceViewStore>

/** This is the stock WorkspaceBrowser registration contract in the pinned runtime. */
function workspaceBinding(entry: StoredEntry | undefined): { store: ViewStore; injected: WorkspaceBrowserInjected } | undefined {
  if (entry?.locale !== 'workspace' || entry.children?.['sidebar.workspaces.directoryFlow']?.kind !== 'single') return
  const { store } = entry
  if (store === null || typeof store !== 'object' || store.spec?.persist !== NATIVE_VIEW_PERSIST || typeof store.create !== 'function') return
  const injected = entry.inject?.() as Partial<WorkspaceBrowserInjected> | undefined
  if (injected === undefined || typeof injected.searchResultLimit !== 'number'
    || NATIVE_ACTIONS.some(name => typeof injected[name] !== 'function')
    || NATIVE_HOOKS.some(name => {
      const hook = injected.hooks?.[name]
      return typeof hook?.getSnapshot !== 'function' || typeof hook.subscribe !== 'function'
    })) return
  return { store: store as ViewStore, injected: injected as WorkspaceBrowserInjected }
}

function readableStorage(): Storage | undefined {
  try { return window.localStorage } catch { return undefined }
}

function mountBrowser(ctx: Context, watched: Watched, drafts: DraftSource): () => void {
  const labelWatched = ctx.locale.bind(NS)
  let native: StoredEntry | undefined
  let disposeBrowser: (() => void) | undefined
  let warned = false

  const runRowAction: RunRowAction = (target, iconKey) => {
    const menu = ctx.contextMenus.resolve(target)
    try {
      // The stock Session actions resolve synchronously from live membership and access.
      const action = menu.source.getSnapshot().find(item => item.icon?.key === iconKey)
      if (action !== undefined) menu.select(action.id)
    } finally {
      menu.dispose()
    }
  }

  function reconcile(): void {
    const winner = ctx.slots.entriesOfSlot(BROWSER_SLOT)[0]
    if (winner?.component === WatchedBrowser && native !== undefined && ctx.slots.entries(BROWSER_SLOT).includes(native)) return
    disposeBrowser?.()
    disposeBrowser = undefined
    native = undefined
    if (winner === undefined || winner.component === WatchedBrowser) return

    const binding = workspaceBinding(winner)
    if (binding === undefined) {
      if (!warned) console.warn('[dsh-watched-sessions] This sidebar composition does not expose the expected workspace browser.')
      warned = true
      return
    }
    native = winner
    const unmount = ctx.slots.register({
      name: BROWSER_SLOT, priority: (winner.options.priority ?? 0) - 1,
      store: binding.store, locale: 'workspace',
      inject: () => ({
        ...binding.injected, watched, labelWatched, runRowAction,
        hooks: { ...binding.injected.hooks, watched, watchedDrafts: drafts },
      }),
    }, WatchedBrowser)
    const unmenu = ctx.contextMenus.register({
      target: 'session', id: `${NS}.toggle`, order: 110,
      observe: () => [watched, ctx.sessions.list, ctx.workspaces.list, ctx.locale],
      resolve: ({ sessionId, displayTitle }) => {
        const eligible = (id: typeof sessionId) => canWatch(
          ctx.sessions.list.getSnapshot(), ctx.workspaces.list.getSnapshot().archivedSessionIds, id,
        )
        if (!eligible(sessionId)) return []
        const visible = watched.getSnapshot().ids.filter(eligible)
        const index = visible.indexOf(sessionId)
        if (index < 0) return [{
          id: 'watch', label: labelWatched('watch'),
          run: () => { if (eligible(sessionId)) watched.watch(sessionId, displayTitle) },
        }]
        const actions: MenuAction[] = [{
          id: 'unwatch', label: labelWatched('unwatch'), run: () => { watched.unwatch(sessionId, displayTitle) },
        }]
        if (index > 0) actions.push({
          id: 'move-up', label: labelWatched('moveUp'), run: () => { watched.moveBy(sessionId, -1, eligible) },
        })
        if (index < visible.length - 1) actions.push({
          id: 'move-down', label: labelWatched('moveDown'), run: () => { watched.moveBy(sessionId, 1, eligible) },
        })
        return actions
      },
    })
    disposeBrowser = () => { unmenu(); unmount() }
  }

  const stop = ctx.slots.subscribe(BROWSER_SLOT, reconcile)
  reconcile()
  return () => { stop(); disposeBrowser?.() }
}

export const inject = ['locale', 'slots', 'contextMenus', 'workspaces', 'sessions']

export function apply(ctx: Context): void {
  const watched = createWatched(readableStorage())
  const drafts = connectDrafts(ctx)
  ctx.effect(() => ctx.locale.register(NS, LABELS), `${NS}: locale`)
  ctx.effect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY || event.key === null) watched.sync() }
    const removeArchived = () => watched.removeArchived(ctx.workspaces.list.getSnapshot().archivedSessionIds)
    removeArchived()
    const unsubscribe = ctx.workspaces.list.subscribe(removeArchived)
    window.addEventListener('storage', onStorage)
    return () => { window.removeEventListener('storage', onStorage); unsubscribe() }
  }, `${NS}: preferences`)
  ctx.slots.inject(BROWSER_SLOT, () => mountBrowser(ctx, watched, drafts))
}

export const __test = { canWatch, createWatched, needsAttention, workspaceBinding }
