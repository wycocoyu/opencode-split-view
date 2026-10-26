# OpenCode Split View 架构与状态机设计

本文档记录 `opencode-split-view`（面向 **OpenCode Desktop 2.1.2**，基线 commit `a517687fde98a7329ada3ae644a01a9fc6c4e99e`）的核心架构、多组独立分屏状态机、路由上下文隔离与拖拽投递实现。

---

## 1. 模块职责划分

| 文件路径 | 核心职责 |
|---|---|
| `packages/app/src/shell/split-view/model.ts` | 纯函数分屏状态机：负责 `1 / 2 / 3` 屏数量约束（`MAX_SPLIT_PANES = 3`）、多组独立分屏（`groups: SplitViewGroup[]`）保存与切换、非破坏性会话导航（`navigateToTarget`）、跨组拖拽拆合、列宽比例归一化与钳制（`MIN_SPLIT_RATIO = 0.18`）。 |
| `packages/app/src/shell/split-view/model.test.ts` | 状态机单元测试（覆盖上限约束、比例缩放、去重互换、草稿原位晋升、多组独立分屏与非破坏性点击切换）。 |
| `packages/app/src/shell/split-view/context.tsx` | SolidJS 分屏上下文（`SplitViewProvider`）与单屏路由虚拟化层（`SplitPaneProvider`）：负责状态持久化（`split-view.v1`）、主路由与当前激活分屏双向同步、全局指针拖拽会话与表头落点计算、分屏级 `@solidjs/router` 参数与导航拦截。 |
| `packages/app/src/shell/split-view/workbench.tsx` | 分屏工作台视图组件：渲染 `SplitLayoutSwitcher`（`1 / 2 / 3 / +` 切换器）、`SplitPaneHeader`（分屏顶部控制栏）、`SplitColumnResizer`（分屏间拖拽分隔条）、渐进式拖拽落点浮层（单屏 2 落点／多屏 3 落点）及各分屏会话／草稿容器。 |
| `packages/app/src/shell/commands/command.tsx` | 焦点作用域守卫（`CommandFocusScopeProvider`）：当多个会话面板同时挂载时，仅允许当前聚焦分屏（`focused()`）注册并响应会话级全局快捷键与命令面板动作。 |
| `packages/app/src/shell/titlebar/tab-nav.tsx` | 原版水平／纵向标签栏联动：支持从标签栏向下／向右指针拖拽进分屏、按住 `Alt` / `Cmd` 点击分屏打开、右键菜单打开到指定分屏，以及渲染激活组／后台组位置徽章（`左 / 中 / 右`）。 |

---

## 2. 多组独立分屏状态机（Independent Split Groups）

### 2.1 持久化数据结构

状态持久化于 `Persist.global("split-view.v1")`：

```ts
export type SplitViewGroup = {
  id: string
  count: 2 | 3
  order: string[]
  focusedPaneId: string
  ratios: number[]
  byId: Record<string, SplitPaneTarget>
}

export type SplitViewPersisted = {
  count: 1 | 2 | 3
  order: string[]
  focusedPaneId: string
  ratios: number[]
  byId: Record<string, SplitPaneTarget>
  groups?: SplitViewGroup[]
}
```

- **稳定面板 ID（`order` + `byId` 分离）**：工作台使用 `<For each={split.order()}>` 渲染面板，`paneId` 为稳定字符串（如 `"pane-0"`、`"pane-1"`、`"pane-2"`）。当某个面板切换会话或左右互换顺序时，SolidJS 仅更新信号或移动 DOM 节点，**不会卸载重建其他存活面板**。
- **多组独立分屏（`groups: SplitViewGroup[]`）**：每当工作台处于 `count >= 2` 的双屏或三屏状态时，当前分屏组合通过 `syncActiveGroupIntoGroups()` 实时同步到 `groups` 列表中。可同时存在多个互不重叠的分屏组（如 `[会话 A | 会话 B]` 双屏组与 `[会话 C | 会话 D]` 双屏组）。

### 2.2 非破坏性会话切换（`navigateToTarget`）

用户在侧栏或顶栏标签栏**普通左键点击**某个会话 `T` 时，不再覆盖当前聚焦分屏的槽位，而是执行 `navigateToTarget(raw, target)`：

```
用户普通点击会话 T
  ↓
1. 检查 T 是否已在当前激活的视图（raw.order）中？
  ├─ 是 → 直接将 focusedPaneId 切到 T 所在的分屏（保持当前分屏布局不变）
  └─ 否 → 先调用 syncActiveGroupIntoGroups(raw) 将当前多屏组合保存到 groups
            ↓
          2. 检查 T 是否属于 groups 中的某个后台分屏组 G？
            ├─ 是 → 激活分屏组 G（恢复 G 的 count / order / ratios / byId），并将焦点设在 T 所在的分屏
            └─ 否 → 切到 T 的独立单屏视图（count = 1），后台 groups 中的所有分屏组合原样保留
```

### 2.3 显式分屏与跨组拆合（`stripTargetsFromOtherGroups`）

只有当用户执行**显式分屏动作**时，才会创建或修改分屏组合：
- 拖拽会话标签／侧栏会话进入工作区左／中／右落点（`openInSplitPane`）
- 按住 `Alt` 或 `Cmd` 点击会话
- 点击会话右键菜单中的 `在分屏中打开` 或 `打开到指定分屏`
- 点击顶栏分屏切换器 `2` / `3` / `+`（`setSplitPaneCount` / `addSplitPane`）

若被拖入新分屏的会话原先属于后台另一个分屏组 `G_old`，`stripTargetsFromOtherGroups()` 会自动将该会话从 `G_old` 移除：
- 若 `G_old` 原本是 3 屏，移除后剩余 2 个会话保持双屏组并重新归一化宽度比例。
- 若 `G_old` 原本是 2 屏，移除后仅剩 1 个会话，则自动解散 `G_old`，剩余会话回到普通单屏状态。

### 2.4 激活组与后台组徽章（`sessionSplitBadge`）

`sessionSplitBadge(raw, sessionKey)` 为每个会话计算分屏位置徽章：
- 若会话位于当前正在展示的多屏组合中，返回 `{ index, count, activeGroup: true }`，界面渲染高亮强调色徽章（`data-active-group="true"`）。
- 若会话位于后台保存的某个 `SplitViewGroup` 中，返回 `{ index, count, activeGroup: false }`，界面渲染柔和半透明徽章（`data-active-group="false"`），提示用户点击该会话即可恢复对应分屏组。

---

## 3. 分屏级 `@solidjs/router` 路由虚拟化

OpenCode 原生 `TargetSessionRouteContent` 与 `DraftRoute` 强依赖 `@solidjs/router` 的 `useParams()`、`useLocation()` 与 `useNavigate()`。

为了在不改动业务组件内部逻辑的前提下支持 3 个分屏同时挂载不同项目／不同会话，`SplitPaneProvider` 在每个分屏子树外层包裹了一个定制的 `RouterContext.Provider`：
- **重写 `params`**：根据当前分屏绑定的 `SplitPaneTarget` 动态提供 `{ serverKey, id }`。
- **重写 `location`**：动态合成当前分屏专属的 `pathname`（`/:serverKey/session/:id` 或 `/:serverKey/new`）与 `query.draftId`（草稿分屏使用独立 `draftKey`）。
- **重写 `navigate`**：
  - 若是草稿提交后触发 `replace: true` 跳转到新创建的会话路由，自动调用 `promoteDraftPane(paneId, target)` 在当前分屏原位晋升为正式会话。
  - 若是分屏内部触发的常规会话跳转且当前分屏已聚焦，同步更新主路由；若当前分屏未聚焦，仅更新该分屏自身的 `SplitPaneTarget`。

---

## 4. 渐进式指针拖拽引擎（Progressive Pointer Drag & Drop）

1. **为什么使用指针事件（`pointerdown` / `pointermove` / `pointerup`）而非原生 HTML5 Drag & Drop**：
   - Electron 桌面端在全局 `select-none` 样式下对 `<button>` 元素的原生 `dragstart` 触发不稳定。
   - 原生顶栏 `TitlebarTabStrip` 内部使用 `@dnd-kit/dom` 的 `PointerSensor` 在 `document` 上监听 `pointermove` 并调用 `event.stopPropagation()`。
   - 因此 `tab-nav.tsx` 在 `window` 捕获阶段（`{ capture: true }`）监听指针移动：当用户水平拖动标签时保留原生标签排序；当指针向下拖入工作区（`dy > 14px`）时，立即调用 `stopImmediatePropagation()` 并派发 `Escape` 取消横向排序，无缝切入分屏投递预览。
2. **按当前分屏数渐进展示落点**：
   - **当前为单屏（`count === 1`）**：拖入会话时仅展示 **放入左屏 / 放入右屏** 2 个等宽落点区域（`50% / 50%`，`data-zone-count="2"`），松手后开启左右双屏。
   - **当前为双屏或三屏（`count >= 2`）**：拖入会话时展示 **放入左屏 / 放入中屏 / 放入右屏** 3 个落点区域（`33.3% / 33.3% / 33.3%`，`data-zone-count="3"`），支持直接插入第三屏或替换指定分屏。
