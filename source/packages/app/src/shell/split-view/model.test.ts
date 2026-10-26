import { describe, expect, test } from "bun:test"
import { ServerConnection } from "@/runtime/server/registry"
import {
  MAX_SPLIT_PANES,
  MIN_SPLIT_RATIO,
  clampPaneCount,
  closeSplitPane,
  createInitialSplitViewState,
  equalRatios,
  focusAdjacentSplitPane,
  moveSplitPane,
  navigateToTarget,
  normalizeRatios,
  openInFocusedPane,
  openInSpecificPane,
  openInSplitPane,
  panePositionIndex,
  promoteDraftInSplitView,
  resizePairRatios,
  sessionSplitBadge,
  setSplitPaneCount,
  type SplitPaneTarget,
  type SplitViewState,
} from "./model"

const server = ServerConnection.Key.make("local")

const sessionTarget = (id: string, directory = "/repo"): SplitPaneTarget => ({
  type: "session",
  server,
  sessionId: id,
  directory,
})

const draftTarget = (id: string, directory = "/repo"): SplitPaneTarget => ({
  type: "draft",
  draftID: id,
  server,
  directory,
})

describe("split-view model", () => {
  test("enforces max 3 panes (left, middle, right)", () => {
    expect(MAX_SPLIT_PANES).toBe(3)
    expect(clampPaneCount(0)).toBe(1)
    expect(clampPaneCount(1)).toBe(1)
    expect(clampPaneCount(2)).toBe(2)
    expect(clampPaneCount(3)).toBe(3)
    expect(clampPaneCount(4)).toBe(3)
  })

  test("expands from 1 pane to 2 panes (left/right) and 3 panes (left/middle/right), and collapses preserving focused pane", () => {
    let state: SplitViewState = {
      ...createInitialSplitViewState(),
      order: ["pane-0"],
      byId: { "pane-0": sessionTarget("s-left") },
      focusedId: "pane-0",
      ratios: [1],
    }

    state = setSplitPaneCount(state, 2, (idx) => draftTarget(`draft-${idx}`))
    expect(state.order.length).toBe(2)
    expect(state.ratios).toEqual(equalRatios(2))
    expect(state.byId[state.order[0]!]).toEqual(sessionTarget("s-left"))
    expect(state.byId[state.order[1]!]).toEqual(draftTarget("draft-1"))

    state = setSplitPaneCount(state, 3, (idx) => draftTarget(`draft-${idx}`))
    expect(state.order.length).toBe(3)
    expect(state.ratios.length).toBe(3)
    expect(state.byId[state.order[2]!]).toEqual(draftTarget("draft-2"))

    // Focus the right pane and collapse back to 1 pane: the focused right pane must survive
    const rightPaneId = state.order[2]!
    state = { ...state, focusedId: rightPaneId }
    const collapsed = setSplitPaneCount(state, 1, () => draftTarget("unused"))
    expect(collapsed.order).toEqual([rightPaneId])
    expect(collapsed.focusedId).toBe(rightPaneId)
    expect(collapsed.byId[rightPaneId]).toEqual(draftTarget("draft-2"))
  })

  test("openInSplitPane opens in 2nd pane, then 3rd pane, and supports left/middle/right positioning without duplicates", () => {
    let state: SplitViewState = {
      order: ["pane-0"],
      byId: { "pane-0": sessionTarget("s-1") },
      focusedId: "pane-0",
      ratios: [1],
    }

    // 1 -> 2 panes
    state = openInSplitPane(state, sessionTarget("s-2"))
    expect(state.order.length).toBe(2)
    expect(panePositionIndex(state, server, "s-1")).toBe(0)
    expect(panePositionIndex(state, server, "s-2")).toBe(1)

    // 2 -> 3 panes with explicit "middle" placement inserts in the middle
    state = openInSplitPane(state, sessionTarget("s-middle"), "middle")
    expect(state.order.length).toBe(3)
    expect(panePositionIndex(state, server, "s-1")).toBe(0)
    expect(panePositionIndex(state, server, "s-middle")).toBe(1)
    expect(panePositionIndex(state, server, "s-2")).toBe(2)

    // Re-opening an already visible session focuses its pane instead of creating a duplicate
    const beforeOrder = [...state.order]
    state = openInSplitPane(state, sessionTarget("s-1"))
    expect(state.order).toEqual(beforeOrder)
    expect(state.focusedId).toBe(beforeOrder[0])

    // Opening a 4th session into "right" replaces the right pane (max 3 panes)
    state = openInSplitPane(state, sessionTarget("s-4"), "right")
    expect(state.order.length).toBe(3)
    expect(panePositionIndex(state, server, "s-4")).toBe(2)
  })

  test("openInFocusedPane and openInSpecificPane deduplicate and swap across panes", () => {
    let state: SplitViewState = {
      order: ["pane-0", "pane-1", "pane-2"],
      byId: {
        "pane-0": sessionTarget("s-left"),
        "pane-1": sessionTarget("s-mid"),
        "pane-2": sessionTarget("s-right"),
      },
      focusedId: "pane-0",
      ratios: [1 / 3, 1 / 3, 1 / 3],
    }

    // Clicking a session already open in right pane focuses right pane instead of duplicating into left pane
    state = openInFocusedPane(state, sessionTarget("s-right"))
    expect(state.focusedId).toBe("pane-2")
    expect(panePositionIndex(state, server, "s-left")).toBe(0)
    expect(panePositionIndex(state, server, "s-right")).toBe(2)

    // Explicitly dropping s-left into pane-2 swaps pane-0 and pane-2 targets
    state = openInSpecificPane(state, "pane-2", sessionTarget("s-left"))
    expect(panePositionIndex(state, server, "s-right")).toBe(0)
    expect(panePositionIndex(state, server, "s-left")).toBe(2)
  })

  test("moveSplitPane, focusAdjacentSplitPane, closeSplitPane, and resizePairRatios", () => {
    let state: SplitViewState = {
      order: ["pane-0", "pane-1", "pane-2"],
      byId: {
        "pane-0": sessionTarget("s-left"),
        "pane-1": sessionTarget("s-mid"),
        "pane-2": sessionTarget("s-right"),
      },
      focusedId: "pane-1",
      ratios: [1 / 3, 1 / 3, 1 / 3],
    }

    // Move middle pane left
    state = moveSplitPane(state, "pane-1", "left")
    expect(state.order).toEqual(["pane-1", "pane-0", "pane-2"])

    // Focus adjacent panes wraps around
    state = focusAdjacentSplitPane(state, -1)
    expect(state.focusedId).toBe("pane-2")
    state = focusAdjacentSplitPane(state, 1)
    expect(state.focusedId).toBe("pane-1")

    // Resize columns respects MIN_SPLIT_RATIO
    const resized = resizePairRatios([0.5, 0.5], 0, 0.9)
    expect(resized[0]).toBeCloseTo(1 - MIN_SPLIT_RATIO, 4)
    expect(resized[1]).toBeCloseTo(MIN_SPLIT_RATIO, 4)
    expect(normalizeRatios(resized, 2).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5)

    // Close pane-1 updates order to 2 panes and focuses survivor
    state = closeSplitPane(state, "pane-1")
    expect(state.order).toEqual(["pane-0", "pane-2"])
    expect(state.focusedId).toBe("pane-0")
  })

  test("promoteDraftInSplitView replaces draft target with promoted session in place", () => {
    const state: SplitViewState = {
      order: ["pane-0", "pane-1"],
      byId: {
        "pane-0": sessionTarget("s-1"),
        "pane-1": draftTarget("draft-abc", "/work"),
      },
      focusedId: "pane-1",
      ratios: [0.5, 0.5],
    }

    const promoted = promoteDraftInSplitView(state, "draft-abc", {
      server,
      sessionId: "s-promoted",
      directory: "/work",
    })
    expect(promoted.byId["pane-1"]).toEqual({
      type: "session",
      server,
      sessionId: "s-promoted",
      directory: "/work",
    })
  })

  test("navigateToTarget preserves independent split groups and opens unsplit sessions in single pane", () => {
    // 1. Open Session A and split with Session B -> Group 1: [s-a | s-b]
    let state: SplitViewState = {
      order: ["pane-0"],
      byId: { "pane-0": sessionTarget("s-a") },
      focusedId: "pane-0",
      ratios: [1],
    }
    state = openInSplitPane(state, sessionTarget("s-b"), "right")
    expect(state.order.length).toBe(2)
    expect(panePositionIndex(state, server, "s-a")).toBe(0)
    expect(panePositionIndex(state, server, "s-b")).toBe(1)

    // Focus Left Pane (s-a), then click unsplit Session C in the sidebar
    state = navigateToTarget(state, sessionTarget("s-a"))
    expect(state.focusedId).toBe(state.order[0]!)
    state = navigateToTarget(state, sessionTarget("s-c"))

    // Active view becomes 1-pane [s-c], while [s-a | s-b] is preserved in background groups
    expect(state.order.length).toBe(1)
    expect(panePositionIndex(state, server, "s-c")).toBe(0)
    expect(state.groups?.length).toBe(1)
    expect(sessionSplitBadge(state, server, "s-a")).toEqual({ activeGroup: false, index: 0, count: 2 })
    expect(sessionSplitBadge(state, server, "s-b")).toEqual({ activeGroup: false, index: 1, count: 2 })
    expect(sessionSplitBadge(state, server, "s-c")).toBeUndefined()

    // 2. Split Session C with Session D -> Group 2: [s-c | s-d], while Group 1 [s-a | s-b] remains intact
    state = openInSplitPane(state, sessionTarget("s-d"), "right")
    expect(state.order.length).toBe(2)
    expect(panePositionIndex(state, server, "s-c")).toBe(0)
    expect(panePositionIndex(state, server, "s-d")).toBe(1)
    expect(state.groups?.length).toBe(2)
    expect(sessionSplitBadge(state, server, "s-c")).toEqual({ activeGroup: true, index: 0, count: 2 })
    expect(sessionSplitBadge(state, server, "s-a")).toEqual({ activeGroup: false, index: 0, count: 2 })

    // 3. Click Session B in the sidebar -> switches back to Group 1 [s-a | s-b] with s-b focused
    state = navigateToTarget(state, sessionTarget("s-b"))
    expect(state.order.length).toBe(2)
    expect(panePositionIndex(state, server, "s-a")).toBe(0)
    expect(panePositionIndex(state, server, "s-b")).toBe(1)
    expect(state.byId[state.focusedId]).toEqual(sessionTarget("s-b"))
    expect(state.groups?.length).toBe(2)

    // 4. Click unsplit Session E -> switches to 1-pane [s-e], both [s-a | s-b] and [s-c | s-d] stay saved
    state = navigateToTarget(state, sessionTarget("s-e"))
    expect(state.order.length).toBe(1)
    expect(panePositionIndex(state, server, "s-e")).toBe(0)
    expect(state.groups?.length).toBe(2)

    // 5. Steal s-b into s-e's split [s-e | s-b] -> Group 1 [s-a | s-b] drops to 1 pane so s-a becomes unsplit
    state = openInSplitPane(state, sessionTarget("s-b"), "right")
    expect(state.order.length).toBe(2)
    expect(panePositionIndex(state, server, "s-e")).toBe(0)
    expect(panePositionIndex(state, server, "s-b")).toBe(1)
    expect(sessionSplitBadge(state, server, "s-a")).toBeUndefined()
    expect(sessionSplitBadge(state, server, "s-c")).toEqual({ activeGroup: false, index: 0, count: 2 })
  })
})
