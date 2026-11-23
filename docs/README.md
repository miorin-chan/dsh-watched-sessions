# 项目文档

- [安装与使用（简体中文）](../README.zh.md) · [Installation and usage (English)](../README.md)
- [插件详情（简体中文）](DETAIL.zh.md) · [Plugin details (English)](DETAIL.md)

## 侧栏集成

插件通过 `sidebar.workspaces` 单实例插槽登记一个适配后的浏览区。
原生浏览区登记的视图状态和操作仍由 DSH 提供，让普通排序、搜索快捷键和工作区菜单使用同一份状态。
顶区只保存按顺序排列的会话 ID，普通视图在计算可见行时跳过这些 ID。
普通排序继续使用完整的会话顺序，取消超级置顶后按该顺序归位。
归档会清除超级置顶。

子插槽由原生登记持有。工作区的添加按钮打开原生选择器，再从中添加目录。
会话操作通过 `contextMenus` 执行。
第三方插件通过原生行插槽添加的标记、按钮和悬停内容由原生浏览区渲染，停用本插件即可恢复。

### 上游来源

以下组件固定到 `@deepseek-ai/dsh-client-ui-workspace@0.2.2-rc.5`，
遵循随包分发的 [MIT 许可](../LICENSE.deepseek-harness)。

| 位置 | 上游源码和符号 |
| --- | --- |
| [浏览区](../src/client/upstream/WorkspaceBrowser.tsx) | `src/client/rows/WorkspaceBrowser.tsx` 的 `WorkspaceBrowser`、`SessionTree`、`FlatList` 和搜索视图。`src/client/tree.ts` 提供分组、过滤和排序。`src/client/stores.ts` 提供平铺排序键。 |
| [会话行](../src/client/super-pin-area.tsx) | `src/client/rows/Rows.tsx` 的 `SessionNodeItem`、`ProjectRowItem` 和 `SearchResultItem`，以及 `src/client/rows/Rows.module.css`。 |
| [原生行操作](../src/client/browser.tsx) | `src/client/session-actions/PinSession.tsx` 和 `ArchiveSession.tsx` 的悬停按钮样式。菜单动作由宿主执行。 |

[第三方依赖许可](../LICENSE.clsx)随构建产物一并打包。
