import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { SetStoreFunction } from "solid-js/store"
import { useLocation } from "@solidjs/router"
import { SessionProgressIndicatorV2 } from "@opencode/session-ui/v2/session-progress-indicator-v2"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { ResizeHandle } from "@opencode/ui/resize-handle"
import { ScrollView } from "@opencode/ui/scroll-view"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, serverName, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { useCommand } from "@/shell/commands/command"
import { homeProjectDirectories } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"
import { sessionHref } from "@/shell/routes/session"
import { useOptionalSplitView } from "@/shell/split-view/context"
import { SplitLayoutSwitcher } from "@/shell/split-view/workbench"
import { useTabs } from "@/shell/tabs/tabs"
import { useDirectoryPicker } from "@/workspaces/selection/picker"
import { createServerSidebar } from "./controller"
import {
  buildPinnedRows,
  buildSessionGroups,
  formatRelativeTime,
  isRowPinned,
  normalizeSessionTitle,
  sessionSubpathLabel,
  sidebarProjectKey,
  type SidebarGroup,
  type SidebarGroupBy,
  type SidebarRow,
} from "./model"
import type { SidebarPreferencesState } from "./preferences"

const PinIcon = (props: { filled?: boolean; class?: string }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill={props.filled ? "currentColor" : "none"}
    xmlns="http://www.w3.org/2000/svg"
    class={props.class}
    aria-hidden="true"
  >
    <path
      d="M9.828 2.172a1 1 0 0 1 1.414 0l2.586 2.586a1 1 0 0 1 0 1.414l-1.758 1.758a1 1 0 0 0-.293.707v1.171a1 1 0 0 1-1.707.707L8 8.5l-3.793 3.793a.5.5 0 0 1-.707-.707L7.293 7.793 5.286 5.786a1 1 0 0 1 .707-1.707h1.171a1 1 0 0 0 .707-.293l1.957-1.614Z"
      stroke="currentColor"
      stroke-width="1.2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
)

export function SessionSidebar(props: {
  filter: SidebarPreferencesState
  setFilter: SetStoreFunction<SidebarPreferencesState>
  close: () => void
}) {
  const global = useGlobal()
  const language = useLanguage()
  const command = useCommand()
  const servers = useServers()
  const tabs = useTabs()
  const pickDirectory = useDirectoryPicker()
  let searchInputRef: HTMLInputElement | undefined

  const [rowsByServer, setRowsByServer] = createSignal<Record<string, SidebarRow[]>>({})
  const markAllReadMap = new Map<string, () => void>()

  const projects = createMemo(() => {
    const allRows = Object.values(rowsByServer()).flat()
    const unique = [
      ...new Map(
        allRows.map((row) => [
          sidebarProjectKey(row),
          {
            key: sidebarProjectKey(row),
            name: row.project.name,
            directory: row.project.directory,
            server: row.server as ServerConnection.Key,
          },
        ]),
      ).values(),
    ]
    const counts = new Map<string, number>()
    for (const item of unique) counts.set(item.name, (counts.get(item.name) ?? 0) + 1)
    return unique
      .map((item) => ({
        ...item,
        label: (counts.get(item.name) ?? 0) > 1 ? `${item.name} · ${item.directory}` : item.name,
      }))
      .sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key))
  })

  const sidebarWidth = () => Math.min(480, Math.max(220, props.filter.width || 272))

  const togglePinned = (row: SidebarRow) => {
    const current = [...(props.filter.pinned ?? [])]
    const pinned = isRowPinned(row, current)
    if (pinned) {
      props.setFilter(
        "pinned",
        current.filter((item) => item !== row.key && item !== row.session.id),
      )
    } else {
      props.setFilter("pinned", [row.key, ...current])
    }
  }

  const isGroupCollapsed = (groupId: string) => (props.filter.collapsed ?? []).includes(groupId)

  const toggleGroupCollapsed = (groupId: string) => {
    const current = [...(props.filter.collapsed ?? [])]
    if (current.includes(groupId)) {
      props.setFilter(
        "collapsed",
        current.filter((id) => id !== groupId),
      )
    } else {
      props.setFilter("collapsed", [...current, groupId])
    }
  }

  const openNewSession = () => {
    const selectedProj = projects().find((p) => p.key === props.filter.project)
    if (selectedProj) {
      void tabs.newDraft({ server: selectedProj.server, directory: selectedProj.directory }, "")
      return
    }
    command.trigger("tab.new")
  }

  const addNewProject = () => {
    const conn = servers.visible[0] ?? servers.list[0]
    if (!conn) return
    pickDirectory({
      server: conn,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: (result) => {
        const dirs = homeProjectDirectories(result)
        const ctx = global.ensureServerCtx(conn)
        for (const dir of dirs) {
          ctx.projects.open(dir)
          ctx.projects.touch(dir)
        }
        if (dirs[0]) {
          void tabs.newDraft({ server: ServerConnection.key(conn), directory: dirs[0] }, "")
        }
      },
    })
  }

  const hasActiveFilters = () =>
    props.filter.status === "archived" || props.filter.days > 0 || !!props.filter.project

  const resetAllFilters = () => {
    props.setFilter("status", "active")
    props.setFilter("days", 0)
    props.setFilter("project", "")
    props.setFilter("search", "")
  }

  const markAllServersRead = () => {
    for (const fn of markAllReadMap.values()) fn()
  }

  const groupBadgeLabel = () => {
    if (props.filter.groupBy === "state") return language.t("sessionSidebar.group.state")
    if (props.filter.groupBy === "project") return language.t("sessionSidebar.group.project")
    if (props.filter.groupBy === "time") return language.t("sessionSidebar.group.time")
    return language.t("sessionSidebar.group.none")
  }

  const periodLabel = (days: number) => {
    if (days === 1) return language.t("sessionSidebar.day")
    if (days === 7) return language.t("sessionSidebar.week")
    if (days === 30) return language.t("sessionSidebar.month")
    return language.t("sessionSidebar.allTime")
  }

  return (
    <aside
      aria-label={language.t("sessionSidebar.title")}
      data-slot="session-sidebar"
      class="relative flex h-full min-h-0 shrink-0 flex-col bg-v2-background-bg-deep ps-2.5 pe-0 pt-[var(--shell-top-inset,8px)] pb-[var(--shell-bottom-inset,8px)] [font-family:var(--v2-font-family-sans)]"
      style={{
        width: `${sidebarWidth()}px`,
      }}
    >
      <ResizeHandle
        class="-end-2"
        direction="horizontal"
        size={sidebarWidth()}
        min={220}
        max={480}
        onResize={(width) => props.setFilter("width", width)}
      />

      {/* Hidden native selects preserve full programmatic compatibility for accessibility and automated tests */}
      <div class="sr-only" aria-hidden="false">
        <select
          aria-label={language.t("sessionSidebar.groupBy")}
          tabIndex={-1}
          value={props.filter.groupBy}
          onChange={(event) => props.setFilter("groupBy", event.currentTarget.value as SidebarGroupBy)}
        >
          <option value="state">{language.t("sessionSidebar.group.state")}</option>
          <option value="project">{language.t("sessionSidebar.group.project")}</option>
          <option value="time">{language.t("sessionSidebar.group.time")}</option>
          <option value="none">{language.t("sessionSidebar.group.none")}</option>
        </select>
        <select
          aria-label={language.t("sessionSidebar.status")}
          tabIndex={-1}
          value={props.filter.status}
          onChange={(event) =>
            props.setFilter("status", event.currentTarget.value === "archived" ? "archived" : "active")
          }
        >
          <option value="active">{language.t("sessionSidebar.active")}</option>
          <option value="archived">{language.t("sessionSidebar.archived")}</option>
        </select>
        <select
          aria-label={language.t("sessionSidebar.project")}
          tabIndex={-1}
          value={props.filter.project}
          onChange={(event) => props.setFilter("project", event.currentTarget.value)}
        >
          <option value="">{language.t("sessionSidebar.allProjects")}</option>
          <For each={projects()}>{(project) => <option value={project.key}>{project.label}</option>}</For>
        </select>
        <select
          aria-label={language.t("sessionSidebar.period")}
          tabIndex={-1}
          value={String(props.filter.days)}
          onChange={(event) => props.setFilter("days", Number(event.currentTarget.value))}
        >
          <option value="0">{language.t("sessionSidebar.allTime")}</option>
          <option value="1">{language.t("sessionSidebar.day")}</option>
          <option value="7">{language.t("sessionSidebar.week")}</option>
          <option value="30">{language.t("sessionSidebar.month")}</option>
        </select>
        <select
          aria-label={language.t("sessionSidebar.sort")}
          tabIndex={-1}
          value={props.filter.sort}
          onChange={(event) =>
            props.setFilter("sort", event.currentTarget.value === "created" ? "created" : "updated")
          }
        >
          <option value="updated">{language.t("sessionSidebar.updated")}</option>
          <option value="created">{language.t("sessionSidebar.created")}</option>
        </select>
      </div>

      {/* Top Primary Action Bar */}
      <div class="flex flex-col gap-2 ps-1 pe-2 pb-2">
        <div class="flex items-center gap-1">
          <button
            type="button"
            data-action="sidebar-new-session"
            onClick={openNewSession}
            class="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-v2-border-border-base/80 bg-v2-background-bg-base/80 px-2.5 text-[13px] leading-4 [font-weight:520] text-v2-text-text-base shadow-2xs transition-colors hover:border-v2-border-border-strong hover:bg-v2-overlay-simple-overlay-hover active:bg-v2-overlay-simple-overlay-pressed"
          >
            <Icon name="plus" size="small" class="shrink-0 text-v2-icon-icon-base" />
            <span class="min-w-0 flex-1 truncate text-start">{language.t("command.session.new")}</span>
            <Show when={command.keybind("tab.new")}>
              <span class="shrink-0 rounded bg-v2-background-bg-deep/80 px-1.5 py-0.5 font-mono text-[10px] leading-3 text-v2-text-text-faint">
                {command.keybind("tab.new").split(",")[0]?.trim()}
              </span>
            </Show>
          </button>

          <SplitLayoutSwitcher compact />

          <Tooltip placement="bottom" value={language.t("sessionSidebar.restore")}>
            <IconButton
              type="button"
              variant="ghost-muted"
              size="normal"
              icon={<Icon name="sidebar" size="small" />}
              aria-label={language.t("sessionSidebar.restore")}
              onClick={props.close}
            />
          </Tooltip>
        </div>

        {/* Sleek Search Input */}
        <div class="relative flex h-7 items-center gap-1.5 rounded-lg border border-v2-border-border-base/70 bg-v2-background-bg-base/60 px-2 transition-colors focus-within:border-v2-border-border-focus focus-within:bg-v2-background-bg-base">
          <Icon name="magnifying-glass" size="small" class="shrink-0 text-v2-icon-icon-faint" />
          <input
            ref={searchInputRef}
            type="search"
            aria-label={language.t("sessionSidebar.search")}
            placeholder={language.t("sessionSidebar.search")}
            value={props.filter.search}
            onInput={(event) => props.setFilter("search", event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && props.filter.search) {
                event.preventDefault()
                props.setFilter("search", "")
              }
            }}
            class="min-w-0 flex-1 bg-transparent text-[12px] leading-4 text-v2-text-text-base placeholder:text-v2-text-text-faint focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          <Show when={props.filter.search}>
            <button
              type="button"
              onClick={() => {
                props.setFilter("search", "")
                searchInputRef?.focus()
              }}
              class="flex size-4 shrink-0 items-center justify-center rounded text-v2-icon-icon-faint hover:text-v2-text-text-base"
            >
              <Icon name="xmark-small" size="small" />
            </button>
          </Show>
        </div>

        {/* Conversations Header & Filter/Group Toolbar (ATG + ZCode style) */}
        <div class="flex items-center justify-between gap-1 pt-0.5 ps-1 pe-0.5">
          <div class="flex min-w-0 items-center gap-1.5">
            <h2 class="truncate text-[12px] leading-4 font-medium text-v2-text-text-muted">
              {language.t("sessionSidebar.title")}
            </h2>
            <span class="rounded bg-v2-overlay-simple-overlay-hover px-1.5 py-0.5 text-[10px] leading-3 text-v2-text-text-faint">
              {groupBadgeLabel()}
            </span>
          </div>

          <div class="flex shrink-0 items-center gap-0.5">
            {/* Cascading Filter & View Options Menu (ATG style) */}
            <Menu appearance="compact" placement="bottom-end">
              <Tooltip placement="bottom" value={language.t("sessionSidebar.filterMenu")}>
                <Menu.Trigger
                  as="button"
                  type="button"
                  data-action="sidebar-filter-menu"
                  aria-label={language.t("sessionSidebar.filterMenu")}
                  class="relative flex size-6 items-center justify-center rounded-md text-v2-icon-icon-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base data-[expanded]:bg-v2-overlay-simple-overlay-hover data-[expanded]:text-v2-text-text-base"
                >
                  <Icon name="sliders" size="small" />
                </Menu.Trigger>
              </Tooltip>
              <Menu.Portal>
                <Menu.Content class="min-w-[200px] [font-family:var(--v2-font-family-sans)]">
                  <Menu.Sub>
                    <Menu.SubTrigger badge={groupBadgeLabel()}>
                      {language.t("sessionSidebar.groupBy")}
                    </Menu.SubTrigger>
                    <Menu.Portal>
                      <Menu.SubContent class="min-w-[160px] [font-family:var(--v2-font-family-sans)]">
                        <Menu.RadioGroup
                          value={props.filter.groupBy}
                          onChange={(value) => props.setFilter("groupBy", value as SidebarGroupBy)}
                        >
                          <Menu.RadioItem value="state">{language.t("sessionSidebar.group.state")}</Menu.RadioItem>
                          <Menu.RadioItem value="project">{language.t("sessionSidebar.group.project")}</Menu.RadioItem>
                          <Menu.RadioItem value="time">{language.t("sessionSidebar.group.time")}</Menu.RadioItem>
                          <Menu.RadioItem value="none">{language.t("sessionSidebar.group.none")}</Menu.RadioItem>
                        </Menu.RadioGroup>
                      </Menu.SubContent>
                    </Menu.Portal>
                  </Menu.Sub>

                  <Menu.Sub>
                    <Menu.SubTrigger
                      badge={
                        props.filter.sort === "created"
                          ? language.t("sessionSidebar.created")
                          : language.t("sessionSidebar.updated")
                      }
                    >
                      {language.t("sessionSidebar.sort")}
                    </Menu.SubTrigger>
                    <Menu.Portal>
                      <Menu.SubContent class="min-w-[160px] [font-family:var(--v2-font-family-sans)]">
                        <Menu.RadioGroup
                          value={props.filter.sort}
                          onChange={(value) =>
                            props.setFilter("sort", value === "created" ? "created" : "updated")
                          }
                        >
                          <Menu.RadioItem value="updated">{language.t("sessionSidebar.updated")}</Menu.RadioItem>
                          <Menu.RadioItem value="created">{language.t("sessionSidebar.created")}</Menu.RadioItem>
                        </Menu.RadioGroup>
                      </Menu.SubContent>
                    </Menu.Portal>
                  </Menu.Sub>

                  <Menu.Separator />

                  <Menu.Sub>
                    <Menu.SubTrigger badge={props.filter.days > 0 ? periodLabel(props.filter.days) : undefined}>
                      {language.t("sessionSidebar.period")}
                    </Menu.SubTrigger>
                    <Menu.Portal>
                      <Menu.SubContent class="min-w-[160px] [font-family:var(--v2-font-family-sans)]">
                        <Menu.RadioGroup
                          value={String(props.filter.days)}
                          onChange={(value) => props.setFilter("days", Number(value))}
                        >
                          <Menu.RadioItem value="0">{language.t("sessionSidebar.allTime")}</Menu.RadioItem>
                          <Menu.RadioItem value="1">{language.t("sessionSidebar.day")}</Menu.RadioItem>
                          <Menu.RadioItem value="7">{language.t("sessionSidebar.week")}</Menu.RadioItem>
                          <Menu.RadioItem value="30">{language.t("sessionSidebar.month")}</Menu.RadioItem>
                        </Menu.RadioGroup>
                      </Menu.SubContent>
                    </Menu.Portal>
                  </Menu.Sub>

                  <Menu.Sub>
                    <Menu.SubTrigger>{language.t("sessionSidebar.project")}</Menu.SubTrigger>
                    <Menu.Portal>
                      <Menu.SubContent class="max-h-[280px] min-w-[180px] overflow-y-auto no-scrollbar [font-family:var(--v2-font-family-sans)]">
                        <Menu.RadioGroup
                          value={props.filter.project}
                          onChange={(value) => props.setFilter("project", value)}
                        >
                          <Menu.RadioItem value="">{language.t("sessionSidebar.allProjects")}</Menu.RadioItem>
                          <Show when={projects().length > 0}>
                            <Menu.Separator />
                          </Show>
                          <For each={projects()}>
                            {(project) => <Menu.RadioItem value={project.key}>{project.label}</Menu.RadioItem>}
                          </For>
                        </Menu.RadioGroup>
                      </Menu.SubContent>
                    </Menu.Portal>
                  </Menu.Sub>

                  <Menu.Sub>
                    <Menu.SubTrigger>{language.t("sessionSidebar.display")}</Menu.SubTrigger>
                    <Menu.Portal>
                      <Menu.SubContent class="min-w-[180px] [font-family:var(--v2-font-family-sans)]">
                        <Menu.CheckboxItem
                          checked={props.filter.showPath !== false}
                          onChange={(checked) => props.setFilter("showPath", checked)}
                        >
                          {language.t("sessionSidebar.showPath")}
                        </Menu.CheckboxItem>
                      </Menu.SubContent>
                    </Menu.Portal>
                  </Menu.Sub>

                  <Menu.CheckboxItem
                    checked={props.filter.status === "archived"}
                    onChange={(checked) => props.setFilter("status", checked ? "archived" : "active")}
                  >
                    {language.t("sessionSidebar.archivedOnly")}
                  </Menu.CheckboxItem>

                  <Menu.Separator />

                  <Menu.Item onSelect={markAllServersRead}>
                    {language.t("sessionSidebar.markAllRead")}
                  </Menu.Item>

                  <Show when={hasActiveFilters()}>
                    <Menu.Item onSelect={resetAllFilters}>
                      {language.t("sessionSidebar.resetFilters")}
                    </Menu.Item>
                  </Show>
                </Menu.Content>
              </Menu.Portal>
            </Menu>

            {/* Add Project Button (ATG style) */}
            <Tooltip placement="bottom" value={language.t("home.project.add")}>
              <button
                type="button"
                data-action="sidebar-add-project"
                aria-label={language.t("home.project.add")}
                onClick={addNewProject}
                class="flex size-6 items-center justify-center rounded-md text-v2-icon-icon-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
              >
                <Icon name="folder-add-left" size="small" />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Active Filter Pills */}
        <Show when={hasActiveFilters()}>
          <div class="flex flex-wrap items-center gap-1 px-1">
            <Show when={props.filter.status === "archived"}>
              <button
                type="button"
                onClick={() => props.setFilter("status", "active")}
                class="flex items-center gap-1 rounded-md bg-v2-overlay-simple-overlay-hover px-1.5 py-0.5 text-[11px] leading-4 text-v2-text-text-muted transition-colors hover:text-v2-text-text-base"
              >
                <span>{language.t("sessionSidebar.archived")}</span>
                <Icon name="xmark-small" size="small" class="size-3 opacity-70" />
              </button>
            </Show>
            <Show when={props.filter.days > 0}>
              <button
                type="button"
                onClick={() => props.setFilter("days", 0)}
                class="flex items-center gap-1 rounded-md bg-v2-overlay-simple-overlay-hover px-1.5 py-0.5 text-[11px] leading-4 text-v2-text-text-muted transition-colors hover:text-v2-text-text-base"
              >
                <span>{periodLabel(props.filter.days)}</span>
                <Icon name="xmark-small" size="small" class="size-3 opacity-70" />
              </button>
            </Show>
            <Show when={props.filter.project}>
              {(projectKey) => {
                const proj = () => projects().find((item) => item.key === projectKey())
                return (
                  <button
                    type="button"
                    onClick={() => props.setFilter("project", "")}
                    class="flex max-w-full items-center gap-1 rounded-md bg-v2-overlay-simple-overlay-hover px-1.5 py-0.5 text-[11px] leading-4 text-v2-text-text-muted transition-colors hover:text-v2-text-text-base"
                  >
                    <Icon name="folder" size="small" class="size-3 shrink-0 opacity-70" />
                    <span class="truncate">{proj()?.name ?? projectKey()}</span>
                    <Icon name="xmark-small" size="small" class="size-3 shrink-0 opacity-70" />
                  </button>
                )
              }}
            </Show>
          </div>
        </Show>
      </div>

      {/* Main Scrollable Session List */}
      <ScrollView
        data-slot="session-sidebar-scroll"
        class="min-h-0 flex-1 -me-[var(--shell-inline-inset,8px)] [&>.scroll-view__thumb]:w-1.5!"
      >
        <div class="flex flex-col gap-2.5 ps-0.5 pe-2 pb-2">
          <Show
            when={servers.visible.length > 0}
            fallback={
              <p class="px-2.5 py-4 text-[12px] text-v2-text-text-muted">{language.t("sessionSidebar.noServers")}</p>
            }
          >
            <For each={servers.visible}>
              {(connection) => (
                <ServerSessions
                  connection={connection}
                  filter={props.filter}
                  serverCount={servers.visible.length}
                  isGroupCollapsed={isGroupCollapsed}
                  toggleGroupCollapsed={toggleGroupCollapsed}
                  togglePinned={togglePinned}
                  onRows={(rows) => {
                    const key = ServerConnection.key(connection)
                    setRowsByServer((prev) => ({ ...prev, [key]: rows }))
                  }}
                  onRegisterMarkAllRead={(fn) => markAllReadMap.set(ServerConnection.key(connection), fn)}
                  onDispose={() => {
                    const key = ServerConnection.key(connection)
                    setRowsByServer((prev) => {
                      const next = { ...prev }
                      delete next[key]
                      return next
                    })
                    markAllReadMap.delete(key)
                  }}
                />
              )}
            </For>
          </Show>
        </div>
      </ScrollView>
    </aside>
  )
}

function ServerSessions(props: {
  connection: ServerConnection.Any
  filter: SidebarPreferencesState
  serverCount: number
  isGroupCollapsed: (groupId: string) => boolean
  toggleGroupCollapsed: (groupId: string) => void
  togglePinned: (row: SidebarRow) => void
  onRows: (rows: SidebarRow[]) => void
  onRegisterMarkAllRead: (fn: () => void) => void
  onDispose: () => void
}) {
  const language = useLanguage()
  const location = useLocation()
  const split = useOptionalSplitView()
  const controller = createServerSidebar(props.connection, () => props.filter)
  const pinned = createMemo(() => buildPinnedRows(controller.rows(), props.filter))
  const groups = createMemo(() => buildSessionGroups(controller.rows(), props.filter))
  const [renamingKey, setRenamingKey] = createSignal<string | null>(null)
  const [renameDraft, setRenameDraft] = createSignal("")

  createEffect(() => props.onRows(controller.rows()))
  props.onRegisterMarkAllRead(() => controller.markAllRead())
  onCleanup(props.onDispose)

  const showServerHeader = () =>
    props.serverCount > 1 || !controller.connected() || controller.failed()

  const serverKey = () => ServerConnection.key(props.connection)

  const paneIdx = (row: SidebarRow) => split?.sessionPaneIndex(serverKey(), row.session.id) ?? -1

  const isFocusedInSplit = (row: SidebarRow) => split?.isSessionFocused(serverKey(), row.session.id) ?? false

  const isActive = (row: SidebarRow) =>
    split?.active() ? paneIdx(row) !== -1 : location.pathname === sessionHref(serverKey(), row.session.id)

  const isPrimaryFocused = (row: SidebarRow) => (split?.active() ? isFocusedInSplit(row) : isActive(row))

  const paneBadgeLabel = (row: SidebarRow) => {
    const idx = paneIdx(row)
    if (!split?.active() || idx < 0) return undefined
    const count = split.count()
    if (count === 2) {
      return idx === 0 ? language.t("splitView.badge.left") : language.t("splitView.badge.right")
    }
    if (idx === 0) return language.t("splitView.badge.left")
    if (idx === 1) return language.t("splitView.badge.middle")
    return language.t("splitView.badge.right")
  }

  const openRowInSplit = (row: SidebarRow, position?: "left" | "middle" | "right") => {
    if (!split) {
      controller.open(row, { background: true })
      return
    }
    split.openSessionInSplit(
      {
        server: serverKey(),
        sessionId: row.session.id,
        directory: row.project.directory,
      },
      position,
    )
  }

  const groupLabel = (group: SidebarGroup) => {
    if (group.state === "input") return language.t("sessionSidebar.state.input")
    if (group.state === "working") return language.t("sessionSidebar.state.working")
    if (group.state === "review") return language.t("sessionSidebar.state.review")
    if (group.state === "idle") return language.t("sessionSidebar.state.idle")
    if (group.time === "today") return language.t("sessionSidebar.time.today")
    if (group.time === "yesterday") return language.t("sessionSidebar.time.yesterday")
    if (group.time === "week") return language.t("sessionSidebar.time.week")
    if (group.time === "month") return language.t("sessionSidebar.time.month")
    if (group.time === "older") return language.t("sessionSidebar.time.older")
    return group.project?.name ?? group.rows[0]?.project.name ?? language.t("sessionSidebar.title")
  }

  const startRename = (row: SidebarRow) => {
    setRenamingKey(row.key)
    setRenameDraft(normalizeSessionTitle(row.session.title) || row.session.title || "")
  }

  const submitRename = async (row: SidebarRow) => {
    if (renamingKey() !== row.key) return
    const next = renameDraft().trim()
    setRenamingKey(null)
    const currentTitle = normalizeSessionTitle(row.session.title)
    if (!next || next === currentTitle) return
    await controller.rename(row, next)
  }

  const copyText = (value: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(value).catch(() => undefined)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("common.copied"),
      })
    }
  }

  const renderSessionMenuItems = (row: SidebarRow) => {
    const rowPinned = () => isRowPinned(row, props.filter.pinned)
    const archived = () => row.session.time.archived !== undefined
    return (
      <>
        <Menu.Item onSelect={() => openRowInSplit(row)}>
          <span class="flex items-center gap-2">
            <Icon name="split" size="small" class="text-v2-icon-icon-muted" />
            <span>{language.t("sessionSidebar.action.openSplit")}</span>
          </span>
        </Menu.Item>
        <Menu.Sub>
          <Menu.SubTrigger>
            <span class="flex items-center gap-2">
              <Icon name="window-analytics" size="small" class="text-v2-icon-icon-muted" />
              <span>{language.t("sessionSidebar.action.openSplitPosition")}</span>
            </span>
          </Menu.SubTrigger>
          <Menu.Portal>
            <Menu.SubContent class="min-w-[150px] [font-family:var(--v2-font-family-sans)]">
              <Menu.Item onSelect={() => openRowInSplit(row, "left")}>
                {language.t("sessionSidebar.action.openSplitLeft")}
              </Menu.Item>
              <Show when={(split?.count() ?? 1) >= 2}>
                <Menu.Item onSelect={() => openRowInSplit(row, "middle")}>
                  {language.t("sessionSidebar.action.openSplitMiddle")}
                </Menu.Item>
              </Show>
              <Menu.Item onSelect={() => openRowInSplit(row, "right")}>
                {language.t("sessionSidebar.action.openSplitRight")}
              </Menu.Item>
            </Menu.SubContent>
          </Menu.Portal>
        </Menu.Sub>
        <Menu.Item onSelect={() => controller.open(row, { background: true })}>
          <span class="flex items-center gap-2">
            <Icon name="square-arrow-top-right" size="small" class="text-v2-icon-icon-muted" />
            <span>{language.t("sessionSidebar.action.openNewTab")}</span>
          </span>
        </Menu.Item>
        <Menu.Item onSelect={() => props.togglePinned(row)}>
          <span class="flex items-center gap-2">
            <PinIcon filled={rowPinned()} class="text-v2-icon-icon-muted" />
            <span>
              {rowPinned() ? language.t("sessionSidebar.action.unpin") : language.t("sessionSidebar.action.pin")}
            </span>
          </span>
        </Menu.Item>
        <Menu.Item onSelect={() => startRename(row)}>
          <span class="flex items-center gap-2">
            <Icon name="pencil-line" size="small" class="text-v2-icon-icon-muted" />
            <span>{language.t("sessionSidebar.action.rename")}</span>
          </span>
        </Menu.Item>
        <Show when={row.state === "review"}>
          <Menu.Item onSelect={() => controller.markRead(row)}>
            <span class="flex items-center gap-2">
              <Icon name="check" size="small" class="text-v2-icon-icon-muted" />
              <span>{language.t("sessionSidebar.action.markRead")}</span>
            </span>
          </Menu.Item>
        </Show>
        <Show when={row.state === "working"}>
          <Menu.Item onSelect={() => void controller.interrupt(row)}>
            <span class="flex items-center gap-2 text-v2-state-fg-warning">
              <Icon name="stop" size="small" />
              <span>{language.t("sessionSidebar.action.stop")}</span>
            </span>
          </Menu.Item>
        </Show>
        <Menu.Separator />
        <Menu.Item onSelect={() => copyText(row.session.id)}>
          <span class="flex items-center gap-2">
            <Icon name="copy" size="small" class="text-v2-icon-icon-muted" />
            <span>{language.t("sessionSidebar.action.copyId")}</span>
          </span>
        </Menu.Item>
        <Menu.Item onSelect={() => copyText(row.session.location.directory)}>
          <span class="flex items-center gap-2">
            <Icon name="folder" size="small" class="text-v2-icon-icon-muted" />
            <span>{language.t("sessionSidebar.action.copyDirectory")}</span>
          </span>
        </Menu.Item>
        <Menu.Separator />
        <Menu.Item onSelect={() => void controller.setArchived(row, !archived())}>
          <span class="flex items-center gap-2">
            <Icon name="archive" size="small" class="text-v2-icon-icon-muted" />
            <span>
              {archived() ? language.t("sessionSidebar.action.unarchive") : language.t("sessionSidebar.action.archive")}
            </span>
          </span>
        </Menu.Item>
        <Menu.Item onSelect={() => void controller.remove(row)}>
          <span class="flex items-center gap-2 text-v2-state-fg-danger">
            <Icon name="trash" size="small" />
            <span>{language.t("sessionSidebar.action.delete")}</span>
          </span>
        </Menu.Item>
      </>
    )
  }

  const SessionRowItem = (itemProps: { row: SidebarRow; compactProject?: boolean }) => {
    const row = () => itemProps.row
    const title = () => normalizeSessionTitle(row().session.title) || language.t("sessionSidebar.untitled")
    const activeRow = () => isActive(row())
    const focusedRow = () => isPrimaryFocused(row())
    const badge = () => paneBadgeLabel(row())
    const rowPinned = () => isRowPinned(row(), props.filter.pinned)
    const isRenaming = () => renamingKey() === row().key
    const relativeTime = () => formatRelativeTime(row().session.time.updated ?? row().session.time.created)
    const subpath = () => sessionSubpathLabel(row())
    const showSubtitle = () =>
      props.filter.showPath !== false && (!itemProps.compactProject || !!subpath())
    let suppressClick = false

    const handleRowPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || !split) return
      const startX = e.clientX
      const startY = e.clientY
      const rowData = row()
      const rowTitle = title()
      const srv = serverKey()
      let dragging = false

      const onMove = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - startX
        const dy = moveEvent.clientY - startY
        if (!dragging) {
          if (Math.hypot(dx, dy) < 6) return
          dragging = true
          split.startPointerDrag({
            kind: "session",
            title: rowTitle,
            directory: rowData.project.directory,
            server: srv,
            sessionId: rowData.session.id,
            clientX: moveEvent.clientX,
            clientY: moveEvent.clientY,
          })
        } else {
          split.updatePointerDrag(moveEvent.clientX, moveEvent.clientY)
        }
      }

      const cleanup = () => {
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
        window.removeEventListener("pointercancel", onCancel)
      }

      const onUp = (upEvent: PointerEvent) => {
        cleanup()
        if (!dragging) return
        suppressClick = true
        setTimeout(() => {
          suppressClick = false
        }, 80)
        split.endPointerDrag(upEvent.clientX, upEvent.clientY)
      }

      const onCancel = () => {
        cleanup()
        if (!dragging) return
        split.cancelPointerDrag()
      }

      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
      window.addEventListener("pointercancel", onCancel)
    }

    return (
      <Menu.Context appearance="compact">
        <Menu.Context.Trigger
          as="div"
          data-slot="session-sidebar-row-wrapper"
          data-state={row().state}
          data-active={activeRow() ? "" : undefined}
          data-focused={focusedRow() ? "true" : undefined}
          class="group/row relative flex min-w-0 items-center rounded-lg transition-colors"
          classList={{
            "bg-v2-overlay-simple-overlay-pressed shadow-[inset_2px_0_0_var(--v2-background-bg-accent)]": focusedRow(),
            "bg-v2-overlay-simple-overlay-hover/75 shadow-[inset_2px_0_0_var(--v2-border-border-strong)]":
              activeRow() && !focusedRow(),
            "hover:bg-v2-overlay-simple-overlay-hover": !activeRow(),
          }}
        >
          <Show
            when={!isRenaming()}
            fallback={
              <div class="flex w-full items-center gap-1.5 px-2.5 py-1.5">
                <input
                  type="text"
                  value={renameDraft()}
                  ref={(el) => {
                    queueMicrotask(() => {
                      el.focus()
                      el.select()
                    })
                  }}
                  onInput={(e) => setRenameDraft(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      void submitRename(row())
                    } else if (e.key === "Escape") {
                      e.preventDefault()
                      setRenamingKey(null)
                    }
                  }}
                  onBlur={() => void submitRename(row())}
                  class="h-6 min-w-0 flex-1 rounded border border-v2-border-border-focus bg-v2-background-bg-base px-1.5 text-[12px] text-v2-text-text-base focus:outline-none"
                />
              </div>
            }
          >
            <button
              type="button"
              data-slot="session-sidebar-row"
              data-session-id={row().session.id}
              data-state={row().state}
              aria-current={activeRow() ? "page" : undefined}
              title={`${title()}\n${row().project.directory}`}
              onPointerDown={handleRowPointerDown}
              onClick={(e) => {
                if (suppressClick) {
                  e.preventDefault()
                  e.stopPropagation()
                  suppressClick = false
                  return
                }
                if ((e.altKey || e.metaKey || e.ctrlKey) && split) {
                  e.preventDefault()
                  openRowInSplit(row())
                  return
                }
                controller.open(row())
              }}
              class="flex min-w-0 flex-1 cursor-grab flex-col gap-0.5 px-2.5 py-1.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus active:cursor-grabbing"
            >
              <div class="flex min-w-0 items-center gap-1.5">
                <Show when={badge()}>
                  {(label) => (
                    <span
                      data-slot="session-sidebar-pane-badge"
                      class="shrink-0 rounded px-1 py-0.25 text-[10px] leading-3 [font-weight:580]"
                      classList={{
                        "bg-v2-background-bg-accent/20 text-v2-text-text-base ring-1 ring-inset ring-v2-background-bg-accent/45":
                          focusedRow(),
                        "bg-v2-overlay-simple-overlay-hover text-v2-text-text-muted": !focusedRow(),
                      }}
                    >
                      {label()}
                    </span>
                  )}
                </Show>
                <span
                  class="min-w-0 flex-1 truncate text-[13px] leading-[18px]"
                  dir="auto"
                  classList={{
                    "text-v2-text-text-base [font-weight:520]":
                      activeRow() || row().state === "input" || row().state === "working" || row().state === "review",
                    "text-v2-text-text-muted": !activeRow() && row().state === "idle",
                  }}
                >
                  {title()}
                </span>
                <span
                  aria-hidden="true"
                  class="ms-1.5 flex shrink-0 items-center gap-1.5 group-hover/row:opacity-0 group-focus-within/row:opacity-0"
                >
                  <Show
                    when={row().state === "working"}
                    fallback={
                      <Show
                        when={row().state === "input"}
                        fallback={
                          <>
                            <Show when={row().state === "review"}>
                              <span
                                data-slot="session-sidebar-unread-dot"
                                class="size-1.5 shrink-0 rounded-full bg-v2-background-bg-accent"
                              />
                            </Show>
                            <span class="text-[11px] leading-4 tabular-nums text-v2-text-text-faint">
                              {relativeTime()}
                            </span>
                          </>
                        }
                      >
                        <span class="size-2 shrink-0 rounded-full bg-v2-state-fg-warning" />
                        <Show
                          when={props.filter.groupBy !== "state"}
                          fallback={
                            <span class="text-[11px] leading-4 tabular-nums text-v2-text-text-faint">
                              {relativeTime()}
                            </span>
                          }
                        >
                          <span class="rounded bg-v2-state-bg-warning px-1.5 py-0.5 text-[10px] leading-3 [font-weight:520] text-v2-state-fg-warning">
                            {language.t("sessionSidebar.state.input")}
                          </span>
                        </Show>
                      </Show>
                    }
                  >
                    <SessionProgressIndicatorV2 class="shrink-0" />
                  </Show>
                </span>
              </div>

              <Show when={showSubtitle()}>
                <div class="flex min-w-0 items-center gap-1 text-[11px] leading-4 text-v2-text-text-faint">
                  <Icon name="folder" size="small" class="size-3 shrink-0 opacity-65" />
                  <span class="min-w-0 truncate" dir="auto">
                    {itemProps.compactProject ? subpath() : row().project.name}
                  </span>
                  <Show when={!itemProps.compactProject && subpath()}>
                    <span class="shrink-0 opacity-50">·</span>
                    <span class="min-w-0 truncate opacity-85" dir="auto">
                      {subpath()}
                    </span>
                  </Show>
                  <Show
                    when={
                      row().state === "working" ||
                      (row().state === "input" && props.filter.groupBy !== "state")
                    }
                  >
                    <span class="ms-auto shrink-0 tabular-nums opacity-75 group-hover/row:opacity-0">
                      {relativeTime()}
                    </span>
                  </Show>
                </div>
              </Show>
            </button>

            <div
              data-slot="session-sidebar-row-actions"
              class="pointer-events-none absolute end-1.5 top-1.5 flex items-center gap-0.5 rounded-md bg-v2-background-bg-deep/90 px-0.5 py-0.5 opacity-0 backdrop-blur-xs transition-opacity group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100 [&:has([data-expanded])]:pointer-events-auto [&:has([data-expanded])]:opacity-100"
            >
              <Tooltip placement="top" value={language.t("sessionSidebar.action.openSplit")}>
                <button
                  type="button"
                  data-action="sidebar-open-split"
                  aria-label={language.t("sessionSidebar.action.openSplit")}
                  onClick={(e) => {
                    e.stopPropagation()
                    openRowInSplit(row())
                  }}
                  class="flex size-5 items-center justify-center rounded text-v2-icon-icon-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                >
                  <Icon name="split" size="small" />
                </button>
              </Tooltip>

              <Menu appearance="compact" placement="bottom-end">
                <Tooltip placement="top" value={language.t("sessionSidebar.action.more")}>
                  <Menu.Trigger
                    as="button"
                    type="button"
                    aria-label={language.t("sessionSidebar.action.more")}
                    onClick={(e: MouseEvent) => e.stopPropagation()}
                    class="flex size-5 items-center justify-center rounded text-v2-icon-icon-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                  >
                    <Icon name="outline-dots" size="small" />
                  </Menu.Trigger>
                </Tooltip>
                <Menu.Portal>
                  <Menu.Content class="min-w-[180px] [font-family:var(--v2-font-family-sans)]">
                    {renderSessionMenuItems(row())}
                  </Menu.Content>
                </Menu.Portal>
              </Menu>

              <Tooltip
                placement="top"
                value={
                  rowPinned() ? language.t("sessionSidebar.action.unpin") : language.t("sessionSidebar.action.pin")
                }
              >
                <button
                  type="button"
                  aria-label={
                    rowPinned() ? language.t("sessionSidebar.action.unpin") : language.t("sessionSidebar.action.pin")
                  }
                  onClick={(e) => {
                    e.stopPropagation()
                    props.togglePinned(row())
                  }}
                  class="flex size-5 items-center justify-center rounded transition-colors hover:bg-v2-overlay-simple-overlay-hover"
                  classList={{
                    "text-v2-text-text-base": rowPinned(),
                    "text-v2-icon-icon-muted hover:text-v2-text-text-base": !rowPinned(),
                  }}
                >
                  <PinIcon filled={rowPinned()} />
                </button>
              </Tooltip>

              <Show when={row().state === "working"}>
                <Tooltip placement="top" value={language.t("sessionSidebar.action.stop")}>
                  <button
                    type="button"
                    aria-label={language.t("sessionSidebar.action.stop")}
                    onClick={(e) => {
                      e.stopPropagation()
                      void controller.interrupt(row())
                    }}
                    class="flex size-5 items-center justify-center rounded text-v2-state-fg-warning transition-colors hover:bg-v2-state-bg-warning"
                  >
                    <Icon name="stop" size="small" />
                  </button>
                </Tooltip>
              </Show>
            </div>
          </Show>
        </Menu.Context.Trigger>
        <Menu.Context.Portal>
          <Menu.Context.Content class="min-w-[180px] [font-family:var(--v2-font-family-sans)]">
            {renderSessionMenuItems(row())}
          </Menu.Context.Content>
        </Menu.Context.Portal>
      </Menu.Context>
    )
  }

  return (
    <section class="mb-2 flex flex-col gap-2">
      <Show when={showServerHeader()}>
        <div class="flex items-center justify-between gap-2 px-2 pt-1">
          <span
            class="flex min-w-0 items-center gap-1.5 truncate text-[11px] font-medium uppercase tracking-wide text-v2-text-text-faint"
            dir="auto"
          >
            <Icon name="server" size="small" class="size-3 shrink-0 opacity-70" />
            <span class="truncate">{serverName(props.connection)}</span>
          </span>
          <Show when={controller.failed()}>
            <button
              type="button"
              onClick={controller.retry}
              class="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
            >
              {language.t("sessionSidebar.retry")}
            </button>
          </Show>
        </div>
      </Show>

      <Show when={!controller.connected()}>
        <p role="status" class="px-2.5 py-1.5 text-[12px] text-v2-text-text-muted">
          {language.t("sessionSidebar.disconnected")}
        </p>
      </Show>

      <Show when={controller.connected() && controller.loading() && controller.rows().length === 0}>
        <div role="status" class="flex items-center gap-2 px-2.5 py-1.5 text-[12px] text-v2-text-text-muted">
          <SessionProgressIndicatorV2 class="shrink-0" />
          <span>{language.t("sessionSidebar.loading")}</span>
        </div>
      </Show>

      <Show when={controller.failed()}>
        <div
          role="alert"
          class="mx-1 flex items-center justify-between gap-2 rounded-lg border border-v2-border-border-base bg-v2-background-bg-base/50 px-2.5 py-1.5 text-[12px] text-v2-text-text-muted"
        >
          <span>{language.t("sessionSidebar.failed")}</span>
          <button
            type="button"
            onClick={controller.retry}
            class="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
          >
            {language.t("sessionSidebar.retry")}
          </button>
        </div>
      </Show>

      {/* Pinned Conversations Section (ATG & ZCode style) */}
      <Show when={pinned().length > 0}>
        <div class="flex flex-col gap-0.5" data-slot="session-sidebar-pinned">
          <button
            type="button"
            onClick={() => props.toggleGroupCollapsed("pinned")}
            class="group/header flex h-6 w-full items-center gap-1.5 rounded-md px-2 text-start transition-colors hover:bg-v2-overlay-simple-overlay-hover/50"
          >
            <PinIcon filled class="size-3 shrink-0 text-v2-icon-icon-muted" />
            <h3 class="min-w-0 flex-1 truncate text-[11px] font-medium text-v2-text-text-muted" dir="auto">
              {language.t("sessionSidebar.pinned")}
            </h3>
            <span class="shrink-0 text-[11px] tabular-nums text-v2-text-text-faint">{pinned().length}</span>
            <Icon
              name={props.isGroupCollapsed("pinned") ? "chevron-right" : "chevron-down"}
              size="small"
              class="size-3 shrink-0 text-v2-icon-icon-faint opacity-0 transition-opacity group-hover/header:opacity-100"
            />
          </button>
          <Show when={!props.isGroupCollapsed("pinned")}>
            <div class="flex flex-col gap-0.5">
              <For each={pinned()}>{(row) => <SessionRowItem row={row} />}</For>
            </div>
          </Show>
        </div>
      </Show>

      {/* Grouped Session Sections */}
      <For each={groups()}>
        {(group) => {
          const collapseKey = () => `${props.filter.groupBy}:${group.id}`
          const collapsed = () => props.isGroupCollapsed(collapseKey())
          const isFlat = () => props.filter.groupBy === "none"
          const isProjectGroup = () => props.filter.groupBy === "project" && !!group.project
          const hasUnreadInGroup = () => group.rows.some((r) => r.state === "input" || r.state === "review")

          return (
            <div class="flex flex-col gap-0.5" data-slot="session-sidebar-group" data-group-id={group.id}>
              <Show when={!isFlat()}>
                <div class="group/header flex h-6 items-center gap-1 rounded-md px-1.5 transition-colors hover:bg-v2-overlay-simple-overlay-hover/50">
                  <button
                    type="button"
                    onClick={() => props.toggleGroupCollapsed(collapseKey())}
                    class="flex min-w-0 flex-1 items-center gap-1.5 text-start"
                  >
                    <Show when={group.state === "input"}>
                      <Icon name="warning" size="small" class="size-3.5 shrink-0 text-v2-state-fg-warning" />
                    </Show>
                    <Show when={group.state === "working"}>
                      <SessionProgressIndicatorV2 class="shrink-0" />
                    </Show>
                    <Show when={group.state === "review"}>
                      <span class="mx-0.5 size-2 shrink-0 rounded-full bg-v2-background-bg-accent" />
                    </Show>
                    <Show when={group.state === "idle"}>
                      <Icon name="circle-check" size="small" class="size-3.5 shrink-0 text-v2-icon-icon-faint" />
                    </Show>
                    <Show when={isProjectGroup()}>
                      <Icon name="folder" size="small" class="size-3.5 shrink-0 text-v2-icon-icon-muted" />
                    </Show>

                    <h4
                      class="min-w-0 flex-1 truncate font-medium"
                      dir="auto"
                      classList={{
                        "text-[12px] text-v2-text-text-base": isProjectGroup(),
                        "text-[11px] text-v2-text-text-muted": !isProjectGroup(),
                      }}
                    >
                      {groupLabel(group)}
                    </h4>

                    <Show when={collapsed() && hasUnreadInGroup()}>
                      <span class="size-1.5 shrink-0 rounded-full bg-v2-background-bg-accent" />
                    </Show>
                  </button>

                  <div class="flex shrink-0 items-center gap-1">
                    <Show when={isProjectGroup() && group.project}>
                      {(proj) => (
                        <Tooltip
                          placement="top"
                          value={language.t("sessionSidebar.newInProject", { project: proj().name })}
                        >
                          <button
                            type="button"
                            aria-label={language.t("sessionSidebar.newInProject", { project: proj().name })}
                            onClick={(e) => {
                              e.stopPropagation()
                              controller.newSessionInProject(proj().directory)
                            }}
                            class="flex size-5 items-center justify-center rounded text-v2-icon-icon-muted opacity-0 transition-opacity hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base group-hover/header:opacity-100"
                          >
                            <Icon name="plus" size="small" />
                          </button>
                        </Tooltip>
                      )}
                    </Show>

                    <span class="px-0.5 text-[11px] tabular-nums text-v2-text-text-faint">{group.rows.length}</span>

                    <button
                      type="button"
                      aria-label="Toggle group"
                      onClick={() => props.toggleGroupCollapsed(collapseKey())}
                      class="flex size-4 items-center justify-center rounded text-v2-icon-icon-faint opacity-0 transition-opacity hover:text-v2-text-text-base group-hover/header:opacity-100"
                      classList={{
                        "opacity-100": collapsed(),
                      }}
                    >
                      <Icon name={collapsed() ? "chevron-right" : "chevron-down"} size="small" class="size-3" />
                    </button>
                  </div>
                </div>
              </Show>

              <Show when={isFlat() || !collapsed()}>
                <div
                  class="flex flex-col gap-0.5"
                  classList={{
                    "ps-2": isProjectGroup(),
                  }}
                >
                  <For each={group.rows}>
                    {(row) => <SessionRowItem row={row} compactProject={isProjectGroup()} />}
                  </For>
                </div>
              </Show>
            </div>
          )
        }}
      </For>

      <Show when={!controller.loading() && pinned().length === 0 && !groups().length}>
        <p class="px-2.5 py-2 text-[12px] text-v2-text-text-muted">{language.t("sessionSidebar.empty")}</p>
      </Show>

      <Show when={controller.more()}>
        <button
          type="button"
          disabled={controller.fetching() || !controller.connected()}
          onClick={controller.loadMore}
          class="mx-1.5 mt-1 flex h-7 items-center justify-center rounded-lg border border-v2-border-border-base/70 bg-v2-background-bg-base/40 px-2.5 text-[11px] font-medium text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:opacity-50"
        >
          {controller.fetching() ? language.t("sessionSidebar.loading") : language.t("sessionSidebar.more")}
        </button>
      </Show>
    </section>
  )
}
