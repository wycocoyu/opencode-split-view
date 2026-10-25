import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import { sidebarRefresh, sidebarRows } from "./adapter"

const session = (id: string, input: Partial<SessionInfo> = {}) =>
  ({
    id,
    projectID: "project",
    title: id,
    time: { created: 1, updated: 1 },
    location: { directory: "/repo" },
    ...input,
  }) as SessionInfo

describe("sidebar session adapter", () => {
  test.each([
    "permission.asked",
    "permission.replied",
    "form.created",
    "form.replied",
    "form.cancelled",
    "session.execution.started",
    "session.execution.succeeded",
    "session.execution.failed",
    "session.execution.interrupted",
    "session.deleted",
    "session.archived",
    "session.unarchived",
    "session.renamed",
    "session.moved",
    "session.viewed",
  ])("refreshes activity snapshots on %s", (type) => {
    expect(sidebarRefresh(type).activity).toBe(true)
  })

  test.each([
    "session.created",
    "session.deleted",
    "session.archived",
    "session.unarchived",
    "session.renamed",
    "session.moved",
    "session.viewed",
  ])("refreshes unloaded historical records on %s", (type) => {
    expect(sidebarRefresh(type).history).toBe(true)
  })

  test.each([
    "session.message.part.updated",
    "session.message.part.delta",
    "session.usage.updated",
    "permission.saved",
    "vcs.branch.updated",
  ])("does not refetch sidebar queries on %s", (type) => {
    expect(sidebarRefresh(type)).toEqual({ activity: false, history: false })
  })

  test("merges canonical cache records without losing archived history or leaking child sessions", () => {
    const rows = sidebarRows({
      server: "server-a",
      sessions: [session("old"), session("archived", { time: { created: 1, updated: 2, archived: 3 } })],
      known: [session("old", { title: "Renamed" }), session("child", { parentID: "old" })],
      project: () => ({ id: "project", name: "Repo", directory: "/repo" }),
      activity: { input: new Set(), working: new Set(), review: new Set() },
    })
    expect(rows.map((row) => [row.session.id, row.session.title])).toEqual([
      ["old", "Renamed"],
      ["archived", "archived"],
    ])
    expect(rows[1].session.time.archived).toBe(3)
  })

  test("prioritizes requests over work over unread results and isolates server identity", () => {
    const input = {
      sessions: [session("same")],
      known: [],
      project: () => ({ id: "project", name: "Repo", directory: "/repo" }),
      activity: { input: new Set(["same"]), working: new Set(["same"]), review: new Set(["same"]) },
    }
    expect(sidebarRows({ ...input, server: "a" })[0].state).toBe("input")
    input.activity.input.clear()
    expect(sidebarRows({ ...input, server: "a" })[0].state).toBe("working")
    input.activity.working.clear()
    expect(sidebarRows({ ...input, server: "a" })[0].state).toBe("review")
    expect(sidebarRows({ ...input, server: "a" })[0].key).not.toBe(sidebarRows({ ...input, server: "b" })[0].key)
    input.activity.review.clear()
    expect(sidebarRows({ ...input, server: "a" })[0].state).toBe("idle")
  })
})
