# OpenCode Split View

面向 **OpenCode Desktop 2.1.2** 的**独立多会话分屏工作台**补丁（参考 **ZCode.app** 与 **Claude.app** 的多窗口分屏交互）。支持单屏、双屏（左 / 右）、三屏（左 / 中 / 右，最大 3 屏）并排运行独立会话，不修改后台服务、CLI、数据库或模型配置。

> **完全独立，零侧栏依赖**：本仓库与 `opencode-session-sidebar` 完全解耦，不依赖任何 `session-sidebar` 文件。基于官方原版 OpenCode 2.1.2 的水平顶栏标签或纵向标签栏即可独立完成全部多会话分屏交互（同时亦无缝兼容 `opencode-session-sidebar`）。

这不是官方发布，也不是完整 OpenCode fork。此仓库保存本次改动的完整源码文件、可应用补丁、单元测试与 E2E 测试，以及 macOS 本地 ASAR 安装与恢复工具。官方升级可能覆盖补丁。

## 核心功能

### 1. 多会话分屏工作台（`单屏` / `双屏（左/右）` / `三屏（左/中/右）`，上限 3 屏）

- **每个分屏独立挂载会话或新建草稿**：
  - 支持同时并排打开最多 3 个分屏（`左屏`、`中屏`、`右屏`），每个分屏通过独立 `@solidjs/router` 上下文（[`SplitPaneProvider`](source/packages/app/src/shell/split-view/context.tsx)）挂载各自的真实会话（[`TargetSessionRouteContent`](source/packages/app/src/shell/split-view/workbench.tsx)）或新建草稿（[`DraftRoute`](source/packages/app/src/shell/split-view/workbench.tsx)）。
  - 各分屏独立管理各自的模型选择、输入框、终端面板、代码变更查看与文件引用。在分屏中提交新建草稿后，自动在当前分屏原位晋升为正式会话。
  - 自动去重与防冲突：同一会话不会在多个分屏重复挂载；若选择已打开的会话，自动聚焦对应分屏或与目标分屏互换位置。
- **多组独立分屏（Independent Split Groups）与点击只切视图**：
  - 支持同时保存多组互不干扰的分屏组合（`groups: SplitViewGroup[]`，例如 `[会话 A | 会话 B]` 一组双屏、`[会话 C | 会话 D]` 另一组双屏，其余会话保持单屏）。
  - **普通点击只切换视图，不覆盖已有分屏**：当 `[会话 A | 会话 B]` 处于双屏模式时，即使先点击了左屏再点击侧栏或顶栏里的单屏 `会话 C`，`[会话 A | 会话 B]` 的分屏组合完好保留在后台，工作区直接切换为 `会话 C` 的独立单屏视图；再次点击 `会话 A` 或 `会话 B` 时，立即恢复 `[会话 A | 会话 B]` 双屏组合并聚焦所点分屏。
  - **跨组拆合与实时徽章区分**：将已属于某分屏组的会话拖入新分屏时，自动从原分屏组移出（原分屏组若仅剩 1 个会话则自动恢复单屏）；当前激活分屏组的会话显示高亮位置徽章（`左` / `中` / `右`，`data-active-group="true"`），后台分屏组的会话显示柔和半透明徽章（`data-active-group="false"`）。
- **渐进式指针拖拽投递（Pointer-based Drag & Drop）**：
  - **单屏模式（`1 屏`）**：从原版水平顶栏或纵向标签栏按住任意会话标签向工作区拖动（[`handleTabSplitPointerDown`](source/packages/app/src/shell/titlebar/tab-nav.tsx)），工作区浮现 **放入左屏 / 放入右屏** 两列等宽可视化落点（`50% / 50%`）与跟随光标的浮动预览卡片，松手自动开启左右双屏。
  - **双屏与三屏模式（`2 屏 / 3 屏`）**：当已有两个及以上分屏时，拖入会话标签自动浮现 **放入左屏 / 放入中屏 / 放入右屏** 三列可视化落点，支持顺滑扩展到左中右三屏或替换指定分屏。
  - **拖拽分屏表头互换顺序**：按住任意分屏顶部的表头栏（[`SplitPaneHeader`](source/packages/app/src/shell/split-view/workbench.tsx)）向左右拖动，即可直接调换各分屏排列顺序。
- **双入口分屏切换器与快捷键**：
  - 原版水平顶栏右侧与纵向标签栏顶部均内置 [`SplitLayoutSwitcher`](source/packages/app/src/shell/split-view/workbench.tsx)（`1` 单屏 / `2` 双屏 / `3` 三屏）及 `+` 向右新增分屏按钮。
  - 快捷键：
    - `⌘⌥1`：切回单屏模式
    - `⌘⌥2`：切换左右双屏模式
    - `⌘⌥3`：切换左中右三屏模式
    - `⌘⇧\`：向右新增分屏
    - `⌘⌥[` / `⌘⌥]`：在左右相邻分屏间切换焦点
- **原生标签栏深度联动**：
  - 支持按住 `Alt` / `Cmd` 点击任意顶栏或纵向标签直接在分屏中打开。
  - 原生标签右键菜单提供 **在分屏中打开** 及 **打开到指定分屏** 子菜单（单屏时显示 `在左屏打开 / 在右屏打开`，双屏及以上显示 `在左屏打开 / 在中屏打开 / 在右屏打开`）。
  - 多屏开启时，原生标签上实时展示 `左` / `中` / `右`（`L` / `M` / `R`）位置徽章。
- **分屏表头控制与拖拽调宽**：
  - 每个分屏顶部展示位置胶囊（`左屏` / `中屏` / `右屏`）、运行状态指示器、会话标题、项目目录徽章，以及 `在此分屏新建会话`（`+`）、`分屏左移`（`←`）、`分屏右移`（`→`）、`最大化此分屏`、`关闭此分屏`（`×`）按钮。
  - 分屏之间内置 [`SplitColumnResizer`](source/packages/app/src/shell/split-view/workbench.tsx)，支持拖拽自由调整各列宽度比例（单列最小占比 `18%`），双击分隔条一键恢复等宽，窗口布局自动持久化到 `split-view.v1`。
- **焦点作用域隔离（Focus Scope Guard）**：
  - 通过 [`CommandFocusScopeProvider`](source/packages/app/src/shell/commands/command.tsx) 与 [`useSplitPane`](source/packages/app/src/shell/split-view/context.tsx) 隔离多屏同时挂载时的全局快捷键、粘贴附件（`paste`）、拖拽文件上传、自动抢焦点与顶栏右侧按钮注入，仅当前聚焦分屏响应全局会话指令。

内置英文（`en`）、简体中文（`zh`）与繁体中文（`zht`）完整国际化文案。

## 来源与授权

源码基于 [anomalyco/opencode](https://github.com/anomalyco/opencode) 的 `v2.1.2`，固定 commit 为 `a517687fde98a7329ada3ae644a01a9fc6c4e99e`。

多会话分屏工作台（`packages/app/src/shell/split-view/`）为面向 OpenCode Desktop 2.1.2 的原生实现，采用 MIT License，原始版权声明保留在 [LICENSE](LICENSE)。

## 文件布局

- `source/`：全部 20 个改动与新增源码文件（纯分屏实现，不含任何 `session-sidebar` 文件）。
- `patches/tracked.patch`：上游已有 16 个跟踪文件的差异补丁。
- `tools/apply.py`：校验固定基线后应用已有文件差异并复制 4 个新增源码文件（`packages/app/src/shell/split-view/*`）。
- `tools/manage.py`：macOS 本地 ASAR `prepare` / `install` / `restore` 工具。
- `docs/verification.md`：独立类型检查、单元测试、Playwright E2E 测试与本机安装验证记录。

## 应用源码改动

先克隆官方仓库并切到固定基线。目标 checkout 必须干净：

```sh
git clone https://github.com/anomalyco/opencode.git opencode
git -C opencode checkout a517687fde98a7329ada3ae644a01a9fc6c4e99e
python3 tools/apply.py /path/to/opencode
```

在 `packages/app` 内执行类型检查与测试：

```sh
cd /path/to/opencode/packages/app
bun typecheck
bun test src/shell/split-view/model.test.ts
bun x playwright test e2e/regression/tabs.spec.ts -g "split view works standalone with vanilla titlebar tabs without session-sidebar"
```

构建桌面端 renderer：

```sh
cd /path/to/opencode/packages/desktop
OPENCODE_VERSION=2.1.2 OPENCODE_CHANNEL=latest bun x --no-install electron-vite build
```

## 安装与恢复边界

**`tools/manage.py` 是面向本机 `/Applications/OpenCode.app`（2.1.2）的安装与恢复工具。** 它要求事先完成原应用备份，并在 `tools/current-backup.txt` 中写入备份目录绝对路径，且备份目录内包含 `Resources/app.asar`、`Info.plist`、`_CodeSignature/` 与 `manifest.json`（记录原始 `asar_sha256`）。

```sh
python3 tools/manage.py prepare --renderer /path/to/opencode/packages/desktop/out/renderer
python3 tools/manage.py install
# 需要撤回时
python3 tools/manage.py restore
```

安装完成后重启 `/Applications/OpenCode.app` 桌面端窗口即可加载新 ASAR（无需重启后台 `opencode serve --service` 守护进程或终端 CLI 会话）。
