import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test"
import {
  buildPinnedRows,
  buildSessionGroups,
  formatRelativeTime,
  normalizeSessionTitle,
  sessionSubpathLabel,
  sidebarProjectKey,
  type SidebarFilter,
  type SidebarRow,
} from "./model"

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 24, 12)
const filter: SidebarFilter = {
  groupBy: "state",
  status: "active",
  search: "",
  project: "",
  days: 0,
  sort: "updated",
}

function row(id: string, state: SidebarRow["state"] = "idle", age = 0): SidebarRow {
  return {
    key: `local\n${id}`,
    server: "local",
    state,
    project: { id: "p1", name: "Ark", directory: "/projects/ark" },
    session: {
      id,
      title: `Session ${id}`,
      location: { directory: "/projects/ark/worktree" },
      time: { created: NOW - 60 * DAY, updated: NOW - age * DAY },
    },
  }
}

function ids(rows: SidebarRow[], options: Partial<SidebarFilter> = {}) {
  return buildSessionGroups(rows, { ...filter, ...options }).flatMap((group) =>
    group.rows.map((item) => item.session.id),
  )
}

beforeEach(() => setSystemTime(NOW))
afterEach(() => setSystemTime())

describe("buildSessionGroups", () => {
  test("keeps roots only and treats archived timestamp zero as archived", () => {
    const child = row("child")
    child.session.parentID = "root"
    const archived = row("archived")
    archived.session.time.archived = 0
    expect(ids([row("root"), child, archived])).toEqual(["root"])
    expect(ids([row("root"), child, archived], { status: "archived" })).toEqual(["archived"])
  })

  test("orders states by urgency, merges review rows into idle group, omits empty groups and sorts within each", () => {
    const groups = buildSessionGroups(
      [row("idle", "idle", 1), row("work", "working"), row("review", "review", 0), row("old", "input", 2), row("new", "input")],
      filter,
    )
    expect(groups.map((group) => [group.id, group.state])).toEqual([
      ["input", "input"],
      ["working", "working"],
      ["idle", "idle"],
    ])
    expect(groups[0].rows.map((item) => item.session.id)).toEqual(["new", "old"])
    expect(groups[2].rows.map((item) => [item.session.id, item.state])).toEqual([
      ["review", "review"],
      ["idle", "idle"],
    ])
    expect(buildSessionGroups([], filter)).toEqual([])
  })

  test.each([0, 1, 7, 30])("applies %i-day cutoff inclusively except for input and working", (days) => {
    const boundary = row("boundary", "idle", days)
    const older = row("older", "review", days + 0.001)
    expect(ids([boundary, older, row("input", "input", 100), row("work", "working", 100)], { days })).toEqual(
      days === 0 ? ["input", "work", "boundary", "older"] : ["input", "work", "boundary"],
    )
  })

  test("active work still respects archive, project and search filters", () => {
    const input = row("input", "input", 100)
    expect(ids([input], { search: "missing" })).toEqual([])
    expect(ids([input], { project: "missing" })).toEqual([])
    input.session.time.archived = 0
    expect(ids([input])).toEqual([])
  })

  test.each(["SESSION", "ark", "/projects/ark", "worktree", "  aRk  "])(
    "searches title, project and paths case-insensitively: %s",
    (search) => {
      expect(ids([row("a")], { search })).toEqual(["a"])
    },
  )

  test("uses created when updated is absent and supports created sort", () => {
    const a = row("a", "idle", 1)
    const b = row("b")
    a.session.time.created = NOW
    delete a.session.time.updated
    b.session.time.created = NOW - 10 * DAY
    expect(ids([b, a], { days: 1 })).toEqual(["a", "b"])
    expect(ids([b, a], { sort: "created" })).toEqual(["a", "b"])
    a.session.time.updated = NOW - DAY
    expect(ids([a, b])).toEqual(["b", "a"])
    expect(ids([a, b], { sort: "created" })).toEqual(["a", "b"])
  })

  test("uses id then server key to break ties without mutating input", () => {
    const rows = [row("b"), row("a")]
    const remote = { ...row("a"), server: "remote", key: "remote\na" }
    expect(ids(rows)).toEqual(["a", "b"])
    expect(rows.map((item) => item.session.id)).toEqual(["b", "a"])
    expect(buildSessionGroups([remote, rows[1]], filter)[0].rows.map((item) => item.server)).toEqual([
      "local",
      "remote",
    ])
  })

  test("separates project groups and project selection by server", () => {
    const local = row("local", "idle", 1)
    const remote = { ...row("remote"), server: "remote", key: "remote\nremote" }
    expect(sidebarProjectKey(local)).not.toBe(sidebarProjectKey(remote))
    const groups = buildSessionGroups([local, remote], { ...filter, groupBy: "project" })
    expect(groups.map((group) => [group.id, group.server, group.project, group.rows.length])).toEqual([
      [sidebarProjectKey(remote), "remote", remote.project, 1],
      [sidebarProjectKey(local), "local", local.project, 1],
    ])
    expect(ids([local, remote], { project: sidebarProjectKey(local) })).toEqual(["local"])
  })

  test("project key cannot collide when identifiers contain delimiters", () => {
    const a = row("a")
    const b = row("b")
    a.server = "a\nb"
    a.project.id = "c"
    b.server = "a"
    b.project.id = "b\nc"
    expect(sidebarProjectKey(a)).not.toBe(sidebarProjectKey(b))
  })

  test("supports time and flat grouping modes and separates pinned sessions", () => {
    const today = row("today", "idle", 0)
    const week = row("week", "idle", 4)
    const older = row("older", "idle", 45)
    const timeGroups = buildSessionGroups([older, week, today], { ...filter, groupBy: "time" })
    expect(timeGroups.map((group) => [group.id, group.time, group.rows.map((item) => item.session.id)])).toEqual([
      ["today", "today", ["today"]],
      ["week", "week", ["week"]],
      ["older", "older", ["older"]],
    ])

    const flatGroups = buildSessionGroups([week, today], { ...filter, groupBy: "none" })
    expect(flatGroups).toHaveLength(1)
    expect(flatGroups[0].rows.map((item) => item.session.id)).toEqual(["today", "week"])

    const pinnedFilter = { ...filter, pinned: [week.key] }
    expect(buildPinnedRows([today, week, older], pinnedFilter).map((item) => item.session.id)).toEqual(["week"])
    expect(ids([today, week, older], pinnedFilter)).toEqual(["today", "older"])
  })
})

describe("protocol title and display helpers", () => {
  test("normalizes JSON payload titles and strips fallback timestamps", () => {
    expect(normalizeSessionTitle('{"text":"继续对话"}')).toBe("继续对话")
    expect(normalizeSessionTitle('[{"type":"text","text":"Fix   sidebar\\nlayout"}]')).toBe("Fix sidebar layout")
    expect(normalizeSessionTitle("New session - 2026-10-24T12:00:00.000Z")).toBe("")
    expect(normalizeSessionTitle("Child session - 2026-10-24T12:00:00.000Z")).toBe("")
    expect(normalizeSessionTitle("  Clean   title  ")).toBe("Clean title")
  })

  test("formats relative timestamps and worktree subpaths", () => {
    expect(formatRelativeTime(NOW - 10_000, NOW)).toBe("now")
    expect(formatRelativeTime(NOW - 9 * 60_000, NOW)).toBe("9m")
    expect(formatRelativeTime(NOW - 5 * 3_600_000, NOW)).toBe("5h")
    expect(formatRelativeTime(NOW - 3 * DAY, NOW)).toBe("3d")
    expect(sessionSubpathLabel(row("a"))).toBe("worktree")
    const rootRow = row("root")
    rootRow.session.location.directory = "/projects/ark"
    expect(sessionSubpathLabel(rootRow)).toBe("")
  })
})
