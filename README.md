# OpenCode Split View

面向 **OpenCode Desktop 2.1.2** 的多会话分屏工作台与常驻会话侧栏补丁（参考 **ZCode.app** 与 **Claude.app** 的多窗口分屏交互）。支持单屏、双屏（左 / 右）、三屏（左 / 中 / 右，最大 3 屏）并排运行独立会话，不修改后台服务、CLI、数据库或模型配置。

这不是官方发布，也不是完整 OpenCode fork。此仓库保存本次改动的完整源码文件、可应用补丁、单元测试与 E2E 测试，以及 macOS 本地 ASAR 安装与恢复工具。官方升级可能覆盖补丁。

## 核心功能

### 1. 多会话分屏工作台（`单屏` / `双屏（左/右）` / `三屏（左/中/右）`，上限 3 屏）

- **每个分屏独立挂载会话或新建草稿**：
  - 支持同时并排打开最多 3 个分屏（`左屏`、`中屏`、`右屏`），每个分屏通过独立 `@solidjs/router` 上下文（[`SplitPaneProvider`](source/packages/app/src/shell/split-view/context.tsx)）挂载各自的真实会话（[`TargetSessionRouteContent`](source/packages/app/src/shell/split-view/workbench.tsx)）或新建草稿（[`DraftRoute`](source/packages/app/src/shell/split-view/workbench.tsx)）。
  - 各分屏独立管理各自的模型选择、输入框、终端面板、代码变更查看与文件引用。在分屏中提交新建草稿后，自动在当前分屏原位晋升为正式会话。
  - 自动去重与防冲突：同一会话不会在多个分屏重复挂载；若选择已打开的会话，自动聚焦对应分屏或与目标分屏互换位置。
- **渐进式指针拖拽投递（Pointer-based Drag & Drop）**：
  - **单屏模式（`1 屏`）**：从左侧会话侧栏按住任意会话往右侧工作区拖动，工作区浮现 **放入左屏 / 放入右屏** 两列等宽可视化落点（`50% / 50%`）与跟随光标的浮动预览卡片，松手自动开启左右双屏。
  - **双屏与三屏模式（`2 屏 / 3 屏`）**：当已有两个及以上分屏时，从侧栏拖入会话自动浮现 **放入左屏 / 放入中屏 / 放入右屏** 三列可视化落点，支持顺滑扩展到左中右三屏或替换指定分屏。
  - **拖拽分屏表头互换顺序**：按住任意分屏顶部的表头栏（[`SplitPaneHeader`](source/packages/app/src/shell/split-view/workbench.tsx)）向左右拖动，即可直接调换各分屏排列顺序。
- **双入口分屏切换器与快捷键**：
  - 左侧会话栏顶部与窗口右上角标题栏均提供 [`SplitLayoutSwitcher`](source/packages/app/src/shell/split-view/workbench.tsx)（`1` 单屏 / `2` 双屏 / `3` 三屏）及 `+` 向右新增分屏按钮。
  - 快捷键：
    - `⌘⌥1`：切回单屏模式
    - `⌘⌥2`：切换左右双屏模式
    - `⌘⌥3`：切换左中右三屏模式
    - `⌘⇧\`：向右新增分屏
    - `⌘⌥[` / `⌘⌥]`：在左右相邻分屏间切换焦点
- **侧栏与标签栏深度联动**：
  - 会话行悬停右侧提供 **在分屏中打开** 图标按钮。
  - 支持按住 `Alt` / `Cmd` 点击任意会话直接在分屏中打开。
  - 会话侧栏与顶栏标签右键菜单均提供 **在分屏中打开** 及 **打开到指定分屏** 子菜单（单屏时显示 `在左屏打开 / 在右屏打开`，双屏及以上显示 `在左屏打开 / 在中屏打开 / 在右屏打开`）。
  - 多屏开启时，侧栏对应会话行实时展示 `左` / `中` / `右`（`L` / `M` / `R`）位置徽章与焦点高亮。
- **分屏表头控制与拖拽调宽**：
  - 每个分屏顶部展示位置胶囊（`左屏` / `中屏` / `右屏`）、运行状态指示器、会话标题、项目目录徽章，以及 `在此分屏新建会话`（`+`）、`分屏左移`（`←`）、`分屏右移`（`→`）、`最大化此分屏`、`关闭此分屏`（`×`）按钮。
  - 分屏之间内置 [`SplitColumnResizer`](source/packages/app/src/shell/split-view/workbench.tsx)，支持拖拽自由调整各列宽度比例（单列最小占比 `18%`），双击分隔条一键恢复等宽，窗口布局自动持久化到 `split-view.v1`。
- **焦点作用域隔离（Focus Scope Guard）**：
  - 通过 [`CommandFocusScopeProvider`](source/packages/app/src/shell/commands/command.tsx) 与 [`useSplitPane`](source/packages/app/src/shell/split-view/context.tsx) 隔离多屏同时挂载时的全局快捷键、粘贴附件（`paste`）、拖拽文件上传、自动抢焦点与顶栏右侧按钮注入，仅当前聚焦分屏响应全局会话指令。

### 2. 常驻会话侧栏（Session Sidebar）

- **紧凑高密度顶部导航**：整合 `+ 新建会话`、分屏切换器与侧栏折叠切换按钮，提供搜索框、当前视图胶囊徽章与级联筛选菜单（`分组方式` / `排序方式` / `时间范围` / `按项目筛选` / `显示项` / `仅看已归档` / `全部标为已读` / `重置筛选`）。
- **置顶会话区与多维分组**：支持 `已置顶` 分区，以及 `按状态`（待确认、运行中、空闲）、`按项目`、`按时间`、`不分组` 四种视图切换。
- **标题净化与批量已读**：自动净化底层协议 JSON 标题，支持未载入内存的历史未读会话一键 `POST /api/session/:id/view` 批量标为已读。

内置英文（`en`）、简体中文（`zh`）与繁体中文（`zht`）完整国际化文案。

## 来源与授权

源码基于 [anomalyco/opencode](https://github.com/anomalyco/opencode) 的 `v2.1.2`，固定 commit 为 `a517687fde98a7329ada3ae644a01a9fc6c4e99e`。

会话侧栏部分参考了 [mv2a/opencode 的 sessions-by-state 实现](https://github.com/mv2a/opencode/tree/faaf2ece89d783faf2d02c330e4b86b23b240104/packages/gui-extensions/src/sessions)，多会话分屏工作台（`packages/app/src/shell/split-view/`）为面向 OpenCode Desktop 2.1.2 的原生实现。

上游及参考仓库均采用 MIT License，原始版权声明保留在 [LICENSE](LICENSE)。

## 文件布局

- `source/`：全部改动文件与新增文件的最终版本，沿用上游相对路径（核心分屏实现位于 `source/packages/app/src/shell/split-view/`）。
- `patches/tracked.patch`：上游已有跟踪文件的差异补丁。
- `tools/apply.py`：校验固定基线后应用已有文件差异并复制新增源码文件。
- `tools/manage.py`：macOS 本地 ASAR `prepare` / `install` / `restore` 工具。
- `docs/verification.md`：类型检查、单元测试、Playwright E2E 测试与本机安装验证记录。

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
bun test src/shell/split-view/model.test.ts src/shell/session-sidebar/model.test.ts
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
