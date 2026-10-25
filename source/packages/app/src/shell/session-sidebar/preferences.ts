import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"

const SidebarPreferences = Persistence.struct({
  enabled: Schema.Boolean,
  groupBy: Schema.Literals(["state", "project", "time", "none"]),
  status: Schema.Literals(["active", "archived"]),
  search: Schema.String,
  project: Schema.String,
  days: Schema.Number,
  sort: Schema.Literals(["updated", "created"]),
  pinned: Persistence.array(Schema.String),
  collapsed: Persistence.array(Schema.String),
  width: Schema.Number,
  showPath: Schema.Boolean,
})

export type SidebarPreferencesState = typeof SidebarPreferences.Type

export function createSidebarPreferences() {
  return persisted(Persist.global("session-sidebar.v1"), SidebarPreferences, {
    enabled: true,
    groupBy: "state",
    status: "active",
    search: "",
    project: "",
    days: 0,
    sort: "updated",
    pinned: [],
    collapsed: [],
    width: 272,
    showPath: true,
  })
}
