# 项目文档

- [产品设计](../DESIGN.md)：问题定位、目标体验、边界与成功标准。
- [安装与使用（简体中文）](../README.zh.md) · [Installation and usage (English)](../README.md)
- [插件详情（简体中文）](DETAIL.zh.md) · [Plugin details (English)](DETAIL.md)

## 侧栏集成

插件通过 `sidebar.workspaces` 单实例插槽登记一个适配后的浏览区。
原生浏览区登记的视图状态和操作仍由 DSH 提供，让普通排序、搜索快捷键和工作区菜单使用同一份状态。
常驻分区只保存按顺序排列的会话 ID，普通视图在计算可见行时跳过这些 ID。
普通排序继续使用完整的会话顺序，取消常驻后按该顺序归位。
浏览区登记还通过 `ordinaryListScope` 发布普通列表排除的常驻 ID 与实时归档筛选状态，
并在主视图选中常驻会话时清除普通工作区的当前目录高亮与自动展开，供侧栏其他列表统计对齐边界。
归档会取消常驻。

子插槽由原生登记持有。工作区的添加按钮打开原生选择器，再从中添加目录。
会话操作通过 `contextMenus` 执行。
浏览区适配器用 `sessionDraftIndicators` 在普通列表和常驻列表的行首显示铅笔。
复用的会话行仍优先显示原生状态，空白行和归档行不显示铅笔。
其他原生行插槽贡献仍由原生浏览区渲染，停用本插件即可恢复。

## 「你在被做成表」彩蛋模式

在独立插件详情页（`plugins.bundle.config`）打开 **你在被做成表** 后，开关状态作为客户端偏好保存在 `localStorage` 中，
并经由 `shell.overlay` 生效（聚合包自动提取成员的 `plugins.bundle.config` 注册）：

- 客户端通过样式规则将插件卡片、详情页和拖放提示中的眼睛图标替换为手表，并把分区标题、提示和菜单文案切为「表会话」。
- 浏览区仅为表会话分区（`WatchedArea`）挂载 `sidebar.session.row.trailing` 与 `sidebar.session.row.hover` 插槽，
  普通列表（`SessionTree`、`FlatList`）保持原生相对时间且不触发请求。
- 运行时客户端按会话并发隔离发起 `GET /api/watched-sessions/runtime` 鉴权请求（兼容页内 `__DSH_TRANSPORT__.fetch`），
  在超时或瞬时失败时按退避策略重试，并在 `connection/reset` 时自动重置并重新拉取。
- 宿主在 [运行时长模块](../src/lib/runtime.ts) 中经由 `ctx.sessionQuery.observeSession(..., { projectionMode: 'none' })`
  汇总已结束回合时长，仅对当前存活且运行中的会话回传活跃回合起始时间，由客户端按秒跳表，
  同时保留待审批等交互标签；非 `SESSION_QUERY_SESSION_NOT_FOUND` 的单会话异常通过日志警告记录，不阻断同批其余会话。

## 分区视图

分区标题的盒模型、文字颜色、悬停反馈、
焦点环以及标题后的紧贴计数与 [后台任务侧栏](../../dsh-background-jobs-sidebar/README.zh.md) 和原生侧栏分区标题一致；
点击整个标题按钮按「全部 → 收起 → 需关注」循环切换，
沿用 [左侧栏列表三态切换](../../dsh-session-list-toggle/README.zh.md) 的循环顺序与判据。
实心箭头朝下表示展开，朝右表示收起，空心箭头表示只显示一部分。
「需关注」与该插件采用同一判据：当前会话、原生置顶、有草稿，以及等待审批、
计划审阅或回答、正在运行（含子代理）或完成未读的会话。
[会话草稿插件](../../dsh-session-draft/docs/README.md) 启用时，可选的 `sessionDraftIndicators` 服务提供草稿 ID。

视图只在当前页面内保持，刷新后回到「全部」，因为常驻会话默认应当可见。
新增常驻会话时，视图同样回到「全部」，避免刚放下的会话落进收起或筛掉的分区。
排序和取消常驻不改变视图。

折叠用 CSS grid 在零高度和自然高度之间过渡，分区整体、行列表和「需关注」下的单行都走同一机制。
收起的部分保持挂载并设为 `inert`，从焦点顺序和命中测试中移除。
列表过长时，行区域最高为视口一半并在内部滚动，这是兜底，日常用折叠控制高度。

## 拖放

从普通列表拖起会话时，分区底部展开一行与会话行同高的投放行，放下即追加到末尾；放到常驻行之间则插入到对应位置。
从常驻分区拖起时，退回提示浮在普通列表顶部，普通列表整体着色，放到其中任意位置即取消常驻。
两处提示都不改变布局，起拖时源行不会被挤离指针。投放行在起拖的下一帧才展开，
原因见 [Desktop 拖拽回归](../../../archive/tasks/2026/2026-11-23-dsh-super-pin-desktop-drag/README.md)。

### 上游来源

以下组件固定到 `@deepseek-ai/dsh-client-ui-workspace@0.2.2-rc.5`，
遵循随包分发的 [MIT 许可](../LICENSE.deepseek-harness)。

| 位置 | 上游源码和符号 |
| --- | --- |
| [浏览区](../src/client/upstream/WorkspaceBrowser.tsx) | `src/client/rows/WorkspaceBrowser.tsx` 的 `WorkspaceBrowser`、`SessionTree`、`FlatList` 和搜索视图。`src/client/tree.ts` 提供分组、过滤和排序。`src/client/stores.ts` 提供平铺排序键。 |
| [常驻分区](../src/client/watched-area.tsx) | `src/client/rows/Rows.tsx` 的 `SessionNodeItem`，`src/client/rows/WorkspaceBrowser.module.css` 的 `sessionOverflowButton` 与分区标题样式，`@deepseek-ai/dsh-client-ui-primitives` 的 `DisclosureRow`、`SearchBlock` 标题样式及 `IconTriangleRightFillRegular` 图形。 |
| [原生行操作](../src/client/browser.tsx) | `src/client/session-actions/PinSession.tsx` 和 `ArchiveSession.tsx` 的悬停按钮样式。菜单动作由宿主执行。 |

本工作区的 `@miorin/dsh-workspace-list-toggle` 提交 `b557d14` 提供 [需关注判据](../src/client/attention.ts)
和 [草稿服务连接](../src/client/drafts.ts)；标题栏布局与样式对齐 `@miorin/dsh-background-jobs-sidebar`。

[第三方依赖许可](../LICENSE.clsx)随构建产物一并打包。
