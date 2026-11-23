import type {} from '@deepseek-ai/dsh-client-locale/client'

export const NS = 'dsh-watched-sessions'

export const LABELS = {
  en: {
    section: 'Watched', watch: 'Watch', unwatch: 'Stop watching',
    drop: 'Drop here to watch', return: 'Release to stop watching',
    moveUp: 'Move up', moveDown: 'Move down',
    watched: 'Watching', returned: 'Returned to the session list',
    collapse: 'Collapse watched sessions', attention: 'Show only watched sessions needing attention',
    expand: 'Show all watched sessions', empty: 'No watched sessions need attention',
  },
  zh: {
    section: '常驻会话', watch: '设为常驻', unwatch: '取消常驻',
    drop: '拖到这里设为常驻', return: '松手取消常驻',
    moveUp: '上移', moveDown: '下移',
    watched: '已设为常驻', returned: '已移回会话列表',
    collapse: '收起常驻会话', attention: '只显示需关注的常驻会话',
    expand: '显示全部常驻会话', empty: '没有需关注的常驻会话',
  },
  ja: {
    section: 'ウォッチ中', watch: 'ウォッチする', unwatch: 'ウォッチを解除',
    drop: 'ここにドロップしてウォッチ', return: '離すとウォッチを解除',
    moveUp: '上へ移動', moveDown: '下へ移動',
    watched: 'ウォッチしました', returned: 'セッション一覧に戻しました',
    collapse: 'ウォッチ中のセッションを折りたたむ', attention: '要確認のウォッチ中セッションのみ表示',
    expand: 'ウォッチ中のセッションをすべて表示', empty: '要確認のウォッチ中セッションはありません',
  },
  de: {
    section: 'Beobachtet', watch: 'Beobachten', unwatch: 'Nicht mehr beobachten',
    drop: 'Zum Beobachten hier ablegen', return: 'Loslassen, um nicht mehr zu beobachten',
    moveUp: 'Nach oben', moveDown: 'Nach unten',
    watched: 'Wird beobachtet', returned: 'Zurück in der Sitzungsliste',
    collapse: 'Beobachtete Sitzungen einklappen', attention: 'Nur beobachtete Sitzungen mit Handlungsbedarf anzeigen',
    expand: 'Alle beobachteten Sitzungen anzeigen', empty: 'Keine beobachtete Sitzung hat Handlungsbedarf',
  },
  es: {
    section: 'Vigiladas', watch: 'Vigilar', unwatch: 'Dejar de vigilar',
    drop: 'Suelta aquí para vigilar', return: 'Suelta para dejar de vigilar',
    moveUp: 'Subir', moveDown: 'Bajar',
    watched: 'Vigilada', returned: 'Devuelta a la lista de sesiones',
    collapse: 'Contraer las sesiones vigiladas', attention: 'Mostrar solo las sesiones vigiladas que requieren atención',
    expand: 'Mostrar todas las sesiones vigiladas', empty: 'Ninguna sesión vigilada requiere atención',
  },
  fr: {
    section: 'Suivies', watch: 'Suivre', unwatch: 'Ne plus suivre',
    drop: 'Déposer ici pour suivre', return: 'Relâcher pour ne plus suivre',
    moveUp: 'Monter', moveDown: 'Descendre',
    watched: 'Suivie', returned: 'Renvoyée dans la liste des sessions',
    collapse: 'Replier les sessions suivies', attention: 'Afficher seulement les sessions suivies qui demandent votre attention',
    expand: 'Afficher toutes les sessions suivies', empty: 'Aucune session suivie ne demande votre attention',
  },
  pt: {
    section: 'Acompanhadas', watch: 'Acompanhar', unwatch: 'Deixar de acompanhar',
    drop: 'Solte aqui para acompanhar', return: 'Solte para deixar de acompanhar',
    moveUp: 'Mover para cima', moveDown: 'Mover para baixo',
    watched: 'Acompanhada', returned: 'De volta à lista de sessões',
    collapse: 'Recolher as sessões acompanhadas', attention: 'Mostrar só as sessões acompanhadas que exigem atenção',
    expand: 'Mostrar todas as sessões acompanhadas', empty: 'Nenhuma sessão acompanhada exige atenção',
  },
  ru: {
    section: 'Отслеживаемые', watch: 'Отслеживать', unwatch: 'Не отслеживать',
    drop: 'Перетащите сюда, чтобы отслеживать', return: 'Отпустите, чтобы не отслеживать',
    moveUp: 'Переместить вверх', moveDown: 'Переместить вниз',
    watched: 'Отслеживается', returned: 'Возвращён в список сеансов',
    collapse: 'Свернуть отслеживаемые сеансы', attention: 'Показать только отслеживаемые сеансы, требующие внимания',
    expand: 'Показать все отслеживаемые сеансы', empty: 'Нет отслеживаемых сеансов, требующих внимания',
  },
}

export type WatchedLabel = keyof typeof LABELS.en

export type WatchedTranslate = (label: WatchedLabel) => string

/** Bind the same namespace for the menu and the browser region. */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-watched-sessions': WatchedLabel
  }
}
