# 验证记录

验证基线为官方 OpenCode 2.1.2，commit `a517687fde98a7329ada3ae644a01a9fc6c4e99e`（不含 `opencode-session-sidebar`）。环境为 macOS arm64、Bun、系统 Chromium / Electron。

## 已通过

- **零 `session-sidebar` 依赖核查**：
  - `rg "session-sidebar|sessionSidebar" packages/app/src` 命中数为 `0`。
  - `python3 tools/apply.py` 在干净的 `a517687fde98a7329ada3ae644a01a9fc6c4e99e` 基线上直接应用成功（16 个跟踪文件补丁 + 4 个 `src/shell/split-view/*` 新增文件）。
- **`packages/app` 类型检查**：
  - `bun typecheck`（`tsc -b` 0 errors）。
- **分屏状态机单元测试（6 pass / 0 fail，41 assertions）**：
  - `src/shell/split-view/model.test.ts`：
    - 最大 3 屏（`左屏` / `中屏` / `右屏`）上限约束与比例归一化。
    - `1 -> 2 -> 3` 屏扩展与保留焦点面板收缩（`3 -> 2 -> 1`）。
    - `openInSplitPane` 在指定位置（`left` / `middle` / `right`）打开会话、自动去重与面板位置移动。
    - `openInFocusedPane` 与 `openInSpecificPane` 跨屏去重与面板互换。
    - `moveSplitPane`、`focusAdjacentSplitPane`、`closeSplitPane` 及 `resizePairRatios` 拖拽调宽比例钳制（`MIN_SPLIT_RATIO = 0.18`）。
    - `promoteDraftInSplitView` 新建会话草稿在当前分屏原位晋升为正式会话。
- **Playwright 端到端浏览器回归测试（`e2e/regression/tabs.spec.ts`）**：
  - `split view works standalone with vanilla titlebar tabs without session-sidebar`（passed）：
    - 在无 `opencode-session-sidebar` 的原生顶栏标签布局下，验证顶栏右侧分屏切换器（`1 / 2 / 3 / +`）可见。
    - 单屏模式（`count = 1`）下从顶栏按住 `Tab B` 向下拖入工作区，验证仅展示 2 个落点区域（`放入左屏` / `放入右屏`）且原左屏保持 `Tab A` 不被切走，松手后进入左右双屏（`Left = Tab A session`、`Right = Tab B session`），且原生顶栏标签显示分屏位置徽章（`L` / `R`）。
    - 双屏模式（`count = 2`）下从顶栏按住 `Tab C` 向下拖入工作区，验证自动展示 3 个落点区域（`放入左屏` / `放入中屏` / `放入右屏`），拖入中屏后扩展为左中右三屏（`Left = Tab A session`、`Middle = Tab C session`、`Right = Tab B session`）。
- **桌面端生产构建与本机 ASAR 安装验证**：
  - `packages/desktop` 执行 `OPENCODE_VERSION=2.1.2 OPENCODE_CHANNEL=latest bun x --no-install electron-vite build` 构建通过。
  - `tools/manage.py prepare` 与 `tools/manage.py install` 校验 6449 个非 renderer 文件 offset / SHA256 不变，更新 `Info.plist` 的 `ElectronAsarIntegrity` 并通过 `codesign --verify --deep --strict /Applications/OpenCode.app`。
