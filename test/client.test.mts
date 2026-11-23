import assert from 'node:assert/strict'
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
