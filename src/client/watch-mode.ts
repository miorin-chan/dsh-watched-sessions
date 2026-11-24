export const WATCH_MODE_STORAGE_KEY = 'dsh.watched-sessions.watch-mode.v1'

/**
 * 36x36 wristwatch artwork matching icon.svg's palette (#526ED2 / #5E91DF / #FFFFFF)
 * so the plugin card and detail page swap cleanly in Watch Mode.
 */
export const WATCH_PLUGIN_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36" fill="none">
  <path d="M13 10.5V5.8C13 4.8 13.8 4 14.8 4H21.2C22.2 4 23 4.8 23 5.8V10.5" stroke="#526ED2" stroke-width="2.4" stroke-linejoin="round"/>
  <path d="M13 25.5V30.2C13 31.2 13.8 32 14.8 32H21.2C22.2 32 23 31.2 23 30.2V25.5" stroke="#526ED2" stroke-width="2.4" stroke-linejoin="round"/>
  <rect x="27.2" y="15.75" width="2.8" height="4.5" rx="1.2" fill="#526ED2"/>
  <circle cx="18" cy="18" r="8.8" fill="#5E91DF" stroke="#526ED2" stroke-width="2.4"/>
  <path d="M18 13.2V18L21.6 20.2" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="18" cy="18" r="1.4" fill="#FFFFFF"/>
</svg>`

export const WATCH_PLUGIN_ICON_DATA_URI = `data:image/svg+xml,${encodeURIComponent(WATCH_PLUGIN_ICON_SVG)}`

/** Client-local Watch Mode easter egg preference persisted in localStorage. */
export function createWatchMode(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined) {
  function read(): boolean {
    try {
      return storage?.getItem(WATCH_MODE_STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  }

  let enabled = read()
  const listeners = new Set<() => void>()

  function publish(next: boolean): void {
    if (next === enabled) return
    enabled = next
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot: () => enabled,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    setEnabled(next: boolean): boolean {
      let persisted = true
      try {
        storage?.setItem(WATCH_MODE_STORAGE_KEY, String(next))
      } catch {
        persisted = false
      }
      publish(next)
      return persisted
    },
    sync() {
      publish(read())
    },
  }
}

export type WatchMode = ReturnType<typeof createWatchMode>
