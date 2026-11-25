import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

let registration
const listeners = new Map()
const storeData = new Map<string, string>()
const WATCHED_KEY = 'dsh.watched-sessions.v1'
const storage = {
  getItem: (key: string) => storeData.get(key) ?? null,
  setItem: (key: string, value: string) => { storeData.set(key, value) },
}
const saved = () => storeData.get(WATCHED_KEY) ?? null
const setSaved = (value: string | null) => {
  if (value === null) storeData.delete(WATCHED_KEY)
  else storeData.set(WATCHED_KEY, value)
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
const {
  AggregatedWatchModeSettings,
  buildWatchModeCss,
  canWatch,
  createRuntimeClient,
  createWatchMode,
  createWatched,
  formatDuration,
  needsAttention,
  WATCH_MODE_STORAGE_KEY,
  WatchedArea,
  WatchedBrowser,
  WatchedReturnTarget,
  WatchModeOverlay,
  WatchModeSettings,
} = plugin.__test

const ids = ['alpha', 'beta', 'gamma']
const session = (id, extra = {}) => ({ id, blank: false, origin: 'session', ...extra })

function observable(snapshot) {
  const subscribers = new Set()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      subscribers.add(listener)
      return () => { subscribers.delete(listener) }
    },
    replace(next) {
      snapshot = next
      for (const listener of subscribers) listener()
    },
    listeners: subscribers,
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
    name: 'sidebar.workspaces',
    component: () => {}, locale: 'workspace', options: { name: 'sidebar.workspaces', priority: 0 },
    children: { 'sidebar.workspaces.directoryFlow': { kind: 'single' } },
    store: nativeStore,
    inject: () => ({ ...originalFunctions, hooks, searchResultLimit: compatible ? 20 : undefined }),
  }
  const effects = []
  const injections = []
  const slotListeners = new Map<string, Set<() => void>>()
  const eventListeners = new Map<string, Set<() => void>>()
  const menu = new Map()
  const entries = startEmpty ? [] : [native]
  const labels = new Set()
  const workspace = observable({ archivedSessionIds: [] })
  function changed(slotName = 'sidebar.workspaces') {
    for (const listener of slotListeners.get(slotName) ?? []) listener()
  }
  function emit(eventName: string) {
    for (const listener of eventListeners.get(eventName) ?? []) listener()
  }
  const bySlot = (slotName = 'sidebar.workspaces') => entries.filter(entry => (entry.options?.name ?? entry.name) === slotName)
  const ctx = {
    inject(names, apply) { injections.push({ names, apply }) },
    on(eventName: string, listener: () => void) {
      let group = eventListeners.get(eventName)
      if (!group) {
        group = new Set()
        eventListeners.set(eventName, group)
      }
      group.add(listener)
      return () => {
        group.delete(listener)
        if (group.size === 0) eventListeners.delete(eventName)
      }
    },
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
        const baseKeys = Object.keys(dictionaries.en).sort()
        for (const [locale, dict] of Object.entries(dictionaries)) {
          assert.deepEqual(Object.keys(dict).sort(), baseKeys, `locale ${locale} keys`)
        }
        labels.add(name)
        return () => { labels.delete(name) }
      },
    },
    slots: {
      entries: (slotName = 'sidebar.workspaces') => bySlot(slotName),
      entriesOfSlot: (slotName = 'sidebar.workspaces') =>
        bySlot(slotName).toSorted((a, b) => (a.options?.priority ?? 0) - (b.options?.priority ?? 0)).slice(0, 1),
      subscribe(slotName, listener) {
        let group = slotListeners.get(slotName)
        if (!group) {
          group = new Set()
          slotListeners.set(slotName, group)
        }
        group.add(listener)
        return () => {
          group.delete(listener)
          if (group.size === 0) slotListeners.delete(slotName)
        }
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
    ctx, native, entries, bySlot, menu, labels, workspace, slotListeners, eventListeners, changed, emit, injections,
    stop() { for (const dispose of effects.reverse()) dispose() },
  }
}

test('restores stored sessions, preserves visible order, and persists removals', () => {
  storeData.clear()
  setSaved('["beta",null,"alpha","beta",42,""]')
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
  storeData.clear()
  setSaved('["alpha","unavailable","beta"]')
  const watched = createWatched(storage)
  const visible = id => id !== 'unavailable'
  watched.moveBy('beta', -1, visible)
  assert.deepEqual(watched.getSnapshot().ids, ['beta', 'alpha', 'unavailable'])
  const first = watched.getSnapshot()
  watched.moveBy('beta', -1, visible)
  assert.equal(watched.getSnapshot(), first)
  watched.unwatch('beta', 'Beta')
  assert.deepEqual(watched.getSnapshot().menuMove, { id: 'beta', title: 'Beta', to: 'list' })
  assert.equal(saved(), '["alpha","unavailable"]')
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
  storeData.clear()
  const f = fixture({ startEmpty: true })
  plugin.apply(f.ctx)
  try {
    assert.equal(f.bySlot('sidebar.workspaces').length, 0)
    assert.equal(f.bySlot('plugins.bundle.config').length, 1)
    assert.equal(f.bySlot('plugins.bundle.config')[0].options.key, '@miorin/dsh-watched-sessions')
    assert.equal(f.bySlot('plugins.detail.section').length, 1)
    assert.equal(f.bySlot('plugins.detail.section')[0].options.id, 'dsh-watched-sessions')
    assert.equal(f.bySlot('plugins.detail.section')[0].options.locale, 'dsh-watched-sessions')
    assert.equal(f.bySlot('shell.overlay').length, 1)
    assert.equal(f.eventListeners.get('connection/reset')?.size, 1)
    f.entries.push(f.native)
    f.changed()
    const replacement = f.ctx.slots.entriesOfSlot()[0]
    assert.notEqual(replacement, f.native)
    assert.equal(replacement.store, f.native.store)
    assert.deepEqual(replacement.inject().hooks.shortcuts, f.native.inject().hooks.shortcuts)
    assert.equal(replacement.inject().hooks.watchMode.getSnapshot(), false)
    f.changed()
    assert.equal(f.bySlot('sidebar.workspaces').length, 2)
    const action = f.menu.get('dsh-watched-sessions.toggle')
    assert.deepEqual(action.resolve({ sessionId: 'missing' }), [])
    const alpha = { sessionId: 'alpha', displayTitle: 'Alpha' }
    const beta = { sessionId: 'beta', displayTitle: 'Beta' }
    assert.equal(action.resolve(alpha)[0].label, 'watch')
    action.resolve(alpha)[0].run()
    assert.equal(saved(), '["alpha"]')
    assert.deepEqual(action.resolve(alpha).map(item => item.label), ['unwatch'])

    // Storage event turning on watch mode swaps context-menu action labels immediately.
    storeData.set(WATCH_MODE_STORAGE_KEY, 'true')
    listeners.get('storage')({ key: WATCH_MODE_STORAGE_KEY })
    assert.equal(replacement.inject().hooks.watchMode.getSnapshot(), true)
    assert.equal(action.resolve(alpha)[0].label, 'watchUnwatch')
    assert.equal(action.resolve(beta)[0].label, 'watchWatch')
    storeData.set(WATCH_MODE_STORAGE_KEY, 'false')
    listeners.get('storage')({ key: WATCH_MODE_STORAGE_KEY })

    action.resolve(beta)[0].run()
    assert.deepEqual(action.resolve(alpha).map(item => item.label), ['unwatch', 'moveDown'])
    assert.deepEqual(action.resolve(beta).map(item => item.label), ['unwatch', 'moveUp'])
    action.resolve(alpha)[1].run()
    assert.equal(saved(), '["beta","alpha"]')
    action.resolve(alpha)[0].run()
    assert.equal(saved(), '["beta"]')
    f.workspace.replace({ archivedSessionIds: ['beta'] })
    assert.equal(saved(), '[]')
    assert.deepEqual(action.resolve({ sessionId: 'beta' }), [])
  } finally {
    f.stop()
  }
  assert.deepEqual(f.entries, [f.native])
  assert.equal(f.menu.size + f.labels.size + f.slotListeners.size + f.eventListeners.size + f.workspace.listeners.size + listeners.size, 0)
})

test('keeps the native view active when its binding is incompatible', () => {
  storeData.clear()
  const f = fixture({ compatible: false })
  plugin.apply(f.ctx)
  try {
    assert.deepEqual(f.bySlot('sidebar.workspaces'), [f.native])
    assert.equal(f.menu.size, 0)
  } finally {
    f.stop()
  }
})

test('cycles the header view, reopens it for new sessions, and keeps it out of storage', () => {
  storeData.clear()
  setSaved('["alpha","beta"]')
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
  assert.equal(saved(), '["beta","gamma","alpha"]')
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
  storeData.clear()
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
  const Area = areaPlugin.__test.WatchedArea
  const drag = {
    source: null, overTop: false, overList: false, marker: undefined,
    hoverTop: () => false, leaveTop: () => {}, dropTop: () => false,
    beginTop: () => {}, endTop: () => {}, beginList: () => {}, endList: () => false,
    hoverList: () => false, leaveList: () => {}, dropList: () => false,
  }
  const shouldExpand = (type: unknown) => type === TooltipStub || (typeof type === 'function' && type.name === 'Fold')
  const renderArea = (view: 'all' | 'collapsed' | 'attention', onCycleView: () => void) => {
    nextId = 0
    return expandNode(Area({
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
  assert.match(styles, /\.watched_area\s*\{[^}]*min-inline-size:\s*0/)
  assert.match(styles, /\.watched_fold\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/)
  assert.match(styles, /\.watched_foldInner\s*\{[^}]*min-inline-size:\s*0/)
  assert.match(styles, /\.watched_rows\s*\{[^}]*overflow-x:\s*hidden/)
  assert.match(styles, /\.watched_header\s*\{[^}]*block-size:\s*36px/)
  assert.match(styles, /\.watched_header h2\s*\{[^}]*margin-inline-start:\s*calc\(var\(--dsh-sidebar-row-padding,\s*12px\)\s*-\s*5px\)/)
  assert.match(styles, /\.watched_heading\s*\{[^}]*padding-inline-start:\s*4px;[^}]*color:\s*var\(--dsw-alias-label-tertiary\)/s)
  assert.match(styles, /\.watched_labelGroup\s*\{[^}]*align-items:\s*baseline;[^}]*gap:\s*6px;/s)
  assert.match(styles, /\.watched_heading:hover,\s*\.watched_heading:hover \.watched_arrow\s*\{\s*color:\s*var\(--dsw-alias-label-secondary\);?\s*\}/)
  assert.match(styles, /\.watched_heading:focus-visible\s*\{\s*outline:\s*var\(--dsw-focus-ring-width,\s*1px\) solid var\(--dsw-focus-ring-color,\s*var\(--dsw-alias-state-business-primary\)\);\s*outline-offset:\s*-2px;?\s*\}/)
  assert.match(styles, /\.watched_arrow path\s*\{[^}]*stroke-opacity:\s*0/)
  assert.match(styles, /\.watched_heading\[data-view=attention\] \.watched_arrow path\s*\{\s*fill-opacity:\s*0;\s*stroke-opacity:\s*1;?\s*\}/)
})

test('persists watch mode preference and handles storage failures', () => {
  storeData.clear()
  const wm = createWatchMode(storage)
  assert.equal(wm.getSnapshot(), false)
  let notifications = 0
  const unsub = wm.subscribe(() => { notifications += 1 })
  assert.equal(wm.setEnabled(false), true)
  assert.equal(notifications, 0)
  assert.equal(wm.setEnabled(true), true)
  assert.equal(notifications, 1)
  assert.equal(storeData.get(WATCH_MODE_STORAGE_KEY), 'true')
  storeData.set(WATCH_MODE_STORAGE_KEY, 'false')
  wm.sync()
  assert.equal(wm.getSnapshot(), false)
  assert.equal(notifications, 2)
  unsub()

  const broken = createWatchMode({
    getItem() { throw new Error('blocked') },
    setItem() { throw new Error('quota') },
  })
  assert.equal(broken.getSnapshot(), false)
  assert.equal(broken.setEnabled(true), false)
  assert.equal(broken.getSnapshot(), true)
})

test('formats elapsed durations compactly across units', () => {
  const format = (key: string, params?: Record<string, unknown>) => {
    const map: Record<string, string> = {
      durationS: `${params?.s}s`,
      durationM: `${params?.m}m`,
      durationMS: `${params?.m}m ${params?.s}s`,
      durationH: `${params?.h}h`,
      durationHM: `${params?.h}h ${params?.m}m`,
      durationD: `${params?.d}d`,
      durationDH: `${params?.d}d ${params?.h}h`,
    }
    return map[key] ?? key
  }
  assert.equal(formatDuration(-500, format), '0s')
  assert.equal(formatDuration(Number.NaN, format), '0s')
  assert.equal(formatDuration(45_900, format), '45s')
  assert.equal(formatDuration(60_000, format), '1m')
  assert.equal(formatDuration(95_000, format), '1m 35s')
  assert.equal(formatDuration(3_600_000, format), '1h')
  assert.equal(formatDuration((2 * 3600 + 15 * 60) * 1000, format), '2h 15m')
  assert.equal(formatDuration(86_400_000, format), '1d')
  assert.equal(formatDuration((3 * 86400 + 4 * 3600) * 1000, format), '3d 4h')
})

test('isolates slow sessions per request, respects timeout and AbortSignal polyfills, and retries errors', async () => {
  const seenUrls: string[] = []
  const errors: unknown[] = []
  let failSlow = false
  let releaseHang!: () => void
  const hangGate = new Promise<void>(resolve => { releaseHang = resolve })

  const client = createRuntimeClient({
    baseURI: () => 'http://localhost:47311/base/',
    timeoutMs: 80,
    errorRetryBaseMs: 25,
    onError: error => { errors.push(error) },
    fetch: async (input, init) => {
      assert.equal(typeof input, 'string')
      assert.equal(init?.credentials, 'same-origin')
      assert.equal(init?.cache, 'no-store')
      seenUrls.push(input as string)
      const id = new URL(input as string).searchParams.get('id')
      if (id === 'hang') {
        await new Promise((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
          void hangGate.then(resolve)
        })
        return new Response('timed-out', { status: 503 })
      }
      if (id === 'slow-fail' && !failSlow) {
        failSlow = true
        return new Response('temp-fail', { status: 500 })
      }
      return Response.json({ runtimes: { [id!]: { completedMs: 2_500, runningSince: null } } })
    },
  })

  const origAny = AbortSignal.any
  const origTimeout = AbortSignal.timeout
  ;(AbortSignal as unknown as { any?: unknown }).any = undefined
  ;(AbortSignal as unknown as { timeout?: unknown }).timeout = undefined

  try {
    const stopHang = client.track('hang', '1:0:0', false)
    const stopFast = client.track('fast', '1:0:0', false)
    const stopRetry = client.track('slow-fail', '1:0:0', false)

    // Fast session resolves immediately despite a hung sibling and missing AbortSignal.any/timeout.
    await new Promise(resolve => setTimeout(resolve, 45))
    assert.deepEqual(client.getEntry('fast'), { status: 'ready', completedMs: 2_500, runningSince: null })
    // Transient 500 transitions out of loading and recovers automatically via backoff retry.
    await new Promise(resolve => setTimeout(resolve, 60))
    assert.deepEqual(client.getEntry('slow-fail'), { status: 'ready', completedMs: 2_500, runningSince: null })
    // Hung session hits timeoutMs, leaves loading for error, and logs via onError.
    await new Promise(resolve => setTimeout(resolve, 40))
    assert.deepEqual(client.getEntry('hang'), { status: 'error' })
    assert.ok(errors.length >= 1)
    assert.ok(seenUrls.some(url => url.startsWith('http://localhost:47311/base/api/watched-sessions/runtime?')))

    stopHang()
    stopFast()
    stopRetry()
  } finally {
    releaseHang()
    AbortSignal.any = origAny
    AbortSignal.timeout = origTimeout
    client.dispose()
  }
})

test('resets failed/in-flight runtime requests on connection/reset and supports page transport fetch', async () => {
  const originalTransport = (globalThis as { __DSH_TRANSPORT__?: unknown }).__DSH_TRANSPORT__
  const transportRequests: string[] = []
  let failMode = true

  ;(globalThis as { __DSH_TRANSPORT__?: unknown }).__DSH_TRANSPORT__ = {
    fetch: async (input: string) => {
      transportRequests.push(input)
      const id = new URL(input, 'http://localhost/').searchParams.get('id')!
      if (failMode) return new Response('offline', { status: 503 })
      return Response.json({ runtimes: { [id]: { completedMs: 9_000, runningSince: null } } })
    },
  }

  const client = createRuntimeClient({ errorRetryBaseMs: 5_000 })
  try {
    const stopReady = client.track('ready-one', '1:0:0', false)
    failMode = false
    await new Promise(resolve => setTimeout(resolve, 40))
    assert.deepEqual(client.getEntry('ready-one'), { status: 'ready', completedMs: 9_000, runningSince: null })
    assert.ok(transportRequests[0].startsWith('api/watched-sessions/runtime?id=ready-one'))

    failMode = true
    const stopErr = client.track('err-one', '1:0:0', false)
    await new Promise(resolve => setTimeout(resolve, 40))
    assert.deepEqual(client.getEntry('err-one'), { status: 'error' })

    // reset() immediately retries errored entries while keeping existing ready entries visible.
    failMode = false
    client.reset()
    assert.deepEqual(client.getEntry('ready-one'), { status: 'ready', completedMs: 9_000, runningSince: null })
    assert.deepEqual(client.getEntry('err-one'), { status: 'loading' })
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.deepEqual(client.getEntry('err-one'), { status: 'ready', completedMs: 9_000, runningSince: null })

    stopReady()
    stopErr()
  } finally {
    ;(globalThis as { __DSH_TRANSPORT__?: unknown }).__DSH_TRANSPORT__ = originalTransport
    client.dispose()
  }

  // Host connection/reset emits runtime.reset() cleanly for active subscribers.
  storeData.clear()
  const f = fixture()
  plugin.apply(f.ctx)
  try {
    const replacement = f.ctx.slots.entriesOfSlot()[0]
    const rt = replacement.inject().runtime
    const stop = rt.track('alpha', '1:0:0', false)
    await new Promise(resolve => setTimeout(resolve, 35))
    assert.deepEqual(rt.getEntry('alpha'), { status: 'error' })
    f.emit('connection/reset')
    assert.deepEqual(rt.getEntry('alpha'), { status: 'loading' })
    stop()
  } finally {
    f.stop()
  }
})

test('batches runtime requests when configured, caches hits, retries status races, and stops clock when idle', async () => {
  const requests: URL[] = []
  let now = 10_000
  let mode: 'ok' | 'race' | 'fail' = 'ok'
  const client = createRuntimeClient({
    batchLimit: 50,
    errorRetryBaseMs: 5_000,
    onError: () => {},
    baseURI: () => 'http://localhost:47311/',
    now: () => now,
    fetch: async (input) => {
      const url = input instanceof URL ? input : new URL(String(input))
      requests.push(url)
      if (mode === 'fail') return new Response('err', { status: 500 })
      const idsRequested = url.searchParams.getAll('id')
      const runtimes = Object.fromEntries(idsRequested.map(id => [
        id,
        id === 'live'
          ? { completedMs: 5_000, runningSince: mode === 'race' ? null : 9_000 }
          : { completedMs: 12_000, runningSince: null },
      ]))
      if (mode === 'race') mode = 'ok'
      return Response.json({ runtimes })
    },
  })

  try {
    let ticks = 0
    const stopA = client.track('alpha', '1:0:0', false)
    const stopB = client.track('live', '2:1:0', true)
    const stopB2 = client.track('live', '2:1:0', true)
    assert.deepEqual(client.getEntry('alpha'), { status: 'loading' })

    await new Promise(resolve => setTimeout(resolve, 40))
    assert.equal(requests.length, 1)
    assert.deepEqual(requests[0].searchParams.getAll('id'), ['alpha', 'live'])
    assert.deepEqual(client.getEntry('alpha'), { status: 'ready', completedMs: 12_000, runningSince: null })
    assert.deepEqual(client.getEntry('live'), { status: 'ready', completedMs: 5_000, runningSince: 9_000 })

    // Same signature does not trigger redundant network fetch.
    const stopADup = client.track('alpha', '1:0:0', false)
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(requests.length, 1)
    stopADup()
    stopA()

    const stopClock = client.subscribeClock(() => { ticks += 1 })
    now = 11_100
    await new Promise(resolve => setTimeout(resolve, 1_100))
    assert.ok(ticks >= 1)
    stopClock()

    // Status race retry when client thinks session is running but host returns runningSince: null once.
    mode = 'race'
    const stopRace = client.track('live', '3:1:0', true)
    await new Promise(resolve => setTimeout(resolve, 500))
    assert.equal(requests.length, 3)
    assert.deepEqual(client.getEntry('live'), { status: 'ready', completedMs: 5_000, runningSince: 9_000 })
    stopRace()
    stopB()
    stopB2()

    // Error state preserves pre-existing ready cache, marks fresh unknown entries as error.
    mode = 'fail'
    const stopErr = client.track('unknown', '1:0:0', false)
    await new Promise(resolve => setTimeout(resolve, 40))
    assert.deepEqual(client.getEntry('unknown'), { status: 'error' })
    stopErr()
  } finally {
    client.dispose()
  }
})

test('switches icons, titles, detail-page setting, and overlay CSS in watch mode', () => {
  const TooltipStub = ({ children }: { children?: unknown }) => children
  const SwitchStub = (props: Record<string, unknown>) => ({ type: 'switch-stub', props })
  let nextId = 0
  const react = {
    ...require('react'),
    useId: () => `:watch-${nextId++}:`,
    useSyncExternalStore: (subscribe: (cb: () => void) => () => void, getSnapshot: () => unknown) => {
      void subscribe
      return getSnapshot()
    },
  }
  const uiPlugin = registration.factory((name: string) => {
    if (name === 'react') return react
    if (name === '@deepseek-ai/dsh-client-ui-primitives') {
      return { HoverCardGroup: ({ children }: { children?: unknown }) => children, Tooltip: TooltipStub, Switch: SwitchStub }
    }
    return require(name)
  })

  const shouldExpand = (type: unknown) =>
    type === TooltipStub || (typeof type === 'function' && ['Fold', 'EyeIcon', 'WatchIcon'].includes(type.name))

  const dragAdding = {
    source: { origin: 'list', id: 'beta' }, overTop: false, overList: false, marker: undefined,
    hoverTop: () => false, leaveTop: () => {}, dropTop: () => false,
    beginTop: () => {}, endTop: () => {}, beginList: () => {}, endList: () => false,
    hoverList: () => false, leaveList: () => {}, dropList: () => false,
  }
  const areaWatch = expandNode(uiPlugin.__test.WatchedArea({
    rows: [{ id: 'alpha', title: 'Alpha' }],
    view: 'all',
    attention: new Set(),
    onCycleView: () => {},
    drag: dragAdding,
    label: (key: string) => key,
    currentId: undefined,
    watchMode: true,
  }), shouldExpand)

  const headerButton = findElement(areaWatch, element => element.type === 'button')
  assert.equal(headerButton?.props?.['aria-label'], 'watchCollapse')
  const titleSpan = findElement(headerButton, element => element.type === 'span' && element.props?.children === 'watchSection')
  assert.ok(titleSpan)
  assert.ok(findElement(areaWatch, element => element.type === 'svg' && element.props?.['data-dsh-watch-icon'] === 'watch'))
  assert.ok(findElement(areaWatch, element => element.type === 'span' && element.props?.children === 'watchDrop'))

  const dragReturning = { ...dragAdding, source: { origin: 'top', id: 'alpha' } }
  const returnWatch = expandNode(uiPlugin.__test.WatchedReturnTarget({
    drag: dragReturning,
    label: (key: string) => key,
    watchMode: true,
  }), shouldExpand)
  assert.ok(findElement(returnWatch, element => element.type === 'svg' && element.props?.['data-dsh-watch-icon'] === 'watch-off'))
  assert.ok(findElement(returnWatch, element => element.type === 'span' && element.props?.children === 'watchReturn'))

  const returnEye = expandNode(uiPlugin.__test.WatchedReturnTarget({
    drag: dragReturning,
    label: (key: string) => key,
    watchMode: false,
  }), shouldExpand)
  assert.ok(findElement(returnEye, element => element.type === 'svg' && element.props?.['data-dsh-watch-icon'] === 'eye-off'))

  storeData.clear()
  const wm = uiPlugin.__test.createWatchMode(storage)
  assert.equal(uiPlugin.__test.WatchModeSettings({ view: 'summary', watchMode: wm, t: (k: string) => k }), null)
  const pageView = uiPlugin.__test.WatchModeSettings({ view: 'page', watchMode: wm, t: (k: string) => k })
  const sw = findElement(pageView, element => element.type === SwitchStub)
  assert.equal(sw?.props?.checked, false)
  assert.equal(sw?.props?.label, 'watchMode')
  ;(sw?.props?.onChange as (next: boolean) => void)(true)
  assert.equal(wm.getSnapshot(), true)

  assert.equal(uiPlugin.__test.WatchModeOverlay({ useWatchMode: (sel: (v: boolean) => boolean) => sel(false) }), null)
  const overlayOn = uiPlugin.__test.WatchModeOverlay({ useWatchMode: (sel: (v: boolean) => boolean) => sel(true) })
  const overlayStyle = findElement(overlayOn, element => element.type === 'style')
  assert.equal(typeof overlayStyle?.props?.children, 'string')
  const cssText = overlayStyle?.props?.children as string
  assert.match(cssText, /img\[src="data:image\/svg\+xml;base64,/)
  assert.match(cssText, /content: url\("data:image\/svg\+xml,/)
  assert.match(cssText, /\.Rows_timestamp\s*\{\s*display:\s*none;/)

  const builtCss = buildWatchModeCss('a', 'b')
  assert.match(builtCss, /img\[src="a"\],\s*img\[src="b"\]/)
})

test('exposes watch mode settings on aggregate details and scopes runtime slots to watched rows', () => {
  const SwitchStub = (props: Record<string, unknown>) => ({ type: 'switch-stub', props })
  const react = {
    ...require('react'),
    useCallback: (fn: unknown) => fn,
    useSyncExternalStore: (subscribe: (cb: () => void) => () => void, getSnapshot: () => unknown) => {
      void subscribe
      return getSnapshot()
    },
  }
  const uiPlugin = registration.factory((name: string) => {
    if (name === 'react') return react
    if (name === '@deepseek-ai/dsh-client-ui-primitives') {
      return {
        HoverCardGroup: ({ children }: { children?: unknown }) => children,
        IconEditOutlineRegular: () => ({ type: 'svg' }),
        Tooltip: ({ children }: { children?: unknown }) => children,
        Switch: SwitchStub,
      }
    }
    return require(name)
  })

  storeData.clear()
  const wm = uiPlugin.__test.createWatchMode(storage)
  const bundleName = '@miorin/dsh-watched-sessions'
  const rowId = 'dsh-watched-sessions'
  const row = { rowId, moduleName: bundleName, enabled: true }
  const aggregate = { name: '@miorin/dsh-atlas-list', enabled: true, rows: [row] }
  const section = (subject: unknown) => expandNode(uiPlugin.__test.AggregatedWatchModeSettings({
    subject, bundleName, rowId, watchMode: wm, t: (k: string) => k,
  }), (type: unknown) => type === uiPlugin.__test.WatchModeSettings)

  const shown = section({ kind: 'bundle', pkg: aggregate })
  assert.equal(shown?.props?.['data-dsh-watched-sessions-settings'], '')
  const shownStyle = findElement(shown, element => element.type === 'style')
  const shownCss = String(shownStyle?.props?.children ?? '')
  assert.match(shownCss, /\[data-detail-document\][^}]*order:\s*-2/)
  assert.match(shownCss, /\[data-slot="plugins\.detail\.section"\]\s*>\s*\[data-dsh-watched-sessions-settings\][^}]*order:\s*-1/)
  const sw = findElement(shown, element => element.type === SwitchStub)
  assert.ok(sw)
  assert.equal(sw.props?.checked, false)
  ;(sw.props?.onChange as (next: boolean) => void)(true)
  assert.equal(wm.getSnapshot(), true)

  assert.equal(section({ kind: 'bundle', pkg: { ...aggregate, name: bundleName } }), null)
  assert.equal(section({ kind: 'bundle', pkg: { ...aggregate, enabled: false } }), null)
  assert.equal(section({ kind: 'bundle', pkg: { ...aggregate, rows: [] } }), null)
  assert.equal(section({ kind: 'bundle', pkg: { ...aggregate, rows: [{ ...row, enabled: false }] } }), null)
  assert.equal(section({ kind: 'row', pkg: aggregate, row }), null)

  const runtime = uiPlugin.__test.createRuntimeClient()
  try {
    let watchModeEnabled = true
    const draftIds = new Set(['alpha'])
    const useWatchedDrafts = (select: (ids: ReadonlySet<string>) => boolean) => select(draftIds)
    const browserTree = uiPlugin.__test.WatchedBrowser({
      useWatchedDrafts,
      runRowAction: () => {},
      runtime,
      t: (k: string) => k,
      labelWatched: (k: string) => k,
      useSessionAccess: () => false,
      useSessionStatus: () => undefined,
      useSessions: () => undefined,
      useWorkspaces: () => false,
      useWatchMode: (sel: (v: boolean) => boolean) => sel(watchModeEnabled),
    })
    const browserEl = findElement(browserTree, element => element.props?.renderWatchedSlot !== undefined)
    assert.ok(browserEl?.props)
    const renderSlot = browserEl.props.renderSlot as (name: string, owner: Record<string, unknown>) => ElementNode | null
    const renderWatchedSlot = browserEl.props.renderWatchedSlot as (name: string, owner: Record<string, unknown>) => ElementNode | null

    // Both lists show a draft only on the row that owns it. Clearing it removes the marker.
    for (const render of [renderSlot, renderWatchedSlot]) {
      const draft = (sessionId: string) => expandNode(render('sidebar.session.row.leading', { sessionId }), () => true)
      assert.equal(draft('alpha')?.props?.['aria-label'], 'unsentDraft')
      assert.equal(draft('beta'), null)
      draftIds.delete('alpha')
      assert.equal(draft('alpha'), null)
      draftIds.add('alpha')
    }

    // Regular list rows never get runtime trailing/hover slots, even in watch mode.
    assert.ok(renderSlot('sidebar.workspaces.session.row.action', { sessionId: 'alpha', displayTitle: 'Alpha' }))
    assert.equal(renderSlot('sidebar.session.row.trailing', { sessionId: 'alpha' }), null)
    assert.equal(renderSlot('sidebar.session.row.hover', { sessionId: 'alpha' }), null)

    // Watched rows get actions plus runtime trailing and hover badges in watch mode.
    assert.ok(renderWatchedSlot('sidebar.workspaces.session.row.action', { sessionId: 'alpha', displayTitle: 'Alpha' }))
    const trailing = renderWatchedSlot('sidebar.session.row.trailing', { sessionId: 'alpha' })
    const hover = renderWatchedSlot('sidebar.session.row.hover', { sessionId: 'alpha' })
    assert.equal(trailing?.props?.sessionId, 'alpha')
    assert.equal(hover?.props?.sessionId, 'alpha')

    // Disabling watch mode turns off watched row runtime slots too.
    watchModeEnabled = false
    const browserOff = uiPlugin.__test.WatchedBrowser({
      useWatchedDrafts,
      runRowAction: () => {},
      runtime,
      t: (k: string) => k,
      labelWatched: (k: string) => k,
      useSessionAccess: () => false,
      useSessionStatus: () => undefined,
      useSessions: () => undefined,
      useWorkspaces: () => false,
      useWatchMode: (sel: (v: boolean) => boolean) => sel(watchModeEnabled),
    })
    const offEl = findElement(browserOff, element => element.props?.renderWatchedSlot !== undefined)
    const offWatchedSlot = offEl?.props?.renderWatchedSlot as (name: string, owner: Record<string, unknown>) => ElementNode | null
    assert.ok(offWatchedSlot('sidebar.session.row.leading', { sessionId: 'alpha' }))
    assert.equal(offWatchedSlot('sidebar.session.row.trailing', { sessionId: 'alpha' }), null)
    assert.equal(offWatchedSlot('sidebar.session.row.hover', { sessionId: 'alpha' }), null)
  } finally {
    runtime.dispose()
  }
})
