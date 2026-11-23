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
assert.equal(registration.id, '@miorin/dsh-super-pin')
const require = createRequire(import.meta.url)
const plugin = registration.factory((name: string) => name === '@deepseek-ai/dsh-client-ui-primitives' ? {} : require(name))
const { canSuperPin, createSuperPins } = plugin.__test

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
  const slotListeners = new Set()
  const menu = new Map()
  const entries = startEmpty ? [] : [native]
  const labels = new Set()
  const workspace = observable({ archivedSessionIds: [] })
  function changed() { for (const listener of slotListeners) listener() }
  const ctx = {
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
    ctx, native, entries, menu, labels, workspace, slotListeners, changed,
    stop() { for (const dispose of effects.reverse()) dispose() },
  }
}

test('restores stored pins, preserves visible order, and persists removals', () => {
  saved = '["beta",null,"alpha","beta",42,""]'
  const pins = createSuperPins(storage)
  const changes = []
  const stop = pins.subscribe(() => changes.push([...pins.getSnapshot().ids]))
  assert.deepEqual(pins.getSnapshot().ids, ['beta', 'alpha'])
  pins.place('gamma', { id: 'alpha', half: 'before' })
  pins.place('alpha', { id: 'beta', half: 'before' })
  pins.place('alpha', { id: 'alpha', half: 'after' })
  pins.removeArchived(['beta'])
  stop()
  assert.deepEqual(changes, [['beta', 'gamma', 'alpha'], ['alpha', 'beta', 'gamma'], ['alpha', 'gamma']])
  assert.deepEqual(createSuperPins(storage).getSnapshot().ids, ['alpha', 'gamma'])
})

test('menu reordering skips unavailable pins and keeps focus notices out of storage', () => {
  saved = '["alpha","unavailable","beta"]'
  const pins = createSuperPins(storage)
  const visible = id => id !== 'unavailable'
  pins.moveBy('beta', -1, visible)
  assert.deepEqual(pins.getSnapshot().ids, ['beta', 'alpha', 'unavailable'])
  const first = pins.getSnapshot()
  pins.moveBy('beta', -1, visible)
  assert.equal(pins.getSnapshot(), first)
  pins.unpin('beta', 'Beta')
  assert.deepEqual(pins.getSnapshot().menuMove, { id: 'beta', title: 'Beta', to: 'list' })
  assert.equal(saved, '["alpha","unavailable"]')
  pins.pin('gamma', 'Gamma')
  assert.deepEqual(pins.getSnapshot().menuMove, { id: 'gamma', title: 'Gamma', to: 'top' })
  assert.equal(createSuperPins(storage).getSnapshot().menuMove, undefined)
})

test('ignores missing, blank, subagent, and archived sessions when offering super pin', () => {
  const byId = {
    alpha: session('alpha'),
    blank: session('blank', { blank: true }),
    child: session('child', { origin: 'subagent' }),
    archived: session('archived'),
  }
  const list = { byId }
  assert.equal(canSuperPin(list, ['archived'], 'alpha'), true)
  for (const id of ['missing', 'blank', 'child', 'archived']) {
    assert.equal(canSuperPin(list, ['archived'], id), false, id)
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
    const action = f.menu.get('dsh-super-pin.toggle')
    assert.deepEqual(action.resolve({ sessionId: 'missing' }), [])
    const alpha = { sessionId: 'alpha', displayTitle: 'Alpha' }
    const beta = { sessionId: 'beta', displayTitle: 'Beta' }
    assert.equal(action.resolve(alpha)[0].label, 'pin')
    action.resolve(alpha)[0].run()
    assert.equal(saved, '["alpha"]')
    assert.deepEqual(action.resolve(alpha).map(item => item.label), ['unpin'])
    action.resolve(beta)[0].run()
    assert.deepEqual(action.resolve(alpha).map(item => item.label), ['unpin', 'moveDown'])
    assert.deepEqual(action.resolve(beta).map(item => item.label), ['unpin', 'moveUp'])
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
