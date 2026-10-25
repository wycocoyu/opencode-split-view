import {
  type Accessor,
  type ParentProps,
  batch,
  createContext,
  createEffect,
  createMemo,
  createRenderEffect,
  createSignal,
  untrack,
  useContext,
} from "solid-js"
import {
  RouterContext,
  useLocation,
  useNavigate,
  type Location,
  type NavigateOptions,
  type Navigator,
  type Params,
  type SearchParams,
} from "@solidjs/router"
import { makeEventListener } from "@solid-primitives/event-listener"
import { base64Encode } from "@opencode/util/encode"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { CommandFocusScopeProvider, useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { sessionHref } from "@/shell/routes/session"
import { currentRoute, useLayout } from "@/shell/state/layout"
import { draftHref, tabKey, useTabs } from "@/shell/tabs/tabs"
import { readSessionTabsRemovedDetail, SESSION_TABS_REMOVED_EVENT } from "@/shell/titlebar/session-events"
import {
  clampPaneCount,
  closeSplitPane,
  createInitialSplitViewState,
  equalRatios,
  focusAdjacentSplitPane,
  moveSplitPane,
  openInFocusedPane,
  openInSpecificPane,
  openInSplitPane,
  panePositionIndex,
  promoteDraftInSplitView,
  resizePairRatios,
  samePaneTarget,
  sanitizeSplitViewState,
  setSplitPaneCount,
  SplitViewPersistedSchema,
  type SplitPaneCount,
  type SplitPanePosition,
  type SplitPaneTarget,
  type SplitViewState,
} from "./model"

export type SplitPaneContextValue = {
  paneId: string
  index: Accessor<number>
  count: Accessor<SplitPaneCount>
  focused: Accessor<boolean>
  target: Accessor<SplitPaneTarget | undefined>
  focus: () => void
  close: () => void
  moveLeft: () => void
  moveRight: () => void
  maximize: () => void
  newSession: () => void
  setRootElement: (el: HTMLElement | undefined) => void
  containsTarget: (target: EventTarget | null | undefined) => boolean
}

const SplitPaneContext = createContext<SplitPaneContextValue>()

export function useSplitPane() {
  return useContext(SplitPaneContext)
}

export type ActiveSplitDrag = {
  kind: "session" | "pane"
  title: string
  directory?: string
  server?: ServerConnection.Key
  sessionId?: string
  paneId?: string
  clientX: number
  clientY: number
  hoverPosition: SplitPanePosition | null
}

export type SplitViewContextValue = {
  ready: Accessor<boolean>
  state: Accessor<SplitViewState>
  count: Accessor<SplitPaneCount>
  active: Accessor<boolean>
  order: Accessor<readonly string[]>
  focusedId: Accessor<string>
  focusedIndex: Accessor<number>
  ratios: Accessor<readonly number[]>
  activeDrag: Accessor<ActiveSplitDrag | null>
  paneTarget: (paneId: string) => SplitPaneTarget | undefined
  sessionPaneIndex: (server: ServerConnection.Key | string, sessionId: string) => number
  isSessionFocused: (server: ServerConnection.Key | string, sessionId: string) => boolean
  setLayoutCount: (count: SplitPaneCount) => void
  splitRight: (target?: SplitPaneTarget) => void
  openSessionInFocused: (target: { server: ServerConnection.Key; sessionId: string; directory?: string }) => void
  openSessionInSplit: (
    target: { server: ServerConnection.Key; sessionId: string; directory?: string },
    position?: SplitPanePosition,
  ) => void
  openTargetInPane: (paneId: string, target: SplitPaneTarget) => void
  openNewSessionInPane: (paneId?: string, directory?: string) => void
  focusPane: (paneId: string) => void
  focusPaneByIndex: (index: number) => void
  focusAdjacent: (delta: -1 | 1) => void
  movePane: (paneId: string, direction: "left" | "right") => void
  movePaneToPosition: (paneId: string, position: SplitPanePosition) => void
  closePane: (paneId?: string) => void
  maximizePane: (paneId: string) => void
  resizeColumns: (leftIndex: number, deltaRatio: number) => void
  resetColumnRatios: () => void
  startPointerDrag: (input: Omit<ActiveSplitDrag, "hoverPosition">) => void
  updatePointerDrag: (clientX: number, clientY: number) => void
  endPointerDrag: (clientX: number, clientY: number) => boolean
  cancelPointerDrag: () => void
  registerDropPositionResolver: (
    resolver: ((clientX: number, clientY: number) => SplitPanePosition | null) | undefined,
  ) => void
}

const SplitViewContext = createContext<SplitViewContextValue>()

export function useSplitView() {
  const ctx = useContext(SplitViewContext)
  if (!ctx) throw new Error("useSplitView must be used within a SplitViewProvider")
  return ctx
}

export function useOptionalSplitView() {
  return useContext(SplitViewContext)
}

function targetHref(target: SplitPaneTarget): string {
  if (target.type === "draft") return draftHref(target.draftID)
  return sessionHref(target.server, target.sessionId)
}

export function SplitViewProvider(props: ParentProps) {
  const global = useGlobal()
  const layout = useLayout()
  const tabs = useTabs()
  const navigate = useNavigate()
  const location = useLocation()
  const command = useCommand()
  const language = useLanguage()

  const [persistedState, setPersistedState, , ready] = persisted(
    Persist.window("split-view.v1"),
    SplitViewPersistedSchema,
    createInitialSplitViewState(),
  )

  const state = createMemo<SplitViewState>(() =>
    sanitizeSplitViewState({
      order: [...persistedState.order],
      byId: { ...persistedState.byId },
      focusedId: persistedState.focusedId,
      ratios: [...persistedState.ratios],
    }),
  )

  const commitState = (next: SplitViewState, options?: { syncUrl?: boolean }) => {
    const clean = sanitizeSplitViewState(next)
    batch(() => {
      setPersistedState("order", clean.order)
      setPersistedState("byId", clean.byId)
      setPersistedState("focusedId", clean.focusedId)
      setPersistedState("ratios", clean.ratios)
    })

    if (options?.syncUrl !== false) {
      const focusedTarget = clean.byId[clean.focusedId]
      if (focusedTarget) {
        const href = targetHref(focusedTarget)
        const currentUrl = `${location.pathname}${location.search}`
        if (currentUrl !== href) {
          navigate(href, { replace: true })
        }
      }
    }
  }

  const resolveDefaultContext = (fromState?: SplitViewState): { server: ServerConnection.Key; directory: string } => {
    const current = fromState ?? state()
    const focused = current.byId[current.focusedId] ?? current.byId[current.order[0] ?? ""]

    if (focused) {
      if (focused.type === "draft") {
        return { server: focused.server, directory: focused.directory }
      }
      const conn = global.servers.list().find((item) => ServerConnection.key(item) === focused.server)
      const ctx = conn ? global.ensureServerCtx(conn) : undefined
      const sessionInfo = ctx?.data.session.get(focused.sessionId)
      const tabInfo = tabs.info[tabKey({ type: "session", server: focused.server, sessionId: focused.sessionId })]
      const dir =
        focused.directory ||
        sessionInfo?.location.directory ||
        tabInfo?.directory ||
        ctx?.projects.last() ||
        ctx?.projects.list()[0]?.worktree ||
        ""
      return { server: focused.server, directory: dir }
    }

    const selection = layout.home.selection()
    const conn =
      global.servers.list().find((item) => ServerConnection.key(item) === selection.server) ?? global.servers.list()[0]
    const serverKey = conn ? ServerConnection.key(conn) : ServerConnection.Key.make("local")
    const projects = conn ? global.ensureServerCtx(conn).projects : undefined
    const project =
      projects?.list().find((item) => item.worktree === selection.directory) ??
      projects?.list().find((item) => item.worktree === projects.last()) ??
      projects?.list()[0]
    return {
      server: serverKey,
      directory: project?.worktree ?? selection.directory ?? "",
    }
  }

  const createDraftPaneTarget = (fromState?: SplitViewState, overrideDirectory?: string): SplitPaneTarget => {
    const ctx = resolveDefaultContext(fromState)
    const directory = overrideDirectory ?? ctx.directory
    const draftTab = tabs.createDraftTab({ server: ctx.server, directory })
    return {
      type: "draft",
      draftID: draftTab.draftID,
      server: draftTab.server,
      directory: draftTab.directory,
    }
  }

  // Sync global route changes (e.g. clicking sidebar session, clicking new session, or browser back/forward)
  // into the currently focused pane (or focus the pane that already shows that session/draft).
  createEffect(() => {
    if (!ready() || !tabs.ready()) return
    const route = layout.route()

    untrack(() => {
      const current = state()

      if (route.type === "session") {
        const conn = global.servers.list().find((item) => ServerConnection.key(item) === route.server)
        const dir = conn ? global.serverCtx(route.server)?.data.session.get(route.sessionId)?.location.directory : undefined
        const target: SplitPaneTarget = {
          type: "session",
          server: route.server,
          sessionId: route.sessionId,
          ...(dir ? { directory: dir } : {}),
        }
        const next = openInFocusedPane(current, target)
        if (
          next.focusedId !== current.focusedId ||
          !samePaneTarget(next.byId[next.focusedId], current.byId[current.focusedId])
        ) {
          commitState(next, { syncUrl: false })
        }
        return
      }

      if (route.type === "draft") {
        const draftTab = tabs.store.find((item) => item.type === "draft" && item.draftID === route.draftID)
        const fallback = resolveDefaultContext(current)
        const target: SplitPaneTarget = {
          type: "draft",
          draftID: route.draftID,
          server: draftTab?.type === "draft" ? draftTab.server : fallback.server,
          directory: draftTab?.type === "draft" ? draftTab.directory : fallback.directory,
        }
        const next = openInFocusedPane(current, target)
        if (
          next.focusedId !== current.focusedId ||
          !samePaneTarget(next.byId[next.focusedId], current.byId[current.focusedId])
        ) {
          commitState(next, { syncUrl: false })
        }
      }
    })
  })

  // Ensure every pane's backing tab exists in `tabs.store`, and promote any draft pane whose draftID was promoted.
  createRenderEffect(() => {
    if (!ready() || !tabs.ready()) return
    const current = state()

    let updated: SplitViewState | undefined
    for (const paneId of current.order) {
      const target = current.byId[paneId]
      if (!target) continue

      if (target.type === "draft") {
        const promoted = tabs.promotedDraft(target.draftID)
        if (promoted) {
          updated = promoteDraftInSplitView(updated ?? current, target.draftID, promoted)
          continue
        }
        const exists = tabs.store.some((item) => item.type === "draft" && item.draftID === target.draftID)
        if (!exists) {
          untrack(() => {
            tabs.createDraftTab({
              draftID: target.draftID,
              server: target.server,
              directory: target.directory,
            })
          })
        }
      } else if (target.type === "session") {
        const exists = tabs.store.some(
          (item) =>
            item.type === "session" &&
            item.server === target.server &&
            (item.sessionId === target.sessionId || item.routeSessionId === target.sessionId),
        )
        if (!exists) {
          untrack(() => {
            tabs.addSessionTab({ server: target.server, sessionId: target.sessionId })
          })
        }
      }
    }

    if (updated) {
      untrack(() => commitState(updated!))
    }
  })

  // Handle deleted or archived sessions across split panes
  makeEventListener(window, SESSION_TABS_REMOVED_EVENT, (event) => {
    const detail = readSessionTabsRemovedDetail(event)
    if (!detail) return
    const removedSet = new Set(detail.sessionIDs)
    let current = state()
    let changed = false

    for (const paneId of [...current.order]) {
      const target = current.byId[paneId]
      if (target?.type === "session" && target.server === detail.server && removedSet.has(target.sessionId)) {
        if (current.order.length > 1) {
          current = closeSplitPane(current, paneId)
          changed = true
        }
      }
    }

    if (changed) {
      commitState(current)
    }
  })

  const count = createMemo<SplitPaneCount>(() => clampPaneCount(state().order.length))
  const active = createMemo(() => count() > 1)
  const order = createMemo(() => state().order)
  const focusedId = createMemo(() => state().focusedId)
  const focusedIndex = createMemo(() => Math.max(0, state().order.indexOf(state().focusedId)))
  const ratios = createMemo(() => state().ratios)

  const paneTarget = (paneId: string) => state().byId[paneId]

  const sessionPaneIndex = (server: ServerConnection.Key | string, sessionId: string) =>
    panePositionIndex(state(), server, sessionId)

  const isSessionFocused = (server: ServerConnection.Key | string, sessionId: string) => {
    const current = state()
    const focused = current.byId[current.focusedId]
    return focused?.type === "session" && focused.server === server && focused.sessionId === sessionId
  }

  const ensurePrimaryTarget = (current: SplitViewState): SplitViewState => {
    const firstId = current.order[0] ?? "pane-0"
    if (current.byId[firstId]) return current
    const draft = createDraftPaneTarget(current)
    return {
      ...current,
      order: current.order.length ? current.order : [firstId],
      byId: { ...current.byId, [firstId]: draft },
      focusedId: firstId,
    }
  }

  const setLayoutCount = (targetCount: SplitPaneCount) => {
    const current = ensurePrimaryTarget(state())
    const next = setSplitPaneCount(current, targetCount, (_idx, intermediate) => createDraftPaneTarget(intermediate))
    commitState(next)
  }

  const splitRight = (target?: SplitPaneTarget) => {
    const current = ensurePrimaryTarget(state())
    if (target) {
      commitState(openInSplitPane(current, target))
      return
    }
    const nextCount = clampPaneCount(Math.min(3, current.order.length + 1))
    if (nextCount === current.order.length) {
      // Already at 3 panes: open a new session draft in the focused pane
      const draft = createDraftPaneTarget(current)
      commitState(openInSpecificPane(current, current.focusedId, draft))
      return
    }
    setLayoutCount(nextCount)
  }

  const openSessionInFocused = (input: {
    server: ServerConnection.Key
    sessionId: string
    directory?: string
  }) => {
    tabs.addSessionTab({ server: input.server, sessionId: input.sessionId })
    const next = openInFocusedPane(state(), {
      type: "session",
      server: input.server,
      sessionId: input.sessionId,
      directory: input.directory,
    })
    commitState(next)
  }

  const openSessionInSplit = (
    input: {
      server: ServerConnection.Key
      sessionId: string
      directory?: string
    },
    position?: SplitPanePosition,
  ) => {
    const current = ensurePrimaryTarget(state())
    tabs.addSessionTab({ server: input.server, sessionId: input.sessionId })
    const sessionTarget: SplitPaneTarget = {
      type: "session",
      server: input.server,
      sessionId: input.sessionId,
      directory: input.directory,
    }
    const firstId = current.order[0]
    if (current.order.length === 1 && firstId && samePaneTarget(current.byId[firstId], sessionTarget)) {
      const draft = createDraftPaneTarget(current, input.directory)
      const splitWithDraft = openInSplitPane(current, draft, position === "left" ? "right" : "left")
      commitState({
        ...splitWithDraft,
        focusedId: firstId,
      })
      return
    }
    const next = openInSplitPane(current, sessionTarget, position)
    commitState(next)
  }

  const movePaneToPosition = (paneId: string, position: SplitPanePosition) => {
    const current = state()
    const currentIdx = current.order.indexOf(paneId)
    if (currentIdx === -1) return
    const targetIdx =
      position === "left" ? 0 : position === "middle" ? Math.min(1, current.order.length - 1) : current.order.length - 1
    if (currentIdx === targetIdx) {
      focusPane(paneId)
      return
    }
    const nextOrder = [...current.order]
    nextOrder.splice(currentIdx, 1)
    nextOrder.splice(targetIdx, 0, paneId)
    commitState(
      {
        ...current,
        order: nextOrder,
        focusedId: paneId,
        ratios: equalRatios(nextOrder.length),
      },
      { syncUrl: false },
    )
  }

  const [activeDrag, setActiveDrag] = createSignal<ActiveSplitDrag | null>(null)
  let dropPositionResolver: ((clientX: number, clientY: number) => SplitPanePosition | null) | undefined

  const registerDropPositionResolver = (
    resolver: ((clientX: number, clientY: number) => SplitPanePosition | null) | undefined,
  ) => {
    dropPositionResolver = resolver
  }

  const startPointerDrag = (input: Omit<ActiveSplitDrag, "hoverPosition">) => {
    const hoverPosition = dropPositionResolver ? dropPositionResolver(input.clientX, input.clientY) : null
    setActiveDrag({
      ...input,
      hoverPosition,
    })
  }

  const updatePointerDrag = (clientX: number, clientY: number) => {
    const prev = activeDrag()
    if (!prev) return
    const hoverPosition = dropPositionResolver ? dropPositionResolver(clientX, clientY) : null
    setActiveDrag({
      ...prev,
      clientX,
      clientY,
      hoverPosition,
    })
  }

  const cancelPointerDrag = () => {
    setActiveDrag(null)
  }

  const endPointerDrag = (clientX: number, clientY: number): boolean => {
    const drag = activeDrag()
    setActiveDrag(null)
    if (!drag) return false
    const position = dropPositionResolver ? dropPositionResolver(clientX, clientY) : drag.hoverPosition
    if (!position) return false

    if (drag.kind === "pane" && drag.paneId) {
      movePaneToPosition(drag.paneId, position)
      return true
    }

    if (drag.kind === "session" && drag.server && drag.sessionId) {
      openSessionInSplit(
        {
          server: drag.server,
          sessionId: drag.sessionId,
          directory: drag.directory,
        },
        position,
      )
      return true
    }

    return false
  }

  const openTargetInPane = (paneId: string, target: SplitPaneTarget) => {
    if (target.type === "session") {
      tabs.addSessionTab({ server: target.server, sessionId: target.sessionId })
    } else {
      tabs.createDraftTab({
        draftID: target.draftID,
        server: target.server,
        directory: target.directory,
      })
    }
    const next = openInSpecificPane(state(), paneId, target)
    commitState(next)
  }

  const openNewSessionInPane = (paneId?: string, directory?: string) => {
    const current = ensurePrimaryTarget(state())
    const targetPaneId = paneId && current.order.includes(paneId) ? paneId : current.focusedId
    const paneCurrent = current.byId[targetPaneId]
    const dir =
      directory ??
      (paneCurrent?.type === "draft" ? paneCurrent.directory : paneCurrent?.directory) ??
      resolveDefaultContext(current).directory
    const draft = createDraftPaneTarget(current, dir)
    const next = openInSpecificPane(current, targetPaneId, draft)
    commitState(next)
  }

  const focusPane = (paneId: string) => {
    const current = state()
    if (!current.order.includes(paneId)) return
    if (current.focusedId === paneId) return
    commitState({
      ...current,
      focusedId: paneId,
    })
  }

  const focusPaneByIndex = (index: number) => {
    const current = state()
    const paneId = current.order[index]
    if (paneId) focusPane(paneId)
  }

  const focusAdjacent = (delta: -1 | 1) => {
    commitState(focusAdjacentSplitPane(state(), delta))
  }

  const movePane = (paneId: string, direction: "left" | "right") => {
    commitState(moveSplitPane(state(), paneId, direction), { syncUrl: false })
  }

  const closePane = (paneId?: string) => {
    const current = state()
    if (current.order.length <= 1) return
    const targetId = paneId ?? current.focusedId
    commitState(closeSplitPane(current, targetId))
  }

  const maximizePane = (paneId: string) => {
    const current = state()
    if (!current.order.includes(paneId)) return
    const withFocus = { ...current, focusedId: paneId }
    commitState(setSplitPaneCount(withFocus, 1, () => createDraftPaneTarget(withFocus)))
  }

  const resizeColumns = (leftIndex: number, deltaRatio: number) => {
    const current = state()
    const nextRatios = resizePairRatios(current.ratios, leftIndex, deltaRatio)
    setPersistedState("ratios", nextRatios)
  }

  const resetColumnRatios = () => {
    const current = state()
    setPersistedState("ratios", equalRatios(current.order.length))
  }

  command.register("split-view", () => [
    {
      id: "split.layout.1",
      title: language.t("splitView.command.single"),
      category: language.t("command.category.view"),
      keybind: "mod+alt+1",
      disabled: count() === 1,
      onSelect: () => setLayoutCount(1),
    },
    {
      id: "split.layout.2",
      title: language.t("splitView.command.twoPanes"),
      category: language.t("command.category.view"),
      keybind: "mod+alt+2",
      onSelect: () => setLayoutCount(count() === 2 ? 1 : 2),
    },
    {
      id: "split.layout.3",
      title: language.t("splitView.command.threePanes"),
      category: language.t("command.category.view"),
      keybind: "mod+alt+3",
      onSelect: () => setLayoutCount(count() === 3 ? 1 : 3),
    },
    {
      id: "split.right",
      title: language.t("splitView.command.splitRight"),
      category: language.t("command.category.view"),
      keybind: "mod+shift+\\",
      onSelect: () => splitRight(),
    },
    {
      id: "split.close",
      title: language.t("splitView.command.closePane"),
      category: language.t("command.category.view"),
      disabled: count() <= 1,
      onSelect: () => closePane(),
    },
    {
      id: "split.focusPrev",
      title: language.t("splitView.command.focusPrev"),
      category: language.t("command.category.view"),
      keybind: "mod+alt+[",
      disabled: count() <= 1,
      onSelect: () => focusAdjacent(-1),
    },
    {
      id: "split.focusNext",
      title: language.t("splitView.command.focusNext"),
      category: language.t("command.category.view"),
      keybind: "mod+alt+]",
      disabled: count() <= 1,
      onSelect: () => focusAdjacent(1),
    },
    {
      id: "split.equalize",
      title: language.t("splitView.command.equalize"),
      category: language.t("command.category.view"),
      disabled: count() <= 1,
      onSelect: () => resetColumnRatios(),
    },
  ])

  const value: SplitViewContextValue = {
    ready,
    state,
    count,
    active,
    order,
    focusedId,
    focusedIndex,
    ratios,
    activeDrag,
    paneTarget,
    sessionPaneIndex,
    isSessionFocused,
    setLayoutCount,
    splitRight,
    openSessionInFocused,
    openSessionInSplit,
    openTargetInPane,
    openNewSessionInPane,
    focusPane,
    focusPaneByIndex,
    focusAdjacent,
    movePane,
    movePaneToPosition,
    closePane,
    maximizePane,
    resizeColumns,
    resetColumnRatios,
    startPointerDrag,
    updatePointerDrag,
    endPointerDrag,
    cancelPointerDrag,
    registerDropPositionResolver,
  }

  return <SplitViewContext.Provider value={value}>{props.children}</SplitViewContext.Provider>
}

export function SplitPaneProvider(
  props: ParentProps<{
    paneId: string
    index: Accessor<number>
  }>,
) {
  const split = useSplitView()
  const parentRouter = useContext(RouterContext)
  if (!parentRouter) throw new Error("SplitPaneProvider must be used inside a Router")

  let rootEl: HTMLElement | undefined
  const [paneHash, setPaneHash] = createSignal("")
  const [paneNavState, setPaneNavState] = createSignal<unknown>(null)
  const [panePromptParam, setPanePromptParam] = createSignal<string | undefined>(undefined)

  const target = createMemo(() => split.paneTarget(props.paneId))
  const focused = createMemo(() => split.focusedId() === props.paneId)

  const paneParams: Params = {
    get serverKey() {
      const t = target()
      return t ? base64Encode(t.server) : parentRouter.params.serverKey
    },
    get id() {
      const t = target()
      return t?.type === "session" ? t.sessionId : undefined
    },
  }

  const paneQuery: SearchParams = {
    get draftId() {
      const t = target()
      return t?.type === "draft" ? t.draftID : undefined
    },
    get prompt() {
      return panePromptParam()
    },
  }

  const paneLocation: Location<any> = {
    get pathname() {
      const t = target()
      if (!t) return "/"
      if (t.type === "draft") return "/new-session"
      return sessionHref(t.server, t.sessionId)
    },
    get search() {
      const t = target()
      if (t?.type !== "draft") return ""
      const params = new URLSearchParams()
      params.set("draftId", t.draftID)
      const p = panePromptParam()
      if (p) params.set("prompt", p)
      return `?${params.toString()}`
    },
    get hash() {
      return paneHash()
    },
    get query() {
      return paneQuery
    },
    get state() {
      return (paneNavState() as Record<string, unknown> | null) ?? null
    },
    get key() {
      const t = target()
      if (!t) return props.paneId
      return t.type === "draft" ? `${props.paneId}:draft:${t.draftID}` : `${props.paneId}:session:${t.sessionId}`
    },
  }

  const paneNavigator: Navigator = ((to: string | number, options?: Partial<NavigateOptions>) => {
    const parentNavigate = parentRouter.navigatorFactory()
    if (typeof to === "number") {
      parentNavigate(to)
      return
    }

    const url = new URL(to, "http://opencode.local")
    setPaneHash(url.hash || "")
    setPaneNavState(options?.state ?? null)

    const promptParam = url.searchParams.get("prompt") ?? undefined
    setPanePromptParam(promptParam)

    let parsed: ReturnType<typeof currentRoute> | undefined
    try {
      parsed = currentRoute(url.pathname, url.search)
    } catch {
      parsed = undefined
    }

    if (parsed?.type === "session") {
      split.openTargetInPane(props.paneId, {
        type: "session",
        server: parsed.server,
        sessionId: parsed.sessionId,
      })
      return
    }

    if (parsed?.type === "draft") {
      const current = target()
      split.openTargetInPane(props.paneId, {
        type: "draft",
        draftID: parsed.draftID,
        server: current?.server ?? ServerConnection.Key.make("local"),
        directory: current?.directory ?? "",
      })
      return
    }

    if (parsed?.type === "home" && split.count() > 1) {
      split.openNewSessionInPane(props.paneId)
      return
    }

    parentNavigate(to, options)
  }) as Navigator

  const paneRouter = {
    ...parentRouter,
    location: paneLocation,
    params: paneParams,
    navigatorFactory: () => paneNavigator,
  }

  const paneContextValue: SplitPaneContextValue = {
    paneId: props.paneId,
    index: props.index,
    count: split.count,
    focused,
    target,
    focus: () => split.focusPane(props.paneId),
    close: () => split.closePane(props.paneId),
    moveLeft: () => split.movePane(props.paneId, "left"),
    moveRight: () => split.movePane(props.paneId, "right"),
    maximize: () => split.maximizePane(props.paneId),
    newSession: () => split.openNewSessionInPane(props.paneId),
    setRootElement: (el) => {
      rootEl = el
    },
    containsTarget: (eventTarget) => {
      if (!rootEl || !(eventTarget instanceof Node)) return false
      return rootEl.contains(eventTarget)
    },
  }

  return (
    <SplitPaneContext.Provider value={paneContextValue}>
      <RouterContext.Provider value={paneRouter}>
        <CommandFocusScopeProvider active={focused}>{props.children}</CommandFocusScopeProvider>
      </RouterContext.Provider>
    </SplitPaneContext.Provider>
  )
}
