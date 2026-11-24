import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

let registration
const listeners = new Map()
let saved = null
const storage = {
  getItem: () => saved,
  setItem: (_key: string, value: string) => { saved = value },
}
globalThis.window = {
  localStorage: storage,
  addEventListener: (name, listener) => { listeners.set(name, listener) },
  removeEventListener: (name, listener) => { if (listeners.get(name) === listener) listeners.delete(name) },
  __ModuleLoader__: { load(entry) { registration = entry } },
}
await import('../client.js')
assert.equal(registration.id, '@miorin/dsh-watched-sessions')
const require = createRequire(import.meta.url)
const plugin = registration.factory((name: string) => name === '@deepseek-ai/dsh-client-ui-primitives' ? {} : require(name))
const { canWatch, createWatched, needsAttention } = plugin.__test

const ids = ['alpha', 'beta', 'gamma']
const session = (id, extra = {}) => ({ id, blank: false, origin: 'session', ...extra })

function observable(snapshot) {
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    replace(next) {
      snapshot = next
      for (const listener of listeners) listener()
    },
    listeners,
  }
}

function fixture({ compatible = true, startEmpty = false } = {}) {
  const nativeStore = { spec: { persist: 'dsh.workspace.view.v5' }, create() {} }
  const hooks = Object.fromEntries(
    ['workspaceActionRequest', 'contextMenuTarget', 'directoryFlow', 'hostInfo', 'workspaceShortcuts', 'shortcuts']
      .map(name => [name, observable(null)]),
  )
  const originalFunctions = Object.fromEntries(
    ['settleWorkspaceAction', 'startSession', 'open', 'searchSessions', 'requestSessionRename', 'notifyArchivedNotOpenable',
      'renameWorkspace', 'deleteWorkspace', 'insertWorkspaceBefore', 'unarchiveSession', 'createWorkspace',
      'requestSearch', 'requestAddWorkspace', 'closeAddWorkspace', 'setDirectoryBusy']
      .map(name => [name, () => {}]),
  )
  const native = {
    component: () => {}, locale: 'workspace', options: { priority: 0 },
    children: { 'sidebar.workspaces.directoryFlow': { kind: 'single' } },
    store: nativeStore,
    inject: () => ({ ...originalFunctions, hooks, searchResultLimit: compatible ? 20 : undefined }),
  }
  const effects = []
  const injections = []
  const slotListeners = new Set()
  const menu = new Map()
  const entries = startEmpty ? [] : [native]
  const labels = new Set()
  const workspace = observable({ archivedSessionIds: [] })
  function changed() { for (const listener of slotListeners) listener() }
  const ctx = {
    inject(names, apply) { injections.push({ names, apply }) },
    effect(apply) {
      const dispose = apply()
      effects.push(dispose)
      return dispose
    },
    sessions: { list: observable({ byId: Object.fromEntries(ids.map(id => [id, session(id)])) }) },
    workspaces: { list: workspace },
    locale: {
      bind: () => name => name,
      register(name, dictionaries) {
        assert.equal(Object.keys(dictionaries).length, 8)
        labels.add(name)
        return () => { labels.delete(name) }
      },
    },
    slots: {
      entries: () => entries,
      entriesOfSlot: () => entries.toSorted((a, b) => a.options.priority - b.options.priority).slice(0, 1),
      subscribe(_name, listener) {
        slotListeners.add(listener)
        return () => { slotListeners.delete(listener) }
      },
      inject(_name, apply) { effects.push(apply()) },
      register(options, component) {
        const mounted = { options, component, ...options }
        entries.push(mounted)
        return () => { entries.splice(entries.indexOf(mounted), 1) }
      },
    },
    contextMenus: {
      register(item) {
        menu.set(item.id, item)
        return () => { menu.delete(item.id) }
      },
    },
  }
  return {
    ctx, native, entries, menu, labels, workspace, slotListeners, changed, injections,
    stop() { for (const dispose of effects.reverse()) dispose() },
  }
}

test('restores stored sessions, preserves visible order, and persists removals', () => {
  saved = '["beta",null,"alpha","beta",42,""]'
  const watched = createWatched(storage)
  const changes = []
  const stop = watched.subscribe(() => changes.push([...watched.getSnapshot().ids]))
  assert.deepEqual(watched.getSnapshot().ids, ['beta', 'alpha'])
  watched.place('gamma', { id: 'alpha', half: 'before' })
  watched.place('alpha', { id: 'beta', half: 'before' })
  watched.place('alpha', { id: 'alpha', half: 'after' })
  watched.removeArchived(['beta'])
  stop()
  assert.deepEqual(changes, [['beta', 'gamma', 'alpha'], ['alpha', 'beta', 'gamma'], ['alpha', 'gamma']])
  assert.deepEqual(createWatched(storage).getSnapshot().ids, ['alpha', 'gamma'])
})

test('menu reordering skips unavailable sessions and keeps focus notices out of storage', () => {
  saved = '["alpha","unavailable","beta"]'
  const watched = createWatched(storage)
  const visible = id => id !== 'unavailable'
  watched.moveBy('beta', -1, visible)
  assert.deepEqual(watched.getSnapshot().ids, ['beta', 'alpha', 'unavailable'])
  const first = watched.getSnapshot()
  watched.moveBy('beta', -1, visible)
  assert.equal(watched.getSnapshot(), first)
  watched.unwatch('beta', 'Beta')
  assert.deepEqual(watched.getSnapshot().menuMove, { id: 'beta', title: 'Beta', to: 'list' })
  assert.equal(saved, '["alpha","unavailable"]')
  watched.watch('gamma', 'Gamma')
  assert.deepEqual(watched.getSnapshot().menuMove, { id: 'gamma', title: 'Gamma', to: 'top' })
  assert.equal(createWatched(storage).getSnapshot().menuMove, undefined)
})

test('ignores missing, blank, subagent, and archived sessions when offering to watch', () => {
  const byId = {
    alpha: session('alpha'),
    blank: session('blank', { blank: true }),
    child: session('child', { origin: 'subagent' }),
    archived: session('archived'),
  }
  const list = { byId }
  assert.equal(canWatch(list, ['archived'], 'alpha'), true)
  for (const id of ['missing', 'blank', 'child', 'archived']) {
    assert.equal(canWatch(list, ['archived'], id), false, id)
  }
})

test('waits for the native browser and shares its view store and menu actions', () => {
  saved = null
  const f = fixture({ startEmpty: true })
  plugin.apply(f.ctx)
  try {
    assert.equal(f.entries.length, 0)
    f.entries.push(f.native)
    f.changed()
    const replacement = f.ctx.slots.entriesOfSlot()[0]
    assert.notEqual(replacement, f.native)
    assert.equal(replacement.store, f.native.store)
    assert.deepEqual(replacement.inject().hooks.shortcuts, f.native.inject().hooks.shortcuts)
    f.changed()
    assert.equal(f.entries.length, 2)
    const action = f.menu.get('dsh-watched-sessions.toggle')
    assert.deepEqual(action.resolve({ sessionId: 'missing' }), [])
    const alpha = { sessionId: 'alpha', displayTitle: 'Alpha' }
    const beta = { sessionId: 'beta', displayTitle: 'Beta' }
    assert.equal(action.resolve(alpha)[0].label, 'watch')
    action.resolve(alpha)[0].run()
    assert.equal(saved, '["alpha"]')
    assert.deepEqual(action.resolve(alpha).map(item => item.label), ['unwatch'])
    action.resolve(beta)[0].run()
    assert.deepEqual(action.resolve(alpha).map(item => item.label), ['unwatch', 'moveDown'])
    assert.deepEqual(action.resolve(beta).map(item => item.label), ['unwatch', 'moveUp'])
    action.resolve(alpha)[1].run()
    assert.equal(saved, '["beta","alpha"]')
    action.resolve(alpha)[0].run()
    assert.equal(saved, '["beta"]')
    f.workspace.replace({ archivedSessionIds: ['beta'] })
    assert.equal(saved, '[]')
    assert.deepEqual(action.resolve({ sessionId: 'beta' }), [])
  } finally {
    f.stop()
  }
  assert.deepEqual(f.entries, [f.native])
  assert.equal(f.menu.size + f.labels.size + f.slotListeners.size + f.workspace.listeners.size + listeners.size, 0)
})

test('keeps the native view active when its binding is incompatible', () => {
  const f = fixture({ compatible: false })
  plugin.apply(f.ctx)
  try {
    assert.deepEqual(f.entries, [f.native])
    assert.equal(f.menu.size, 0)
  } finally {
    f.stop()
  }
})

test('cycles the header view, reopens it for new sessions, and keeps it out of storage', () => {
  saved = '["alpha","beta"]'
  const watched = createWatched(storage)
  const views = []
  watched.subscribe(() => views.push(watched.getSnapshot().view))
  assert.equal(watched.getSnapshot().view, 'all')
  watched.cycleView()
  watched.cycleView()
  assert.equal(watched.getSnapshot().view, 'attention')
  // Reordering, removing, and re-adding a present session keep the partial view.
  watched.place('beta', { id: 'alpha', half: 'before' })
  watched.watch('beta', 'Beta')
  watched.unwatch('alpha', 'Alpha')
  assert.equal(watched.getSnapshot().view, 'attention')
  watched.cycleView()
  watched.cycleView()
  assert.equal(watched.getSnapshot().view, 'collapsed')
  // A newly added session must not land in a hidden section.
  watched.place('gamma')
  assert.equal(watched.getSnapshot().view, 'all')
  watched.cycleView()
  watched.watch('alpha', 'Alpha')
  assert.equal(watched.getSnapshot().view, 'all')
  assert.deepEqual(views, ['collapsed', 'attention', 'attention', 'attention', 'all', 'collapsed', 'all', 'collapsed', 'all'])
  assert.equal(saved, '["beta","gamma","alpha"]')
  assert.equal(createWatched(storage).getSnapshot().view, 'all')
})

test('needs attention matches the session list toggle criterion', () => {
  const list = {
    byId: {
      idle: session('idle'), current: session('current'), pinned: session('pinned'), draft: session('draft'),
      approval: session('approval'), plan: session('plan'), question: session('question'),
      running: session('running', { running: true }), stopped: session('stopped', { running: true }),
      unread: session('unread'), parent: session('parent'), quietParent: session('quietParent'),
      child: session('child', { origin: 'subagent', running: true }), quietChild: session('quietChild', { origin: 'subagent' }),
    },
    projectionsBySession: {
      parent: { values: { subagentCatalog: [{ id: 'child' }] } },
      quietParent: { values: { subagentCatalog: [{ id: 'quietChild' }] } },
    },
  }
  const statuses = new Map([
    ['approval', { pendingInteraction: { kind: 'approval' } }],
    ['plan', { pendingInteraction: { kind: 'plan-review' } }],
    ['question', { pendingInteraction: { kind: 'question' } }],
    ['stopped', { running: false }],
    ['unread', { completionUnread: true }],
    ['idle', { running: false, completionUnread: false }],
  ])
  const context = { list, statuses, pinned: new Set(['pinned']), current: 'current', drafts: new Set(['draft']) }
  for (const id of ['current', 'pinned', 'draft', 'approval', 'plan', 'question', 'running', 'unread', 'parent']) {
    assert.equal(needsAttention(id, context), true, id)
  }
  // The live status outranks the catalog's running flag, and idle children leave the parent quiet.
  for (const id of ['idle', 'stopped', 'quietParent', 'missing']) {
    assert.equal(needsAttention(id, context), false, id)
  }
  assert.equal(needsAttention('draft', { ...context, drafts: undefined }), false)
})

test('passes the optional draft service to the browser and releases it', () => {
  saved = null
  const f = fixture()
  plugin.apply(f.ctx)
  try {
    const drafts = f.ctx.slots.entriesOfSlot()[0].inject().hooks.watchedDrafts
    assert.deepEqual([...drafts.getSnapshot()], [])
    const [{ names, apply }] = f.injections
    assert.deepEqual(names, ['sessionDraftIndicators'])
    let notify
    const disposers = []
    const service = { getSnapshot: () => new Set(['alpha']), subscribe(listener) { notify = listener; return () => { notify = undefined } } }
    apply({ get: () => service, effect(run) { disposers.push(run()) } })
    let changes = 0
    const stop = drafts.subscribe(() => { changes += 1 })
    assert.deepEqual([...drafts.getSnapshot()], ['alpha'])
    notify()
    for (const dispose of disposers) dispose()
    stop()
    assert.equal(changes, 2)
    assert.equal(notify, undefined)
    assert.deepEqual([...drafts.getSnapshot()], [])
    // A provider without the snapshot contract is ignored.
    apply({ get: () => ({ subscribe() {} }), effect() { throw new Error('unexpected effect') } })
    assert.deepEqual([...drafts.getSnapshot()], [])
  } finally {
    f.stop()
  }
})

type ElementNode = { type?: unknown; props?: Record<string, unknown> }

function expandNode(node: unknown, shouldExpand: (type: unknown) => boolean): unknown {
  if (Array.isArray(node)) return node.map(child => expandNode(child, shouldExpand))
  if (node === null || typeof node !== 'object') return node
  const element = node as ElementNode
  if (typeof element.type === 'function' && shouldExpand(element.type)) {
    return expandNode((element.type as (props: Record<string, unknown>) => unknown)(element.props ?? {}), shouldExpand)
  }
  if (element.props?.children === undefined) return element
  return {
    ...element,
    props: { ...element.props, children: expandNode(element.props.children, shouldExpand) },
  }
}

function collectElements(node: unknown, match: (element: ElementNode) => boolean, found: ElementNode[] = []): ElementNode[] {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, match, found)
    return found
  }
  if (node === null || typeof node !== 'object') return found
  const element = node as ElementNode
  if (match(element)) found.push(element)
  collectElements(element.props?.children, match, found)
  return found
}

function findElement(node: unknown, match: (element: ElementNode) => boolean): ElementNode | undefined {
  return collectElements(node, match)[0]
}

test('renders the watched section header aligned with sidebar section headers', () => {
  const TooltipStub = ({ children }: { children?: unknown }) => children
  let nextId = 0
  const react = {
    ...require('react'),
    useId: () => `:watched-${nextId++}:`,
  }
  const areaPlugin = registration.factory((name: string) => {
    if (name === 'react') return react
    if (name === '@deepseek-ai/dsh-client-ui-primitives') {
      return { HoverCardGroup: ({ children }: { children?: unknown }) => children, Tooltip: TooltipStub }
    }
    return require(name)
  })
  const WatchedArea = areaPlugin.__test.WatchedArea
  const drag = {
    source: null, overTop: false, overList: false, marker: undefined,
    hoverTop: () => false, leaveTop: () => {}, dropTop: () => false,
    beginTop: () => {}, endTop: () => {}, beginList: () => {}, endList: () => false,
    hoverList: () => false, leaveList: () => {}, dropList: () => false,
  }
  const shouldExpand = (type: unknown) => type === TooltipStub || (typeof type === 'function' && type.name === 'Fold')
  const renderArea = (view: 'all' | 'collapsed' | 'attention', onCycleView: () => void) => {
    nextId = 0
    return expandNode(WatchedArea({
      rows: [{ id: 'alpha', title: 'Alpha' }, { id: 'beta', title: 'Beta' }],
      view,
      attention: new Set(['alpha']),
      onCycleView,
      drag,
      label: (key: string) => key,
      currentId: 'alpha',
    }), shouldExpand)
  }

  let cycles = 0
  const allTree = renderArea('all', () => { cycles += 1 })
  const header = findElement(allTree, element => element.type === 'header' && element.props?.['data-dsh-watched-sessions-header'] === '')
  assert.ok(header)
  const heading = findElement(header, element => element.type === 'h2')
  assert.ok(heading)
  const button = findElement(heading, element => element.type === 'button')
  assert.ok(button?.props)
  assert.equal(button.props.title, undefined)
  assert.equal(button.props['data-view'], 'all')
  assert.equal(button.props['aria-expanded'], true)
  assert.equal(button.props['aria-label'], 'collapse')
  const controlsId = button.props['aria-controls']
  assert.equal(typeof controlsId, 'string')

  const children = Array.isArray(button.props.children) ? button.props.children : [button.props.children]
  const labelGroup = children[0] as ElementNode
  const arrowGroup = children[1] as ElementNode
  assert.equal(labelGroup.type, 'span')
  assert.equal(arrowGroup.type, 'span')
  assert.equal(arrowGroup.props?.['aria-hidden'], 'true')
  const labelSpans = collectElements(labelGroup, element => element.type === 'span' && element !== labelGroup)
  assert.deepEqual(labelSpans.map(span => span.props?.children), ['section', 2])
  assert.equal(labelSpans[1].props?.['aria-hidden'], 'true')
  assert.ok(findElement(arrowGroup, element => element.type === 'svg'))

  const paneOf = (tree: unknown) => findElement(tree, element => element.type === 'div' && element.props?.id === controlsId)
  assert.equal(paneOf(allTree)?.props?.inert, undefined)
  assert.equal(paneOf(allTree)?.props?.['data-open'], '')

  ;(button.props.onClick as () => void)()
  assert.equal(cycles, 1)

  const collapsedTree = renderArea('collapsed', () => {})
  const collapsedButton = findElement(collapsedTree, element => element.type === 'button' && element.props?.['data-view'] !== undefined)
  assert.equal(collapsedButton?.props?.['data-view'], 'collapsed')
  assert.equal(collapsedButton?.props?.['aria-expanded'], false)
  assert.equal(collapsedButton?.props?.['aria-label'], 'attention')
  assert.equal(paneOf(collapsedTree)?.props?.inert, '')
  assert.equal(paneOf(collapsedTree)?.props?.['data-open'], undefined)

  const attentionTree = renderArea('attention', () => {})
  const attentionButton = findElement(attentionTree, element => element.type === 'button' && element.props?.['data-view'] !== undefined)
  assert.equal(attentionButton?.props?.['data-view'], 'attention')
  assert.equal(attentionButton?.props?.['aria-expanded'], true)
  assert.equal(attentionButton?.props?.['aria-label'], 'expand')
  assert.equal(paneOf(attentionTree)?.props?.inert, undefined)
  assert.equal(paneOf(attentionTree)?.props?.['data-open'], '')

  const bundle = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const match = bundle.match(/const __WATCHED_STYLES__ = ("[^\n]+");/)
  assert.ok(match)
  const styles = JSON.parse(match[1]) as string
  assert.match(styles, /\.watched_header\s*\{[^}]*block-size:\s*36px/)
  assert.match(styles, /\.watched_header h2\s*\{[^}]*margin-inline-start:\s*calc\(var\(--dsh-sidebar-row-padding,\s*12px\)\s*-\s*5px\)/)
  assert.match(styles, /\.watched_heading\s*\{[^}]*padding-inline-start:\s*4px;[^}]*color:\s*var\(--dsw-alias-label-tertiary\)/s)
  assert.match(styles, /\.watched_labelGroup\s*\{[^}]*align-items:\s*baseline;[^}]*gap:\s*6px;/s)
  assert.match(styles, /\.watched_heading:hover,\s*\.watched_heading:hover \.watched_arrow\s*\{\s*color:\s*var\(--dsw-alias-label-secondary\);?\s*\}/)
  assert.match(styles, /\.watched_heading:focus-visible\s*\{\s*outline:\s*var\(--dsw-focus-ring-width,\s*1px\) solid var\(--dsw-focus-ring-color,\s*var\(--dsw-alias-state-business-primary\)\);\s*outline-offset:\s*-2px;?\s*\}/)
  assert.match(styles, /\.watched_arrow path\s*\{[^}]*stroke-opacity:\s*0/)
  assert.match(styles, /\.watched_heading\[data-view=attention\] \.watched_arrow path\s*\{\s*fill-opacity:\s*0;\s*stroke-opacity:\s*1;?\s*\}/)
})
