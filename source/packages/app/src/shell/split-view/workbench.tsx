import {
  For,
  Match,
  Show,
  Suspense,
  Switch,
  createMemo,
  createSignal,
  lazy,
  onCleanup,
  type Accessor,
  type ParentProps,
} from "solid-js"
import { Portal } from "solid-js/web"
import { SessionProgressIndicatorV2 } from "@opencode/session-ui/v2/session-progress-indicator-v2"
import { Icon } from "@opencode/ui/icon"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerProvider } from "@/runtime/server/current"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { SessionPanelFrame, SessionRouteFrame } from "@/session/session-frame"
import { useSettingsSurface } from "@/settings/surface"
import { useCommand } from "@/shell/commands/command"
import { normalizeSessionTitle } from "@/shell/session-sidebar/model"
import { useLayout } from "@/shell/state/layout"
import { tabKey, useTabs } from "@/shell/tabs/tabs"
import { sessionTabTitle } from "@/shell/titlebar/tab-title"
import { SplitPaneProvider, useSplitPane, useSplitView } from "./context"
import type { SplitPaneCount, SplitPanePosition, SplitPaneTarget } from "./model"

export const SESSION_DRAG_MIME = "application/x-opencode-session"

export type SessionDragPayload = {
  server: string
  sessionId: string
  directory?: string
}

export function encodeSessionDragPayload(payload: SessionDragPayload): string {
  return JSON.stringify(payload)
}

export function decodeSessionDragPayload(raw: string | null | undefined): SessionDragPayload | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as Partial<SessionDragPayload>
    if (typeof parsed.server === "string" && typeof parsed.sessionId === "string" && parsed.sessionId.length > 0) {
      return {
        server: parsed.server,
        sessionId: parsed.sessionId,
        directory: typeof parsed.directory === "string" ? parsed.directory : undefined,
      }
    }
  } catch {
    return undefined
  }
  return undefined
}

export function hasSessionDragMime(dataTransfer: DataTransfer | null | undefined): boolean {
  if (!dataTransfer) return false
  return Array.from(dataTransfer.types ?? []).includes(SESSION_DRAG_MIME)
}

const File = lazy(() => import("@opencode/session-ui/file").then((module) => ({ default: module.File })))
const loadSessionRoute = () => Promise.all([import("@/session/route"), File.preload()]).then(([module]) => module)
const TargetSessionRouteContent = lazy(() =>
  loadSessionRoute().then((module) => ({ default: module.TargetSessionRouteContent })),
)
const DraftRoute = lazy(() => import("@/new-session/route").then((module) => ({ default: module.DraftRoute })))

const SinglePaneIcon = (props: { class?: string }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" class={props.class} aria-hidden="true">
    <rect x="2" y="2.5" width="12" height="11" rx="2" stroke="currentColor" stroke-width="1.3" />
  </svg>
)

const TwoPanesIcon = (props: { class?: string }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" class={props.class} aria-hidden="true">
    <rect x="1.75" y="2.5" width="12.5" height="11" rx="2" stroke="currentColor" stroke-width="1.3" />
    <line x1="8" y1="3" x2="8" y2="13" stroke="currentColor" stroke-width="1.3" />
  </svg>
)

const ThreePanesIcon = (props: { class?: string }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" class={props.class} aria-hidden="true">
    <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" stroke-width="1.3" />
    <line x1="5.85" y1="3" x2="5.85" y2="13" stroke="currentColor" stroke-width="1.25" />
    <line x1="10.15" y1="3" x2="10.15" y2="13" stroke="currentColor" stroke-width="1.25" />
  </svg>
)

export function SplitLayoutSwitcher(props: { compact?: boolean; showSplitAction?: boolean; class?: string }) {
  const split = useSplitView()
  const language = useLanguage()
  const command = useCommand()

  const options: Array<{
    count: SplitPaneCount
    action: string
    labelKey: "splitView.layout.single" | "splitView.layout.twoPanes" | "splitView.layout.threePanes"
    shortKey: "splitView.short.single" | "splitView.short.twoPanes" | "splitView.short.threePanes"
    commandId: string
    icon: typeof SinglePaneIcon
  }> = [
    {
      count: 1,
      action: "split-layout-1",
      labelKey: "splitView.layout.single",
      shortKey: "splitView.short.single",
      commandId: "split.layout.1",
      icon: SinglePaneIcon,
    },
    {
      count: 2,
      action: "split-layout-2",
      labelKey: "splitView.layout.twoPanes",
      shortKey: "splitView.short.twoPanes",
      commandId: "split.layout.2",
      icon: TwoPanesIcon,
    },
    {
      count: 3,
      action: "split-layout-3",
      labelKey: "splitView.layout.threePanes",
      shortKey: "splitView.short.threePanes",
      commandId: "split.layout.3",
      icon: ThreePanesIcon,
    },
  ]

  return (
    <div
      data-slot="split-layout-switcher"
      role="group"
      aria-label={language.t("splitView.switcher.label")}
      class={`flex shrink-0 items-center gap-0.5 rounded-lg border border-v2-border-border-base/75 bg-v2-background-bg-base/70 p-0.5 [app-region:no-drag] ${props.class ?? ""}`}
    >
      <For each={options}>
        {(item) => {
          const active = () => split.count() === item.count
          const IconComp = item.icon
          return (
            <Tooltip
              placement="bottom"
              value={
                <>
                  {language.t(item.labelKey)}
                  <Keybind keys={command.keybindParts(item.commandId)} variant="neutral" />
                </>
              }
            >
              <button
                type="button"
                data-action={item.action}
                data-pane-count={item.count}
                data-active={active() ? "true" : undefined}
                aria-label={language.t(item.labelKey)}
                aria-pressed={active()}
                onClick={() => split.setLayoutCount(item.count)}
                class="flex h-6 items-center justify-center gap-1 rounded-[5px] px-1.5 text-[11px] leading-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
                classList={{
                  "bg-v2-overlay-simple-overlay-pressed text-v2-text-text-base [font-weight:560] shadow-2xs": active(),
                  "text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base":
                    !active(),
                }}
              >
                <IconComp class="shrink-0" />
                <Show when={!props.compact}>
                  <span class="hidden lg:inline">{language.t(item.shortKey)}</span>
                </Show>
              </button>
            </Tooltip>
          )
        }}
      </For>

      <Show when={props.showSplitAction && split.count() < 3}>
        <Tooltip
          placement="bottom"
          value={
            <>
              {language.t("splitView.command.splitRight")}
              <Keybind keys={command.keybindParts("split.right")} variant="neutral" />
            </>
          }
        >
          <button
            type="button"
            data-action="split-right"
            aria-label={language.t("splitView.command.splitRight")}
            onClick={() => split.splitRight()}
            class="flex size-6 items-center justify-center rounded-[5px] text-v2-icon-icon-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:outline-none"
          >
            <Icon name="plus" size="small" />
          </button>
        </Tooltip>
      </Show>
    </div>
  )
}

function directoryLabel(dir: string | undefined): string {
  if (!dir) return ""
  const normalized = dir.replace(/[\\/]+$/, "")
  const parts = normalized.split(/[\\/]/)
  return parts[parts.length - 1] || normalized
}

function panePositionRole(index: number, count: SplitPaneCount): SplitPanePosition {
  if (count === 2) return index === 0 ? "left" : "right"
  if (index === 0) return "left"
  if (index === 1) return "middle"
  return "right"
}

function SplitPaneHeader() {
  const pane = useSplitPane()!
  const split = useSplitView()
  const global = useGlobal()
  const tabs = useTabs()
  const language = useLanguage()

  const positionRole = createMemo(() => panePositionRole(pane.index(), pane.count()))

  const positionText = createMemo(() => {
    const role = positionRole()
    if (role === "left") return language.t("splitView.position.left")
    if (role === "middle") return language.t("splitView.position.middle")
    return language.t("splitView.position.right")
  })

  const sessionDetails = createMemo(() => {
    const target = pane.target()
    if (!target) {
      return {
        title: language.t("command.session.new"),
        directory: "",
        working: false,
        isDraft: true,
      }
    }

    if (target.type === "draft") {
      const draftTab = tabs.store.find((item) => item.type === "draft" && item.draftID === target.draftID)
      const dir = (draftTab?.type === "draft" ? draftTab.directory : undefined) || target.directory || ""
      return {
        title: language.t("command.session.new"),
        directory: directoryLabel(dir),
        working: false,
        isDraft: true,
      }
    }

    const conn = global.servers.list().find((item) => ServerConnection.key(item) === target.server)
    const ctx = conn ? global.ensureServerCtx(conn) : undefined
    const info = ctx?.data.session.get(target.sessionId)
    const activeIds = ctx?.data.session.active() ?? []
    const tabMeta = tabs.info[tabKey({ type: "session", server: target.server, sessionId: target.sessionId })]
    const rawTitle = info?.title ?? tabMeta?.title
    const normalized = normalizeSessionTitle(rawTitle) || sessionTabTitle(rawTitle, language.t("session.tab.session"))
    const dir = info?.location.directory || tabMeta?.directory || target.directory || ""

    return {
      title: normalized,
      directory: directoryLabel(dir),
      working: activeIds.includes(target.sessionId),
      isDraft: false,
    }
  })

  const handleHeaderPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || pane.count() <= 1) return
    if (e.target instanceof Element && e.target.closest("[data-slot='split-pane-actions']")) return

    const startX = e.clientX
    const startY = e.clientY
    const details = sessionDetails()
    let dragging = false

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX
      const dy = moveEvent.clientY - startY
      if (!dragging) {
        if (Math.hypot(dx, dy) < 6) return
        dragging = true
        split.startPointerDrag({
          kind: "pane",
          paneId: pane.paneId,
          title: details.title,
          directory: details.directory,
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
    <header
      data-slot="split-pane-header"
      onPointerDown={handleHeaderPointerDown}
      onClick={() => pane.focus()}
      class="flex h-8 shrink-0 cursor-grab items-center justify-between gap-2 border-b px-2.5 text-[12px] leading-4 select-none transition-colors active:cursor-grabbing"
      classList={{
        "border-v2-border-border-base/80 bg-v2-background-bg-layer-02/70 text-v2-text-text-base": pane.focused(),
        "border-v2-border-border-muted/60 bg-v2-background-bg-deep/40 text-v2-text-text-muted": !pane.focused(),
      }}
    >
      <div class="flex min-w-0 flex-1 items-center gap-1.5">
        <span
          data-slot="split-pane-position"
          data-position={positionRole()}
          class="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] leading-3 [font-weight:560] tracking-tight transition-colors"
          classList={{
            "bg-v2-background-bg-accent/15 text-v2-text-text-base ring-1 ring-inset ring-v2-background-bg-accent/40":
              pane.focused(),
            "bg-v2-overlay-simple-overlay-hover text-v2-text-text-faint": !pane.focused(),
          }}
        >
          <span
            class="size-1.5 rounded-full transition-colors"
            classList={{
              "bg-v2-background-bg-accent": pane.focused(),
              "bg-v2-icon-icon-faint/60": !pane.focused(),
            }}
          />
          <span>{positionText()}</span>
        </span>

        <Show when={sessionDetails().working}>
          <SessionProgressIndicatorV2 class="shrink-0" />
        </Show>

        <span
          data-slot="split-pane-title"
          dir="auto"
          class="min-w-0 truncate text-[12px] leading-4"
          classList={{
            "[font-weight:540] text-v2-text-text-base": pane.focused(),
            "text-v2-text-text-muted": !pane.focused(),
          }}
        >
          {sessionDetails().title}
        </span>

        <Show when={sessionDetails().directory}>
          <span
            data-slot="split-pane-project"
            class="hidden min-w-0 max-w-[140px] shrink-0 items-center gap-1 rounded bg-v2-overlay-simple-overlay-hover/70 px-1.5 py-0.5 text-[10px] leading-3 text-v2-text-text-faint sm:inline-flex"
          >
            <Icon name="folder" size="small" class="size-2.5 shrink-0 opacity-70" />
            <span class="truncate" dir="auto">
              {sessionDetails().directory}
            </span>
          </span>
        </Show>
      </div>

      <div data-slot="split-pane-actions" class="flex shrink-0 items-center gap-0.5">
        <Tooltip placement="bottom" value={language.t("splitView.pane.newSession")}>
          <button
            type="button"
            data-action="split-pane-new-session"
            aria-label={language.t("splitView.pane.newSession")}
            onClick={(e) => {
              e.stopPropagation()
              pane.newSession()
            }}
            class="flex size-5 items-center justify-center rounded text-v2-icon-icon-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
          >
            <Icon name="plus" size="small" />
          </button>
        </Tooltip>

        <Tooltip placement="bottom" value={language.t("splitView.pane.moveLeft")}>
          <button
            type="button"
            data-action="split-pane-move-left"
            aria-label={language.t("splitView.pane.moveLeft")}
            disabled={pane.index() === 0}
            onClick={(e) => {
              e.stopPropagation()
              pane.moveLeft()
            }}
            class="flex size-5 items-center justify-center rounded text-v2-icon-icon-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:pointer-events-none disabled:opacity-30"
          >
            <Icon name="outline-arrow-left" size="small" />
          </button>
        </Tooltip>

        <Tooltip placement="bottom" value={language.t("splitView.pane.moveRight")}>
          <button
            type="button"
            data-action="split-pane-move-right"
            aria-label={language.t("splitView.pane.moveRight")}
            disabled={pane.index() >= pane.count() - 1}
            onClick={(e) => {
              e.stopPropagation()
              pane.moveRight()
            }}
            class="flex size-5 items-center justify-center rounded text-v2-icon-icon-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base disabled:pointer-events-none disabled:opacity-30"
          >
            <Icon name="outline-arrow-right" size="small" />
          </button>
        </Tooltip>

        <Tooltip placement="bottom" value={language.t("splitView.pane.maximize")}>
          <button
            type="button"
            data-action="split-pane-maximize"
            aria-label={language.t("splitView.pane.maximize")}
            onClick={(e) => {
              e.stopPropagation()
              pane.maximize()
            }}
            class="flex size-5 items-center justify-center rounded text-v2-icon-icon-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
          >
            <Icon name="expand" size="small" />
          </button>
        </Tooltip>

        <Tooltip placement="bottom" value={language.t("splitView.pane.close")}>
          <button
            type="button"
            data-action="split-pane-close"
            aria-label={language.t("splitView.pane.close")}
            onClick={(e) => {
              e.stopPropagation()
              pane.close()
            }}
            class="flex size-5 items-center justify-center rounded text-v2-icon-icon-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
          >
            <Icon name="xmark-small" size="small" />
          </button>
        </Tooltip>
      </div>
    </header>
  )
}

function PaneSessionView(props: { target: Extract<SplitPaneTarget, { type: "session" }> }) {
  const global = useGlobal()

  const connection = createMemo(() =>
    global.servers.list().find((item) => ServerConnection.key(item) === props.target.server),
  )

  return (
    <SessionRouteFrame>
      <Suspense
        fallback={
          <div class="flex min-h-0 flex-1">
            <SessionPanelFrame raised />
          </div>
        }
      >
        <Show when={connection()} keyed>
          {(conn) => (
            <ServerProvider conn={conn}>
              <TargetSessionRouteContent />
            </ServerProvider>
          )}
        </Show>
      </Suspense>
    </SessionRouteFrame>
  )
}

function SplitPaneBody() {
  const pane = useSplitPane()!

  return (
    <div
      data-slot="split-pane-body"
      class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      style={{
        "--shell-inline-inset": "0px",
        "--shell-top-inset": "0px",
        "--shell-bottom-inset": "0px",
      }}
    >
      <Switch
        fallback={
          <Suspense fallback={<SessionPanelFrame />}>
            <DraftRoute />
          </Suspense>
        }
      >
        <Match when={pane.target()?.type === "session" ? (pane.target() as Extract<SplitPaneTarget, { type: "session" }>) : undefined}>
          {(sessionTarget) => <PaneSessionView target={sessionTarget()} />}
        </Match>
      </Switch>
    </div>
  )
}

function SplitPaneColumn(props: { paneId: string; index: Accessor<number>; ratio: Accessor<number> }) {
  return (
    <SplitPaneProvider paneId={props.paneId} index={props.index}>
      <SplitPaneColumnInner ratio={props.ratio} />
    </SplitPaneProvider>
  )
}

function SplitPaneColumnInner(props: { ratio: Accessor<number> }) {
  const pane = useSplitPane()!
  const positionRole = createMemo(() => panePositionRole(pane.index(), pane.count()))

  return (
    <section
      ref={(el) => pane.setRootElement(el)}
      data-slot="split-pane"
      data-pane-id={pane.paneId}
      data-pane-index={pane.index()}
      data-pane-position={positionRole()}
      data-focused={pane.focused() ? "true" : undefined}
      onPointerDown={() => pane.focus()}
      onFocusIn={() => pane.focus()}
      style={{
        flex: `${Math.max(0.1, props.ratio())} 1 0%`,
      }}
      class="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[10px] border bg-v2-background-bg-base transition-colors"
      classList={{
        "border-v2-border-border-focus/85 shadow-[var(--v2-elevation-raised)]": pane.focused(),
        "border-v2-border-border-base/60 opacity-[0.98]": !pane.focused(),
      }}
    >
      <SplitPaneHeader />
      <SplitPaneBody />
    </section>
  )
}

function SplitColumnResizer(props: {
  leftIndex: number
  containerWidth: () => number
  onResize: (leftIndex: number, deltaRatio: number) => void
  onReset: () => void
}) {
  const [dragging, setDragging] = createSignal(false)

  const handlePointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    setDragging(true)

    let lastX = e.clientX

    const onMove = (moveEvent: PointerEvent) => {
      const width = Math.max(320, props.containerWidth())
      const dx = moveEvent.clientX - lastX
      if (Math.abs(dx) < 1) return
      lastX = moveEvent.clientX
      props.onResize(props.leftIndex, dx / width)
    }

    const onUp = (upEvent: PointerEvent) => {
      setDragging(false)
      if (target.hasPointerCapture(upEvent.pointerId)) {
        target.releasePointerCapture(upEvent.pointerId)
      }
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      data-slot="split-pane-resizer"
      data-resizer-index={props.leftIndex}
      onPointerDown={handlePointerDown}
      onDblClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        props.onReset()
      }}
      class="group/resizer relative z-10 flex h-full w-2 shrink-0 cursor-col-resize items-center justify-center select-none"
    >
      <div
        class="h-12 w-1 rounded-full transition-all"
        classList={{
          "h-full bg-v2-background-bg-accent": dragging(),
          "bg-v2-border-border-base/50 group-hover/resizer:h-24 group-hover/resizer:bg-v2-border-border-strong":
            !dragging(),
        }}
      />
    </div>
  )
}

export function SplitWorkbench(props: ParentProps) {
  const split = useSplitView()
  const layout = useLayout()
  const settings = useSettingsSurface()
  const language = useLanguage()

  let containerRef: HTMLDivElement | undefined
  const [draggingSession, setDraggingSession] = createSignal(false)
  const [dropZone, setDropZone] = createSignal<SplitPanePosition | null>(null)

  const isSessionOrDraftRoute = createMemo(() => {
    const r = layout.route()
    return r.type === "session" || r.type === "draft"
  })

  const showSplitWorkbench = createMemo(() => split.active() && isSessionOrDraftRoute() && !settings.active())

  const allowThreeDropZones = createMemo(() => {
    const currentCount = split.count()
    if (currentCount === 1) return false
    const drag = split.activeDrag()
    if (currentCount === 2 && drag?.kind === "pane") return false
    return true
  })

  const computeDropZone = (clientX: number): SplitPanePosition => {
    if (!containerRef) return "right"
    const rect = containerRef.getBoundingClientRect()
    if (rect.width <= 0) return "right"
    const ratio = (clientX - rect.left) / rect.width
    if (!allowThreeDropZones()) {
      return ratio < 0.5 ? "left" : "right"
    }
    if (ratio < 0.333) return "left"
    if (ratio < 0.667) return "middle"
    return "right"
  }

  const resolvePointerDropZone = (clientX: number, clientY: number): SplitPanePosition | null => {
    if (!containerRef) return null
    const rect = containerRef.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      return null
    }
    return computeDropZone(clientX)
  }

  split.registerDropPositionResolver(resolvePointerDropZone)
  onCleanup(() => split.registerDropPositionResolver(undefined))

  const showDropOverlay = createMemo(() => draggingSession() || !!split.activeDrag())
  const activeDropZone = createMemo<SplitPanePosition | null>(
    () => dropZone() ?? split.activeDrag()?.hoverPosition ?? null,
  )

  const dropLabelForPosition = (pos: SplitPanePosition | null) => {
    if (pos === "left") return language.t("splitView.drop.left")
    if (pos === "middle") return language.t("splitView.drop.middle")
    if (pos === "right") return language.t("splitView.drop.right")
    return language.t("sessionSidebar.action.openSplit")
  }

  const handleDragOver = (e: DragEvent) => {
    if (!hasSessionDragMime(e.dataTransfer)) return
    e.preventDefault()
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move"
    }
    setDraggingSession(true)
    setDropZone(computeDropZone(e.clientX))
  }

  const handleDragLeave = (e: DragEvent) => {
    if (!containerRef) return
    const nextTarget = e.relatedTarget
    if (nextTarget instanceof Node && containerRef.contains(nextTarget)) return
    setDraggingSession(false)
    setDropZone(null)
  }

  const handleDrop = (e: DragEvent) => {
    if (!hasSessionDragMime(e.dataTransfer)) return
    e.preventDefault()
    e.stopPropagation()
    const zone = computeDropZone(e.clientX)
    const raw = e.dataTransfer?.getData(SESSION_DRAG_MIME)
    setDraggingSession(false)
    setDropZone(null)

    const payload = decodeSessionDragPayload(raw)
    if (!payload) return
    split.openSessionInSplit(
      {
        server: ServerConnection.Key.make(payload.server),
        sessionId: payload.sessionId,
        directory: payload.directory,
      },
      zone,
    )
  }

  const visibleDropZones = createMemo<
    Array<{
      position: SplitPanePosition
      labelKey: "splitView.drop.left" | "splitView.drop.middle" | "splitView.drop.right"
    }>
  >(() =>
    allowThreeDropZones()
      ? [
          { position: "left", labelKey: "splitView.drop.left" },
          { position: "middle", labelKey: "splitView.drop.middle" },
          { position: "right", labelKey: "splitView.drop.right" },
        ]
      : [
          { position: "left", labelKey: "splitView.drop.left" },
          { position: "right", labelKey: "splitView.drop.right" },
        ],
  )

  return (
    <div
      ref={containerRef}
      data-slot="split-workbench-host"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      class="relative flex size-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <Show when={showSplitWorkbench()} fallback={props.children}>
        <div
          data-slot="split-workbench"
          data-pane-count={split.count()}
          class="relative flex size-full min-h-0 min-w-0 flex-1 flex-row overflow-hidden px-[var(--shell-inline-inset,8px)] pb-[var(--shell-bottom-inset,8px)] pt-[var(--shell-top-inset,8px)]"
        >
          <For each={split.order()}>
            {(paneId, index) => (
              <>
                <SplitPaneColumn
                  paneId={paneId}
                  index={index}
                  ratio={() => split.ratios()[index()] ?? 1 / split.count()}
                />
                <Show when={index() < split.count() - 1}>
                  <SplitColumnResizer
                    leftIndex={index()}
                    containerWidth={() => containerRef?.clientWidth ?? 1200}
                    onResize={(leftIdx, deltaRatio) => split.resizeColumns(leftIdx, deltaRatio)}
                    onReset={() => split.resetColumnRatios()}
                  />
                </Show>
              </>
            )}
          </For>
        </div>
      </Show>

      <Show when={showDropOverlay()}>
        <div
          data-slot="split-drop-overlay"
          data-zone-count={visibleDropZones().length}
          class="pointer-events-none absolute inset-2 z-50 grid gap-2 rounded-xl bg-v2-background-bg-deep/65 p-2 backdrop-blur-xs"
          classList={{
            "grid-cols-2": !allowThreeDropZones(),
            "grid-cols-3": allowThreeDropZones(),
          }}
        >
          <For each={visibleDropZones()}>
            {(zone) => (
              <div
                data-slot="split-drop-zone"
                data-drop-position={zone.position}
                data-active={activeDropZone() === zone.position ? "true" : undefined}
                class="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed transition-all"
                classList={{
                  "border-v2-background-bg-accent bg-v2-background-bg-accent/15 text-v2-text-text-base scale-[0.99]":
                    activeDropZone() === zone.position,
                  "border-v2-border-border-base/70 bg-v2-background-bg-base/50 text-v2-text-text-muted":
                    activeDropZone() !== zone.position,
                }}
              >
                <Show when={allowThreeDropZones()} fallback={<TwoPanesIcon class="size-5" />}>
                  <ThreePanesIcon class="size-5" />
                </Show>
                <span class="text-[13px] [font-weight:560]">{language.t(zone.labelKey)}</span>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={split.activeDrag()}>
        {(drag) => (
          <Portal>
            <div
              data-slot="split-drag-preview"
              style={{
                left: `${drag().clientX + 14}px`,
                top: `${drag().clientY + 14}px`,
              }}
              class="pointer-events-none fixed z-[9999] flex max-w-[260px] select-none items-center gap-2 rounded-lg border border-v2-border-border-strong bg-v2-background-bg-layer-02 px-2.5 py-1.5 text-[12px] leading-4 text-v2-text-text-base shadow-lg backdrop-blur-md [font-family:var(--v2-font-family-sans)]"
            >
              <Show
                when={allowThreeDropZones()}
                fallback={<TwoPanesIcon class="size-3.5 shrink-0 text-v2-icon-icon-muted" />}
              >
                <ThreePanesIcon class="size-3.5 shrink-0 text-v2-icon-icon-muted" />
              </Show>
              <span class="min-w-0 flex-1 truncate [font-weight:540]" dir="auto">
                {drag().title}
              </span>
              <span
                class="shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-3 [font-weight:560]"
                classList={{
                  "bg-v2-background-bg-accent text-white": !!drag().hoverPosition,
                  "bg-v2-overlay-simple-overlay-hover text-v2-text-text-muted": !drag().hoverPosition,
                }}
              >
                {dropLabelForPosition(drag().hoverPosition)}
              </span>
            </div>
          </Portal>
        )}
      </Show>
    </div>
  )
}
