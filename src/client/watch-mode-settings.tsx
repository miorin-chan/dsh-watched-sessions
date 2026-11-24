import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsHooks, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { useSyncExternalStore } from 'react'
// @deepseek-ai/dsh-client-ui-workspace 0.2.2-rc.5, src/client/rows/Rows.module.css: rowResting, timestamp, time, hoverContent, hoverTime.
import rowsCss from '@deepseek-ai/dsh-client-ui-workspace/src/client/rows/Rows.module.css'
import type { WatchedTranslate } from './labels'
import { WATCH_PLUGIN_ICON_DATA_URI, type WatchMode } from './watch-mode'
import css from './watched.module.css'

declare const __WATCHED_STYLES__: string
declare const __WATCHED_ICON__: string
declare const __WATCHED_ICON_TRIMMED__: string

// @deepseek-ai/dsh-client-ui-plugin-manager 0.2.2-rc.5, lib/types/client/slot-contract.d.ts:
// plugins.bundle.config, plugins.detail.section, PluginDetailProps, PluginPackageRef, PluginRowRef, PluginsSubject.
export interface WatchDetailRowRef {
  readonly rowId: string
  readonly moduleName: string
  readonly enabled: boolean
}

export interface WatchDetailPackageRef {
  readonly name: string
  readonly enabled: boolean
  readonly rows: readonly WatchDetailRowRef[]
}

export type WatchDetailSubject =
  | { readonly kind: 'bundle'; readonly pkg: WatchDetailPackageRef }
  | { readonly kind: 'row'; readonly pkg: WatchDetailPackageRef; readonly row: WatchDetailRowRef }
  | { readonly kind: 'item'; readonly id: string }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'plugins.bundle.config': {
      kind: 'keyed'
      scope: 'root'
      owner: { readonly view: 'summary' | 'page' }
    }
    'plugins.detail.section': {
      kind: 'list'
      scope: 'root'
      owner: { readonly subject: WatchDetailSubject }
    }
  }
}

function escapeCssUrl(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function escapeCssAttr(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

export function buildWatchModeCss(iconRaw: string, iconTrimmed: string): string {
  const selectors = [iconRaw, iconTrimmed]
    .filter((src, index, all) => src !== '' && all.indexOf(src) === index)
    .map(src => `img[src="${escapeCssAttr(src)}"]`)
  const iconRule = selectors.length === 0
    ? ''
    : `${selectors.join(',\n')} {\n  content: url("${escapeCssUrl(WATCH_PLUGIN_ICON_DATA_URI)}");\n}\n`
  return `${iconRule}.${rowsCss.rowResting}:has(.${css.runtimeTime}) > .${rowsCss.timestamp} {
  display: none;
}
.${rowsCss.rowResting}:has(> .${rowsCss.time}:not(.${rowsCss.timestamp}):not(.${css.runtimeTime})) > .${css.runtimeTime} {
  display: none;
}
.${rowsCss.hoverContent}:has(.${css.hoverRuntime}) > .${rowsCss.hoverTime}:not(.${css.hoverRuntime}) {
  display: none;
}
`
}

export function WatchModeSettings({ view, watchMode, t }: {
  view: 'summary' | 'page'
  watchMode: WatchMode
  t: PropsLocale<'dsh-watched-sessions'>['t'] | WatchedTranslate
}) {
  const enabled = useSyncExternalStore(watchMode.subscribe, watchMode.getSnapshot)
  if (view !== 'page') return null
  const label = t('watchMode')
  return (
    <div>
      <style>{__WATCHED_STYLES__}</style>
      <div className={css.settingRow} data-dsh-watched-sessions-watch-mode-setting="">
        <span className={css.settingLabel} onClick={() => { watchMode.setEnabled(!enabled) }}>
          {label}
        </span>
        <Switch checked={enabled} onChange={next => { watchMode.setEnabled(next) }} label={label} />
      </div>
    </div>
  )
}

export function AggregatedWatchModeSettings({ subject, bundleName, rowId, watchMode, t }: {
  subject: WatchDetailSubject
  bundleName: string
  rowId: string
  watchMode: WatchMode
  t: PropsLocale<'dsh-watched-sessions'>['t'] | WatchedTranslate
}) {
  if (subject.kind !== 'bundle' || subject.pkg.name === bundleName || !subject.pkg.enabled) return null
  const ownsWatched = subject.pkg.rows.some(row =>
    row.rowId === rowId && row.moduleName === bundleName && row.enabled)
  return ownsWatched ? <WatchModeSettings view="page" watchMode={watchMode} t={t} /> : null
}

export function WatchModeOverlay({ useWatchMode }: PropsHooks<{ watchMode: import('@deepseek-ai/dsh-client-ui-slots').HostObservable<boolean> }>) {
  const enabled = useWatchMode(value => value)
  if (!enabled) return null
  return <style data-dsh-watched-sessions-watch-mode-styles="">{buildWatchModeCss(__WATCHED_ICON__, __WATCHED_ICON_TRIMMED__)}</style>
}
