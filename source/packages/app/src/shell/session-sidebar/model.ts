export type SidebarRow = {
  key: string
  server: string
  session: {
    id: string
    title: string
    parentID?: string
    projectID?: string
    location: { directory: string }
    time: { created: number; updated?: number; archived?: number; idle?: number; viewed?: number }
  }
  project: { id: string; name: string; directory: string }
  state: "input" | "working" | "review" | "idle"
}

export type SidebarGroupBy = "state" | "project" | "time" | "none"

export type SidebarTimeBucket = "today" | "yesterday" | "week" | "month" | "older"

export type SidebarFilter = {
  groupBy: SidebarGroupBy
  status: "active" | "archived"
  search: string
  project: string
  days: number
  sort: "updated" | "created"
  pinned?: readonly string[]
}

export type SidebarGroup = {
  id: string
  state?: SidebarRow["state"]
  project?: SidebarRow["project"]
  time?: SidebarTimeBucket
  server?: string
  rows: SidebarRow[]
}

const STATES: readonly SidebarRow["state"][] = ["input", "working", "idle"]
const TIME_BUCKETS: readonly SidebarTimeBucket[] = ["today", "yesterday", "week", "month", "older"]
const DAY = 24 * 60 * 60 * 1000
const FALLBACK_TITLE_PATTERN = /^(New session - |Child session - )\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export function sidebarProjectKey(row: SidebarRow): string {
  return JSON.stringify([row.server, row.project.id])
}

export function normalizeSessionTitle(title?: string | null): string {
  if (!title) return ""
  const trimmed = title.trim()
  if (!trimmed || FALLBACK_TITLE_PATTERN.test(trimmed)) return ""
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      const extracted = extractJsonTitle(parsed)
      if (extracted) return collapseWhitespace(extracted)
    } catch {
      // Keep original string if it is not valid JSON
    }
  }
  return collapseWhitespace(trimmed)
}

function extractJsonTitle(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined
  if (Array.isArray(value)) {
    const parts = value.map(extractJsonTitle).filter((item): item is string => !!item)
    return parts.length > 0 ? parts.join(" ") : undefined
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    for (const key of ["text", "title", "prompt", "content", "message"]) {
      const candidate = extractJsonTitle(record[key])
      if (candidate) return candidate
    }
  }
  return undefined
}

function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim()
}

export function formatRelativeTime(timestamp: number | undefined, now = Date.now()): string {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return ""
  const diff = Math.max(0, now - timestamp)
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(diff / 3_600_000)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(diff / DAY)
  if (days < 30) return `${days}d`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo`
  return `${Math.floor(days / 365)}y`
}

export function sessionSubpathLabel(row: SidebarRow): string {
  const projectDir = row.project.directory.replace(/[\\/]+$/, "")
  const sessionDir = row.session.location.directory.replace(/[\\/]+$/, "")
  if (!sessionDir || sessionDir === projectDir) return ""
  if (sessionDir.startsWith(projectDir + "/") || sessionDir.startsWith(projectDir + "\\")) {
    return sessionDir.slice(projectDir.length + 1)
  }
  const parts = sessionDir.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? ""
}

export function timeBucketForTimestamp(timestamp: number, now = Date.now()): SidebarTimeBucket {
  const current = new Date(now)
  const startOfToday = new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime()
  const startOfYesterday = startOfToday - DAY
  if (timestamp >= startOfToday) return "today"
  if (timestamp >= startOfYesterday) return "yesterday"
  const age = now - timestamp
  if (age <= 7 * DAY) return "week"
  if (age <= 30 * DAY) return "month"
  return "older"
}

function filterAndSortRows(rows: readonly SidebarRow[], filter: SidebarFilter, now: number): SidebarRow[] {
  const since = now - filter.days * DAY
  const search = filter.search.trim().toLowerCase()
  return rows
    .filter((row) => {
      if (row.session.parentID) return false
      if ((filter.status === "archived") !== (row.session.time.archived !== undefined)) return false
      if (filter.project && sidebarProjectKey(row) !== filter.project) return false
      if (search) {
        const normalized = normalizeSessionTitle(row.session.title)
        const matches = [
          row.session.title,
          normalized,
          row.project.name,
          row.project.directory,
          row.session.location.directory,
        ].some((value) => value.toLowerCase().includes(search))
        if (!matches) return false
      }
      return (
        filter.days <= 0 ||
        row.state === "input" ||
        row.state === "working" ||
        (row.session.time.updated ?? row.session.time.created) >= since
      )
    })
    .sort((a, b) => {
      return (
        (b.session.time[filter.sort] ?? b.session.time.created) -
          (a.session.time[filter.sort] ?? a.session.time.created) ||
        compare(a.session.id, b.session.id) ||
        compare(a.key, b.key)
      )
    })
}

export function isRowPinned(row: SidebarRow, pinned?: readonly string[]): boolean {
  if (!pinned || pinned.length === 0) return false
  return pinned.includes(row.key) || pinned.includes(row.session.id)
}

export function buildPinnedRows(rows: readonly SidebarRow[], filter: SidebarFilter): SidebarRow[] {
  if (!filter.pinned || filter.pinned.length === 0) return []
  const now = Date.now()
  return filterAndSortRows(rows, filter, now).filter((row) => isRowPinned(row, filter.pinned))
}

export function buildSessionGroups(rows: readonly SidebarRow[], filter: SidebarFilter): SidebarGroup[] {
  const now = Date.now()
  const visible = filterAndSortRows(rows, filter, now).filter((row) => !isRowPinned(row, filter.pinned))
  if (visible.length === 0) return []

  if (filter.groupBy === "none") {
    return [{ id: "all", rows: visible }]
  }

  const groups = new Map<string, SidebarGroup>()
  for (const row of visible) {
    if (filter.groupBy === "state") {
      const groupState: SidebarRow["state"] = row.state === "review" ? "idle" : row.state
      let group = groups.get(groupState)
      if (!group) {
        group = { id: groupState, state: groupState, rows: [] }
        groups.set(groupState, group)
      }
      group.rows.push(row)
    } else if (filter.groupBy === "time") {
      const stamp = row.session.time[filter.sort] ?? row.session.time.updated ?? row.session.time.created
      const bucket = timeBucketForTimestamp(stamp, now)
      let group = groups.get(bucket)
      if (!group) {
        group = { id: bucket, time: bucket, rows: [] }
        groups.set(bucket, group)
      }
      group.rows.push(row)
    } else {
      const id = sidebarProjectKey(row)
      let group = groups.get(id)
      if (!group) {
        group = { id, project: row.project, server: row.server, rows: [] }
        groups.set(id, group)
      }
      group.rows.push(row)
    }
  }

  if (filter.groupBy === "state") {
    return STATES.flatMap((state) => (groups.has(state) ? [groups.get(state)!] : []))
  }
  if (filter.groupBy === "time") {
    return TIME_BUCKETS.flatMap((bucket) => (groups.has(bucket) ? [groups.get(bucket)!] : []))
  }
  return [...groups.values()]
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
