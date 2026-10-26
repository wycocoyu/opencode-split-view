import { createEffect, createMemo, createSignal, onCleanup, Show, type Ref } from "solid-js"
import { createStore } from "solid-js/store"
import { Predicate } from "effect"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createMutation } from "@tanstack/solid-query"
import { IconButton } from "@opencode/ui/icon-button"
import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { useServerCtx } from "@/runtime/server/runtime"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, serverName, useServers } from "@/runtime/server/registry"
import { displayName } from "@opencode/ui/project-avatar"
import { SessionTabAvatarView } from "@/shell/layout/session-tab-avatar"
import { SessionProgressIndicatorV2 } from "@opencode/session-ui/v2/session-progress-indicator-v2"
import type { SessionInfo } from "@opencode/client/promise"
import { sessionTabTitle } from "./tab-title"
import { TabPreviewPopover } from "./tab-popover"
import { useOptionalSplitView } from "@/shell/split-view/context"
import "./tab-nav.css"

// MouseEvent.button uses 1 for the middle/wheel button.
const MIDDLE_MOUSE_BUTTON = 1

export function TabNavItem(props: {
  ref?: Ref<HTMLDivElement>
  href: string
  server: ServerConnection.Key
  session: SessionInfo | undefined
  preparing: boolean
  unread: boolean
  loading: boolean
  fallbackTitle?: string
  onRename: (title: string) => Promise<void>
  onClose: () => void
  onNavigate: () => void
  active?: boolean
  suppressNavigation?: boolean
  dragging?: boolean
  pressed?: boolean
  hidden?: boolean
  orientation?: "horizontal" | "vertical"
}) {
  const language = useLanguage()
  const split = useOptionalSplitView()
  const [menu, setMenu] = createStore({ open: false, rename: false })
  const [editing, setEditing] = createSignal(false)
  const [titleOverflowing, setTitleOverflowing] = createSignal(false)
  let tabRoot!: HTMLDivElement
  let titleEl!: HTMLSpanElement
  let measureFrame: number | undefined
  const rename = createMutation(() => ({ mutationFn: props.onRename }))

  const closeTab = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    props.onClose()
  }

  const servers = useServers()
  const serverCtx = useServerCtx(() => servers.list.find((item) => ServerConnection.key(item) === props.server))

  const unread = () => !!props.session && !props.active && props.unread

  const splitBadgeLabel = createMemo(() => {
    const s = props.session
    if (!split?.active() || !s) return undefined
    const idx = split.sessionPaneIndex(props.server, s.id)
    if (idx < 0) return undefined
    const count = split.count()
    if (count === 2) {
      return idx === 0 ? language.t("splitView.badge.left") : language.t("splitView.badge.right")
    }
    if (idx === 0) return language.t("splitView.badge.left")
    if (idx === 1) return language.t("splitView.badge.middle")
    return language.t("splitView.badge.right")
  })

  const handleTabSplitPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || !split || editing() || !props.session) return
    const startX = e.clientX
    const startY = e.clientY
    const s = props.session
    const tabTitle = title() || language.t("session.tab.session")
    const isVert = props.orientation === "vertical"
    const snapshotBeforePress = split.state()
    let splitDragging = false

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX
      const dy = moveEvent.clientY - startY
      if (!splitDragging) {
        // Only activate split-workbench drag when dragging perpendicular/out of the tab strip into the workbench
        const outOfStrip = isVert ? dx > 20 : dy > 18
        if (!outOfStrip) return
        splitDragging = true
        document.body?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
        split.restoreSnapshot(snapshotBeforePress)
        split.startPointerDrag({
          kind: "session",
          title: tabTitle,
          directory: s.location.directory,
          server: props.server,
          sessionId: s.id,
          clientX: moveEvent.clientX,
          clientY: moveEvent.clientY,
        })
      } else {
        split.updatePointerDrag(moveEvent.clientX, moveEvent.clientY)
      }
    }

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove, true)
      window.removeEventListener("pointerup", onUp, true)
      window.removeEventListener("pointercancel", onCancel, true)
    }

    const onUp = (upEvent: PointerEvent) => {
      cleanup()
      if (!splitDragging) return
      split.restoreSnapshot(snapshotBeforePress)
      split.endPointerDrag(upEvent.clientX, upEvent.clientY)
    }

    const onCancel = () => {
      cleanup()
      if (!splitDragging) return
      split.cancelPointerDrag()
    }

    window.addEventListener("pointermove", onMove, true)
    window.addEventListener("pointerup", onUp, true)
    window.addEventListener("pointercancel", onCancel, true)
  }

  const project = createMemo(() => {
    const session = props.session

    if (!session) return

    return serverCtx()?.projects.forSession(session)
  })

  const title = createMemo(() => {
    const session = props.session

    return sessionTabTitle(session ? session.title : props.fallbackTitle, language.t("session.tab.session"))
  })

  const projectName = createMemo(() => {
    const session = props.session

    if (!session) return

    return displayName(project() ?? { worktree: session.location.directory })
  })

  const previewPath = createMemo(() => {
    const session = props.session

    if (!session) return
    const home = serverCtx()?.sync.data.path.home

    return home ? session.location.directory.replace(home, "~") : session.location.directory
  })

  // Only label the server when multiple servers are connected.
  const serverLabel = createMemo(() => {
    if (servers.list.length <= 1) return
    const conn = servers.list.find((item) => ServerConnection.key(item) === props.server)

    return conn ? serverName(conn) : undefined
  })

  // Like the TUI, a prompt sent to a background tab's session pulses the tab once.
  const [promptPulse, setPromptPulse] = createSignal(0)
  createEffect(() => {
    const data = serverCtx()?.data
    const sessionID = props.session?.id

    if (!data || !sessionID) return
    onCleanup(
      data.on("session.inbox.enqueued", (event) => {
        if (props.active || event.data.item.type !== "user" || data.session.root(event.data.sessionID) !== sessionID)
          return
        setPromptPulse((count) => count + 1)
      }),
    )
  })

  const [popoverOpen, setPopoverOpen] = createSignal(false)
  const previewBlocked = () => !!props.dragging || editing() || menu.open || !!props.pressed || !props.session

  const measureTitleOverflow = () => {
    if (!titleEl || editing()) {
      setTitleOverflowing(false)

      return
    }

    setTitleOverflowing(titleEl.scrollWidth > titleEl.clientWidth)
  }

  const scheduleTitleOverflow = () => {
    if (measureFrame !== undefined) return
    measureFrame = requestAnimationFrame(() => {
      measureFrame = undefined
      measureTitleOverflow()
    })
  }

  createEffect(() => {
    title()
    props.active
    props.orientation
    editing()
    scheduleTitleOverflow()
  })

  // The overflow fade changes title padding; observe the stable tab box, not that feedback.
  createResizeObserver(() => tabRoot, scheduleTitleOverflow)
  onCleanup(() => {
    if (measureFrame !== undefined) cancelAnimationFrame(measureFrame)
  })

  const selectTitle = () => {
    const range = document.createRange()
    range.selectNodeContents(titleEl)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }

  const closeRename = async (save: boolean) => {
    if (rename.isPending || !editing()) return

    const original = props.session?.title ?? ""
    const next = (titleEl.textContent ?? "").trim()

    titleEl.scrollLeft = 0
    setEditing(false)

    if (!save || !next || next === original) {
      return
    }

    await rename.mutateAsync(next)
  }

  createEffect(() => {
    if (editing()) return

    if (!titleEl) return
    const value = title()

    if (value === undefined) return
    titleEl.textContent = value
  })

  const openRename = (event?: MouseEvent) => {
    event?.preventDefault()
    event?.stopPropagation()

    if (props.dragging || editing() || rename.isPending) return
    const session = props.session

    if (!session) return
    titleEl.textContent = session.title ?? ""
    setEditing(true)

    requestAnimationFrame(() => {
      titleEl.focus()
      selectTitle()
    })
  }

  createEffect(() => {
    if (!editing()) return

    const cleanup = makeEventListener(
      document,
      "pointerdown",
      (event) => {
        const target = event.target

        if (!(target instanceof Node)) return

        if (tabRoot.contains(target)) return
        void closeRename(true)
      },
      { capture: true },
    )

    onCleanup(cleanup)
  })

  const tab = () => (
    <div
      ref={(el) => {
        tabRoot = el

        if (Predicate.isFunction(props.ref)) props.ref(el)
      }}
      data-titlebar-tab
      data-slot="titlebar-tab-item"
      data-orientation={props.orientation ?? "horizontal"}
      data-title-overflow={titleOverflowing()}
      data-editing={editing()}
      class="group relative flex h-7 w-full min-w-0 select-none flex-row items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[6px] px-1.5 [container-type:inline-size]"
      classList={{ invisible: props.hidden }}
      data-active={props.active}
      data-unread={unread()}
      data-dragging={props.dragging}
      data-state={props.active || props.pressed ? "pressed" : undefined}
      onMouseDown={(event) => {
        if (event.button !== MIDDLE_MOUSE_BUTTON) return
        event.preventDefault()
        event.stopPropagation()
      }}
      onAuxClick={(event) => {
        if (event.button !== MIDDLE_MOUSE_BUTTON) return
        closeTab(event)
      }}
    >
      <Show when={promptPulse()} keyed>
        <span data-slot="tab-prompt-pulse" aria-hidden="true" onAnimationEnd={() => setPromptPulse(0)} />
      </Show>
      <Menu.Context.Trigger
        as="a"
        disabled={editing() || props.dragging}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        data-slot="tab-link"
        data-titlebar-tab-link
        href={props.href}
        draggable={false}
        onDragStart={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onPointerDown={handleTabSplitPointerDown}
        onMouseDown={(event) => {
          // Navigate on mousedown to shave the press-release delay off tab switches.
          if (event.button !== 0) return

          if (editing()) return

          if ((event.altKey || event.metaKey || event.ctrlKey) && split && props.session) {
            event.preventDefault()
            event.stopPropagation()
            split.openSessionInSplit({
              server: props.server,
              sessionId: props.session.id,
              directory: props.session.location.directory,
            })
            return
          }

          if (props.suppressNavigation) return
          props.onNavigate()
        }}
        onClick={(event) => {
          event.preventDefault()

          // Mouse navigation already happened on mousedown; detail 0 means keyboard activation.
          if (event.detail > 0) return

          if (editing()) return

          if (props.suppressNavigation) return
          props.onNavigate()
        }}
        class="flex h-full min-w-0 flex-1 flex-row items-center gap-1.5 text-[13px] font-medium text-v2-text-text-faint group-data-[active='true']:text-v2-text-text-base group-data-[editing='true']:text-v2-text-text-base [-webkit-user-drag:none]"
      >
        <Show when={splitBadgeLabel()}>
          {(label) => (
            <span
              data-slot="tab-split-badge"
              class="shrink-0 rounded bg-v2-overlay-simple-overlay-hover px-1 py-0.25 text-[10px] leading-3 [font-weight:580] text-v2-text-text-base"
            >
              {label()}
            </span>
          )}
        </Show>
        <span data-slot="project-avatar-slot" class="flex size-4 shrink-0 items-center justify-center">
          <Show
            when={props.session}
            keyed
            fallback={
              <Show
                when={props.preparing}
                fallback={
                  <span class="block size-4 rounded-[3px] border border-v2-border-border-muted" aria-hidden="true" />
                }
              >
                <SessionProgressIndicatorV2 />
              </Show>
            }
          >
            {(session) => (
              <SessionTabAvatarView
                project={project()}
                directory={session.location.directory}
                unread={false}
                loading={props.loading}
              />
            )}
          </Show>
          <Show when={unread()}>
            <span data-slot="tab-avatar-unread-dot" aria-hidden="true" />
          </Show>
        </span>
        <span
          ref={(el) => {
            titleEl = el
            titleEl.textContent = title() ?? ""
          }}
          data-slot="tab-title"
          data-titlebar-tab-title
          dir="auto"
          class="min-w-0 flex-1 outline-none leading-4"
          classList={{
            "overflow-hidden text-clip whitespace-nowrap": !editing(),
            "select-text": editing(),
          }}
          contenteditable={editing() ? true : undefined}
          onDblClick={openRename}
          onKeyDown={(event) => {
            event.stopPropagation()

            if (event.key === "Enter") {
              event.preventDefault()
              void closeRename(true)

              return
            }

            if (event.key !== "Escape") return
            event.preventDefault()
            titleEl.textContent = props.session?.title ?? ""
            void closeRename(false)
          }}
          onBlur={() => void closeRename(true)}
          onPointerDown={(event) => {
            if (!editing()) return
            event.stopPropagation()
          }}
          onClick={(event) => {
            if (!editing()) return
            event.preventDefault()
          }}
        />
      </Menu.Context.Trigger>

      <div data-slot="tab-close">
        <Show when={unread()}>
          <span data-slot="tab-unread-slot" aria-hidden="true">
            <span data-slot="tab-unread-dot" />
          </span>
        </Show>
        <IconButton
          size="small"
          variant="ghost-muted"
          class="hover-reveal relative z-10 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 group-data-[active=true]:opacity-100 group-data-[editing=true]:opacity-100"
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={closeTab}
          icon={<Icon name="xmark-small" />}
          aria-label={language.t("common.closeTab")}
        />
      </div>
    </div>
  )

  return (
    <Menu.Context
      modal={false}
      onOpenChange={(open) => {
        setMenu("open", open)

        if (open) setPopoverOpen(false)
      }}
    >
      <TabPreviewPopover
        trigger={tab()}
        orientation={props.orientation}
        open={popoverOpen() && !previewBlocked()}
        onOpenChange={(value) => {
          if (value && previewBlocked()) return
          setPopoverOpen(value)
        }}
        data={{
          projectName: projectName(),
          title: props.session?.title,
          path: previewPath(),
          serverName: serverLabel(),
        }}
      />
      <Menu.Context.Portal>
        <Menu.Context.Content
          onCloseAutoFocus={(event) => {
            if (!menu.rename) return
            event.preventDefault()
            setMenu("rename", false)
            openRename()
          }}
        >
          <Show when={split && props.session}>
            <Menu.Item
              onSelect={() => {
                const s = props.session
                if (!s || !split) return
                split.openSessionInSplit({
                  server: props.server,
                  sessionId: s.id,
                  directory: s.location.directory,
                })
              }}
            >
              {language.t("splitView.action.openSplit")}
            </Menu.Item>
            <Menu.Sub>
              <Menu.SubTrigger>{language.t("splitView.action.openSplitPosition")}</Menu.SubTrigger>
              <Menu.Portal>
                <Menu.SubContent class="min-w-[150px] [font-family:var(--v2-font-family-sans)]">
                  <Menu.Item
                    onSelect={() => {
                      const s = props.session
                      if (!s || !split) return
                      split.openSessionInSplit(
                        { server: props.server, sessionId: s.id, directory: s.location.directory },
                        "left",
                      )
                    }}
                  >
                    {language.t("splitView.action.openSplitLeft")}
                  </Menu.Item>
                  <Show when={(split?.count() ?? 1) >= 2}>
                    <Menu.Item
                      onSelect={() => {
                        const s = props.session
                        if (!s || !split) return
                        split.openSessionInSplit(
                          { server: props.server, sessionId: s.id, directory: s.location.directory },
                          "middle",
                        )
                      }}
                    >
                      {language.t("splitView.action.openSplitMiddle")}
                    </Menu.Item>
                  </Show>
                  <Menu.Item
                    onSelect={() => {
                      const s = props.session
                      if (!s || !split) return
                      split.openSessionInSplit(
                        { server: props.server, sessionId: s.id, directory: s.location.directory },
                        "right",
                      )
                    }}
                  >
                    {language.t("splitView.action.openSplitRight")}
                  </Menu.Item>
                </Menu.SubContent>
              </Menu.Portal>
            </Menu.Sub>
            <Menu.Separator />
          </Show>
          <Menu.Item disabled={!props.session || rename.isPending} onSelect={() => setMenu("rename", true)}>
            {language.t("common.rename")}
          </Menu.Item>
          <Menu.Item onSelect={props.onClose}>{language.t("common.closeTab")}</Menu.Item>
        </Menu.Context.Content>
      </Menu.Context.Portal>
    </Menu.Context>
  )
}

export function DraftTabItem(props: {
  ref?: Ref<HTMLDivElement>
  href: string
  title: string
  active?: boolean
  onNavigate: () => void
  onClose: () => void
  suppressNavigation?: boolean
  dragging?: boolean
  pressed?: boolean
  hidden?: boolean
  orientation?: "horizontal" | "vertical"
}) {
  const language = useLanguage()

  const closeTab = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    props.onClose()
  }

  return (
    <div
      ref={(el) => {
        if (Predicate.isFunction(props.ref)) props.ref(el)
      }}
      data-titlebar-tab
      data-slot="titlebar-tab-item"
      data-orientation={props.orientation ?? "horizontal"}
      data-active={props.active}
      data-dragging={props.dragging}
      data-state={props.active || props.pressed ? "pressed" : undefined}
      class="group relative flex h-7 w-full min-w-0 flex-row items-center gap-1.5 overflow-hidden rounded-[6px] px-1.5 [container-type:inline-size] whitespace-nowrap"
      classList={{ invisible: props.hidden }}
      onMouseDown={(event) => {
        if (event.button !== MIDDLE_MOUSE_BUTTON) return
        event.preventDefault()
        event.stopPropagation()
      }}
      onAuxClick={(event) => {
        if (event.button !== MIDDLE_MOUSE_BUTTON) return
        closeTab(event)
      }}
    >
      <a
        data-slot="tab-link"
        data-titlebar-tab-link
        href={props.href}
        draggable={false}
        onDragStart={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onMouseDown={(event) => {
          // Navigate on mousedown to shave the press-release delay off tab switches.
          if (event.button !== 0) return

          if (props.suppressNavigation) return
          props.onNavigate()
        }}
        onClick={(event) => {
          event.preventDefault()

          // Mouse navigation already happened on mousedown; detail 0 means keyboard activation.
          if (event.detail > 0) return

          if (props.suppressNavigation) return
          props.onNavigate()
        }}
        class="flex h-full min-w-0 flex-1 flex-row items-center gap-1.5 text-[13px] font-medium text-v2-text-text-faint group-data-[active='true']:text-v2-text-text-base [-webkit-user-drag:none]"
      >
        <span class="flex size-4 shrink-0 items-center justify-center">
          <svg
            class="text-v2-icon-icon-muted group-data-[active='true']:text-v2-icon-icon-base"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M9.00002 13.5H14M2.60419 10.9167V13.3958H5.08335L13.3959 5.08333L10.9167 2.60416L2.60419 10.9167Z"
              stroke="currentColor"
            />
          </svg>
        </span>
        <span
          data-titlebar-tab-title
          class="min-w-0 flex-1 overflow-hidden text-clip whitespace-nowrap outline-none leading-4"
        >
          {props.title}
        </span>
      </a>
      <div data-slot="tab-close">
        <IconButton
          size="small"
          variant="ghost-muted"
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          class="hover-reveal relative z-10 group-hover:opacity-100 group-data-[active=true]:opacity-100 group-data-[editing=true]:opacity-100"
          onClick={closeTab}
          icon={<Icon name="xmark-small" />}
          aria-label={language.t("common.closeTab")}
        />
      </div>
    </div>
  )
}
