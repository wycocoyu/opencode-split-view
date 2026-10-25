# 验证记录

验证基线为官方 OpenCode 2.1.2，commit `a517687fde98a7329ada3ae644a01a9fc6c4e99e`。环境为 macOS arm64、Bun、系统 Chromium / Electron。

## 已通过

- **`packages/app` 类型检查**：
  - `bun typecheck`（`tsc -b` 0 errors）。
- **分屏状态机与会话侧栏单元测试（25 pass / 0 fail）**：
  - `src/shell/split-view/model.test.ts`（6 pass，41 assertions）：
    - 最大 3 屏（`左屏` / `中屏` / `右屏`）上限约束与比例归一化。
    - `1 -> 2 -> 3` 屏扩展与保留焦点面板收缩（`3 -> 2 -> 1`）。
    - `openInSplitPane` 在指定位置（`left` / `middle` / `right`）打开会话、自动去重与面板位置移动。
    - `openInFocusedPane` 与 `openInSpecificPane` 跨屏去重与面板互换。
    - `moveSplitPane`、`focusAdjacentSplitPane`、`closeSplitPane` 及 `resizePairRatios` 拖拽调宽比例钳制（`MIN_SPLIT_RATIO = 0.18`）。
    - `promoteDraftInSplitView` 新建会话草稿在当前分屏原位晋升为正式会话。
  - `src/shell/session-sidebar/model.test.ts`（19 pass）。
- **Playwright 端到端浏览器回归测试（`e2e/regression/tabs.spec.ts`）**：
  - `split view supports dragging sessions into left/middle/right panes and dragging pane headers to reorder`（passed）：
    - 单屏模式（`count = 1`）下按住侧栏会话拖入工作区，验证仅展示 2 个落点区域（`放入左屏` / `放入右屏`，`data-zone-count="2"`）及浮动拖拽预览卡片，松手后进入左右双屏（`Left = Tab A session`、`Right = Tab B session`）。
    - 双屏模式（`count = 2`）下按住侧栏第 3 个会话拖入工作区，验证自动展示 3 个落点区域（`放入左屏` / `放入中屏` / `放入右屏`，`data-zone-count="3"`），拖入中屏后扩展为左中右三屏（`Left = Tab A session`、`Middle = Tab C session`、`Right = Tab B session`）。
    - 按住左屏顶部表头（`split-pane-header`）拖到右侧落点，验证三屏顺序重排为 `Tab C session` / `Tab B session` / `Tab A session`。
  - `session sidebar groups history and restores the original tab layout`（passed）。
- **桌面端生产构建与本机 ASAR 安装验证**：
  - `packages/desktop` 执行 `OPENCODE_VERSION=2.1.2 OPENCODE_CHANNEL=latest bun x --no-install electron-vite build` 构建通过。
  - `tools/manage.py prepare` 与 `tools/manage.py install` 校验 6449 个非 renderer 文件 offset / SHA256 不变，更新 `Info.plist` 的 `ElectronAsarIntegrity` 并通过 `codesign --verify --deep --strict /Applications/OpenCode.app`。
  - 重启 `/Applications/OpenCode.app` 后在真实桌面端完成单屏／双屏／三屏切换、侧栏指针拖拽分屏、表头拖拽换位与分隔线调宽验收。
