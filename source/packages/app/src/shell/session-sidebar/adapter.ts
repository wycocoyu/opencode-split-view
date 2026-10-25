import type { SessionInfo } from "@opencode/client/promise"
import type { SidebarRow } from "./model"

export function sidebarRefresh(type: string) {
  return {
    activity: [
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
    ].includes(type),
    history: [
      "session.created",
      "session.deleted",
      "session.archived",
      "session.unarchived",
      "session.renamed",
      "session.moved",
      "session.viewed",
    ].includes(type),
  }
}

export function sidebarRows(input: {
  server: string
  sessions: SessionInfo[]
  known: SessionInfo[]
  project: (session: SessionInfo) => SidebarRow["project"]
  activity: { input: Set<string>; working: Set<string>; review: Set<string> }
}): SidebarRow[] {
  return [...new Map([...input.sessions, ...input.known].map((session) => [session.id, session])).values()]
    .filter((session) => !session.parentID)
    .map((session) => ({
      key: `${input.server}\0${session.id}`,
      server: input.server,
      session: { ...session, title: session.title ?? "" },
      project: input.project(session),
      state: input.activity.input.has(session.id)
        ? "input"
        : input.activity.working.has(session.id)
          ? "working"
          : input.activity.review.has(session.id)
            ? "review"
            : "idle",
    }))
}
