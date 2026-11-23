import type {} from '@deepseek-ai/dsh-client-locale/client'

export const NS = 'dsh-super-pin'

export const LABELS = {
  en: {
    section: 'Super pinned', pin: 'Super pin', unpin: 'Remove super pin',
    drop: 'Drop here to super pin', return: 'Drop back to remove super pin',
    moveUp: 'Move up', moveDown: 'Move down',
    pinned: 'Super pinned', returned: 'Returned to the session list',
  },
  zh: {
    section: '超级置顶', pin: '超级置顶', unpin: '取消超级置顶',
    drop: '拖到这里超级置顶', return: '拖回这里取消超级置顶',
    moveUp: '上移', moveDown: '下移',
    pinned: '已超级置顶', returned: '已移回会话列表',
  },
  ja: {
    section: 'スーパー固定', pin: 'スーパー固定する', unpin: 'スーパー固定を解除',
    drop: 'ここにドロップしてスーパー固定', return: 'ここに戻してスーパー固定を解除',
    moveUp: '上へ移動', moveDown: '下へ移動',
    pinned: 'スーパー固定しました', returned: 'セッション一覧に戻しました',
  },
  de: {
    section: 'Super-angeheftet', pin: 'Super-anheften', unpin: 'Super-Anheften aufheben',
    drop: 'Zum Super-Anheften hier ablegen', return: 'Zum Aufheben hier ablegen',
    moveUp: 'Nach oben', moveDown: 'Nach unten',
    pinned: 'Super-angeheftet', returned: 'Zurück in der Sitzungsliste',
  },
  es: {
    section: 'Superanclajes', pin: 'Superanclar', unpin: 'Quitar superanclaje',
    drop: 'Suelta aquí para superanclar', return: 'Suelta aquí para quitar el superanclaje',
    moveUp: 'Subir', moveDown: 'Bajar',
    pinned: 'Superanclada', returned: 'Devuelta a la lista de sesiones',
  },
  fr: {
    section: 'Super épinglages', pin: 'Super épingler', unpin: 'Retirer le super épinglage',
    drop: 'Déposer ici pour super épingler', return: 'Déposer ici pour retirer le super épinglage',
    moveUp: 'Monter', moveDown: 'Descendre',
    pinned: 'Super épinglée', returned: 'Renvoyée dans la liste des sessions',
  },
  pt: {
    section: 'Superfixações', pin: 'Superfixar', unpin: 'Remover superfixação',
    drop: 'Solte aqui para superfixar', return: 'Solte aqui para remover a superfixação',
    moveUp: 'Mover para cima', moveDown: 'Mover para baixo',
    pinned: 'Superfixada', returned: 'De volta à lista de sessões',
  },
  ru: {
    section: 'Суперзакреплённые', pin: 'Суперзакрепить', unpin: 'Снять суперзакрепление',
    drop: 'Перетащите сюда для суперзакрепления', return: 'Перетащите обратно для снятия суперзакрепления',
    moveUp: 'Переместить вверх', moveDown: 'Переместить вниз',
    pinned: 'Суперзакреплён', returned: 'Возвращён в список сеансов',
  },
}

export type SuperPinLabel = keyof typeof LABELS.en

export type SuperPinTranslate = (label: SuperPinLabel) => string

/** Bind the same namespace for the menu and the browser region. */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-super-pin': SuperPinLabel
  }
}
