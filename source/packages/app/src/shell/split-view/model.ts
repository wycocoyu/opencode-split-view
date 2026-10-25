import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { ServerConnection } from "@/runtime/server/registry"
import { TabStorage } from "@/shell/tabs/schema"

export const MAX_SPLIT_PANES = 3

export const MIN_SPLIT_RATIO = 0.18

export type SplitPaneCount = 1 | 2 | 3

export type SplitPanePosition = "left" | "middle" | "right"

const SessionPaneTargetSchema = Persistence.struct({
  type: Schema.Literal("session"),
  server: TabStorage.ServerKey,
  sessionId: Schema.String,
  directory: Schema.optional(Schema.String),
})

const DraftPaneTargetSchema = Persistence.struct({
  type: Schema.Literal("draft"),
  draftID: Schema.String,
  server: TabStorage.ServerKey,
  directory: Schema.String,
})

export const SplitPaneTargetSchema = Schema.Union([SessionPaneTargetSchema, DraftPaneTargetSchema])

export type SplitPaneTarget = typeof SplitPaneTargetSchema.Type

export const SplitViewPersistedSchema = Persistence.struct({
  order: Persistence.array(Schema.String),
  byId: Persistence.record(SplitPaneTargetSchema),
  focusedId: Schema.String,
  ratios: Persistence.array(Schema.Finite),
})

export type SplitViewState = {
  order: string[]
  byId: Record<string, SplitPaneTarget>
  focusedId: string
  ratios: number[]
}

export const DEFAULT_PANE_ID = "pane-0"

export function createInitialSplitViewState(): SplitViewState {
  return {
    order: [DEFAULT_PANE_ID],
    byId: {},
    focusedId: DEFAULT_PANE_ID,
    ratios: [1],
  }
}

export function clampPaneCount(count: number): SplitPaneCount {
  if (count >= 3) return 3
  if (count === 2) return 2
  return 1
}

export function equalRatios(count: number): number[] {
  const safeCount = Math.max(1, Math.min(MAX_SPLIT_PANES, Math.round(count)))
  if (safeCount === 1) return [1]
  if (safeCount === 2) return [0.5, 0.5]
  return [1 / 3, 1 / 3, 1 / 3]
}

export function normalizeRatios(ratios: readonly number[], count: number): number[] {
  const safeCount = Math.max(1, Math.min(MAX_SPLIT_PANES, Math.round(count)))
  if (safeCount === 1) return [1]
  if (ratios.length !== safeCount) return equalRatios(safeCount)

  const clamped = ratios.map((r) => (Number.isFinite(r) && r > 0 ? Math.max(MIN_SPLIT_RATIO, r) : 1 / safeCount))
  const total = clamped.reduce((sum, val) => sum + val, 0)
  if (total <= 0) return equalRatios(safeCount)
  return clamped.map((val) => val / total)
}

export function resizePairRatios(
  ratios: readonly number[],
  leftIndex: number,
  deltaRatio: number,
  minRatio = MIN_SPLIT_RATIO,
): number[] {
  const count = ratios.length
  if (leftIndex < 0 || leftIndex >= count - 1 || !Number.isFinite(deltaRatio)) {
    return normalizeRatios(ratios, count)
  }

  const current = normalizeRatios(ratios, count)
  const left = current[leftIndex] ?? 0.5
  const right = current[leftIndex + 1] ?? 0.5
  const pairSum = left + right
  const effectiveMin = Math.min(minRatio, pairSum / 2)

  const nextLeft = Math.min(pairSum - effectiveMin, Math.max(effectiveMin, left + deltaRatio))
  const nextRight = pairSum - nextLeft

  const next = [...current]
  next[leftIndex] = nextLeft
  next[leftIndex + 1] = nextRight
  return next
}

export function paneTargetKey(target: SplitPaneTarget): string {
  if (target.type === "draft") return `draft:${target.draftID}`
  return `session:${target.server}:${target.sessionId}`
}

export function samePaneTarget(a: SplitPaneTarget | undefined, b: SplitPaneTarget | undefined): boolean {
  if (!a || !b) return a === b
  return paneTargetKey(a) === paneTargetKey(b)
}

export function findPaneIdByTarget(state: SplitViewState, target: SplitPaneTarget): string | undefined {
  const key = paneTargetKey(target)
  return state.order.find((paneId) => {
    const item = state.byId[paneId]
    return item ? paneTargetKey(item) === key : false
  })
}

export function findPaneIdBySession(
  state: SplitViewState,
  server: ServerConnection.Key | string,
  sessionId: string,
): string | undefined {
  return state.order.find((paneId) => {
    const item = state.byId[paneId]
    return item?.type === "session" && item.server === server && item.sessionId === sessionId
  })
}

export function panePositionIndex(
  state: SplitViewState,
  server: ServerConnection.Key | string,
  sessionId: string,
): number {
  const paneId = findPaneIdBySession(state, server, sessionId)
  return paneId ? state.order.indexOf(paneId) : -1
}

export function sanitizeSplitViewState(raw: SplitViewState): SplitViewState {
  const uniqueOrder: string[] = []
  const seenTargets = new Set<string>()

  for (const id of raw.order) {
    if (!id || uniqueOrder.includes(id)) continue
    const target = raw.byId[id]
    if (target) {
      const tKey = paneTargetKey(target)
      if (seenTargets.has(tKey)) continue
      seenTargets.add(tKey)
    }
    uniqueOrder.push(id)
    if (uniqueOrder.length >= MAX_SPLIT_PANES) break
  }

  if (uniqueOrder.length === 0) {
    uniqueOrder.push(DEFAULT_PANE_ID)
  }

  const byId: Record<string, SplitPaneTarget> = {}
  for (const id of uniqueOrder) {
    const target = raw.byId[id]
    if (target) byId[id] = target
  }

  const focusedId = uniqueOrder.includes(raw.focusedId) ? raw.focusedId : (uniqueOrder[0] ?? DEFAULT_PANE_ID)
  const ratios = normalizeRatios(raw.ratios, uniqueOrder.length)

  return {
    order: uniqueOrder,
    byId,
    focusedId,
    ratios,
  }
}

function nextPaneId(existingOrder: readonly string[]): string {
  for (let i = 0; i < 16; i++) {
    const candidate = `pane-${i}`
    if (!existingOrder.includes(candidate)) return candidate
  }
  return `pane-${Date.now()}`
}

export function openInFocusedPane(state: SplitViewState, target: SplitPaneTarget): SplitViewState {
  const current = sanitizeSplitViewState(state)
  const existingPaneId = findPaneIdByTarget(current, target)
  if (existingPaneId) {
    if (current.focusedId === existingPaneId) {
      const prev = current.byId[existingPaneId]
      if (prev && prev.directory === target.directory) return current
    }
    return {
      ...current,
      byId: {
        ...current.byId,
        [existingPaneId]: target,
      },
      focusedId: existingPaneId,
    }
  }

  const focusedId = current.order.includes(current.focusedId)
    ? current.focusedId
    : (current.order[0] ?? DEFAULT_PANE_ID)

  return {
    ...current,
    byId: {
      ...current.byId,
      [focusedId]: target,
    },
    focusedId,
  }
}

export function openInSpecificPane(state: SplitViewState, paneId: string, target: SplitPaneTarget): SplitViewState {
  const current = sanitizeSplitViewState(state)
  if (!current.order.includes(paneId)) {
    return openInFocusedPane(current, target)
  }

  const existingPaneId = findPaneIdByTarget(current, target)
  if (existingPaneId && existingPaneId !== paneId) {
    // Swap targets between existingPaneId and paneId so we never have duplicate sessions
    const previousTarget = current.byId[paneId]
    const nextById = { ...current.byId, [paneId]: target }
    if (previousTarget) {
      nextById[existingPaneId] = previousTarget
    } else {
      delete nextById[existingPaneId]
    }
    return {
      ...current,
      byId: nextById,
      focusedId: paneId,
    }
  }

  return {
    ...current,
    byId: {
      ...current.byId,
      [paneId]: target,
    },
    focusedId: paneId,
  }
}

export function openInSplitPane(
  state: SplitViewState,
  target: SplitPaneTarget,
  position?: SplitPanePosition,
): SplitViewState {
  const current = sanitizeSplitViewState(state)
  const existingPaneId = findPaneIdByTarget(current, target)

  // If already open in a pane and no explicit drop position was requested, just focus that pane
  if (existingPaneId && !position) {
    return {
      ...current,
      byId: {
        ...current.byId,
        [existingPaneId]: target,
      },
      focusedId: existingPaneId,
    }
  }

  // If already open and an explicit drop position was requested, move that pane to the requested slot
  if (existingPaneId && position) {
    const targetIdx =
      position === "left" ? 0 : position === "middle" ? Math.min(1, current.order.length - 1) : current.order.length - 1
    const currentIdx = current.order.indexOf(existingPaneId)
    if (currentIdx === targetIdx) {
      return {
        ...current,
        focusedId: existingPaneId,
      }
    }
    const nextOrder = [...current.order]
    nextOrder.splice(currentIdx, 1)
    nextOrder.splice(targetIdx, 0, existingPaneId)
    return {
      ...current,
      order: nextOrder,
      focusedId: existingPaneId,
      ratios: equalRatios(nextOrder.length),
    }
  }

  // Room to add a new split pane (1 -> 2, or 2 -> 3)
  if (current.order.length < MAX_SPLIT_PANES) {
    const newId = nextPaneId(current.order)
    const nextOrder = [...current.order]
    if (position === "left") {
      nextOrder.unshift(newId)
    } else if (position === "middle") {
      nextOrder.splice(1, 0, newId)
    } else if (position === "right") {
      nextOrder.push(newId)
    } else {
      const focusedIndex = nextOrder.indexOf(current.focusedId)
      const insertAt = focusedIndex >= 0 ? focusedIndex + 1 : nextOrder.length
      nextOrder.splice(insertAt, 0, newId)
    }
    return {
      order: nextOrder,
      byId: {
        ...current.byId,
        [newId]: target,
      },
      focusedId: newId,
      ratios: equalRatios(nextOrder.length),
    }
  }

  // Already at max (3 panes: Left / Middle / Right) -> replace the appropriate pane
  const replaceIndex =
    position === "left"
      ? 0
      : position === "middle"
        ? 1
        : position === "right"
          ? 2
          : Math.max(0, current.order.indexOf(current.focusedId))
  const replacePaneId = current.order[replaceIndex] ?? current.focusedId
  return {
    ...current,
    byId: {
      ...current.byId,
      [replacePaneId]: target,
    },
    focusedId: replacePaneId,
  }
}

export function setSplitPaneCount(
  state: SplitViewState,
  targetCount: SplitPaneCount,
  createTargetForNewPane: (index: number, currentState: SplitViewState) => SplitPaneTarget,
): SplitViewState {
  const current = sanitizeSplitViewState(state)
  const desired = clampPaneCount(targetCount)

  if (current.order.length === desired) {
    return current
  }

  // Reducing panes (e.g., 3 -> 1, 2 -> 1, or 3 -> 2)
  if (desired < current.order.length) {
    if (desired === 1) {
      const keepId = current.order.includes(current.focusedId)
        ? current.focusedId
        : (current.order[0] ?? DEFAULT_PANE_ID)
      const keptTarget = current.byId[keepId]
      return {
        order: [keepId],
        byId: keptTarget ? { [keepId]: keptTarget } : {},
        focusedId: keepId,
        ratios: [1],
      }
    }

    // 3 -> 2: keep the focused pane; drop the rightmost unfocused pane
    const dropIndex = current.focusedId === current.order[2] ? 1 : 2
    const nextOrder = current.order.filter((_, idx) => idx !== dropIndex)
    const nextById: Record<string, SplitPaneTarget> = {}
    for (const id of nextOrder) {
      const t = current.byId[id]
      if (t) nextById[id] = t
    }
    const nextFocused = nextOrder.includes(current.focusedId) ? current.focusedId : (nextOrder[0] ?? DEFAULT_PANE_ID)
    return {
      order: nextOrder,
      byId: nextById,
      focusedId: nextFocused,
      ratios: equalRatios(nextOrder.length),
    }
  }

  // Expanding panes (1 -> 2, 1 -> 3, or 2 -> 3)
  let nextState = {
    order: [...current.order],
    byId: { ...current.byId },
    focusedId: current.focusedId,
    ratios: [...current.ratios],
  }

  while (nextState.order.length < desired) {
    const newIndex = nextState.order.length
    const newId = nextPaneId(nextState.order)
    const newTarget = createTargetForNewPane(newIndex, nextState)
    nextState.order.push(newId)
    nextState.byId[newId] = newTarget
    nextState.focusedId = newId
    nextState.ratios = equalRatios(nextState.order.length)
  }

  return sanitizeSplitViewState(nextState)
}

export function closeSplitPane(state: SplitViewState, paneId: string): SplitViewState {
  const current = sanitizeSplitViewState(state)
  if (current.order.length <= 1) return current

  const index = current.order.indexOf(paneId)
  if (index === -1) return current

  const nextOrder = current.order.filter((id) => id !== paneId)
  const nextById = { ...current.byId }
  delete nextById[paneId]

  const nextFocusedId =
    current.focusedId === paneId
      ? (nextOrder[Math.min(index, nextOrder.length - 1)] ?? nextOrder[0] ?? DEFAULT_PANE_ID)
      : current.focusedId

  return {
    order: nextOrder,
    byId: nextById,
    focusedId: nextFocusedId,
    ratios: equalRatios(nextOrder.length),
  }
}

export function moveSplitPane(state: SplitViewState, paneId: string, direction: "left" | "right"): SplitViewState {
  const current = sanitizeSplitViewState(state)
  const index = current.order.indexOf(paneId)
  if (index === -1) return current

  const targetIndex = direction === "left" ? index - 1 : index + 1
  if (targetIndex < 0 || targetIndex >= current.order.length) return current

  const nextOrder = [...current.order]
  const nextRatios = [...current.ratios]

  const tempId = nextOrder[index]!
  nextOrder[index] = nextOrder[targetIndex]!
  nextOrder[targetIndex] = tempId

  const tempRatio = nextRatios[index] ?? 1 / nextOrder.length
  nextRatios[index] = nextRatios[targetIndex] ?? 1 / nextOrder.length
  nextRatios[targetIndex] = tempRatio

  return {
    ...current,
    order: nextOrder,
    ratios: normalizeRatios(nextRatios, nextOrder.length),
  }
}

export function focusAdjacentSplitPane(state: SplitViewState, delta: -1 | 1): SplitViewState {
  const current = sanitizeSplitViewState(state)
  if (current.order.length <= 1) return current

  const index = Math.max(0, current.order.indexOf(current.focusedId))
  const nextIndex = (index + delta + current.order.length) % current.order.length
  const nextFocused = current.order[nextIndex] ?? current.focusedId

  return {
    ...current,
    focusedId: nextFocused,
  }
}

export function promoteDraftInSplitView(
  state: SplitViewState,
  draftID: string,
  session: { server: ServerConnection.Key; sessionId: string; directory?: string },
): SplitViewState {
  let changed = false
  const nextById = { ...state.byId }

  for (const paneId of state.order) {
    const target = nextById[paneId]
    if (target?.type === "draft" && target.draftID === draftID) {
      nextById[paneId] = {
        type: "session",
        server: session.server,
        sessionId: session.sessionId,
        directory: session.directory ?? target.directory,
      }
      changed = true
    }
  }

  if (!changed) return state
  return sanitizeSplitViewState({
    ...state,
    byId: nextById,
  })
}
