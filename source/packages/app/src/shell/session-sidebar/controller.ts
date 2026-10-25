import { batch, createEffect, createMemo, onCleanup, startTransition } from "solid-js"
import { createStore } from "solid-js/store"
import { skipToken, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/solid-query"
import type { SessionInfo } from "@opencode/client/promise"
import { displayName } from "@opencode/ui/project-avatar"
import { HOME_SESSION_LIMIT, loadHomeSessionIndex } from "@/home/sessions/index"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { useTabs } from "@/shell/tabs/tabs"
import { notifySessionTabsRemoved } from "@/shell/titlebar/session-events"
import { projectSettingsKey, useSettings } from "@/settings/model"
import { sessionFormRequest, sessionTreeIDs } from "@/session/requests/session-request-tree"
import { sidebarRefresh, sidebarRows } from "./adapter"
import type { SidebarFilter, SidebarRow } from "./model"

export function createServerSidebar(connection: ServerConnection.Any, filter: () => SidebarFilter) {
  const global = useGlobal()
  const tabs = useTabs()
  const settings = useSettings()
  const queryClient = useQueryClient()
  const key = ServerConnection.key(connection)
  const ctx = () => global.serverCtx(key)
  const connected = () => ctx()?.sdk.connection.status() === "connected"
  const [state, setState] = createStore({
    history: false,
    deleted: [] as string[],
    viewed: {} as Record<string, number>,
  })
  const index = useQuery(() => {
    const context = ctx()
    return {
      queryKey: ["home-sessions", connection] as const,
      queryFn: context
        ? ({ signal }: { signal: AbortSignal }) =>
            loadHomeSessionIndex((input, options) => context.sdk.api.session.list(input, options), signal)
        : skipToken,
      enabled: connected() && filter().status === "active",
      retry: false,
      staleTime: 30_000,
      select: (sessions: SessionInfo[]) => () => sessions,
    }
  })
  const history = useInfiniteQuery(() => {
    const context = ctx()
    const archived = filter().status === "archived"
    return {
      queryKey: ["sidebar-history", connection, filter().status] as const,
      enabled: connected() && (archived || state.history),
      initialPageParam: undefined as string | undefined,
      queryFn: context
        ? ({ pageParam, signal }: { pageParam: string | undefined; signal: AbortSignal }) =>
            context.sdk.api.session.list(
              { parentID: null, order: "desc", limit: HOME_SESSION_LIMIT, archived, cursor: pageParam },
              { signal },
            )
        : skipToken,
      getNextPageParam: (page) => page.cursor.next,
      retry: false,
      staleTime: 30_000,
    }
  })
  const activity = useQuery(() => {
    const context = ctx()
    return {
      queryKey: ["sidebar-activity", connection] as const,
      enabled: connected(),
      queryFn: context
        ? async ({ signal }: { signal: AbortSignal }) => {
            const active = await context.sdk.api.session.active({ signal })
            const families = await Promise.all(
              Object.keys(active).map(async (sessionID) => {
                const family: SessionInfo[] = []
                let id: string | undefined = sessionID
                while (id) {
                  const session: SessionInfo =
                    context.data.session.get(id) ?? (await context.sdk.api.session.get({ sessionID: id }, { signal }))
                  family.push(session)
                  id = session.parentID
                }
                return family
              }),
            )
            const sessions = [...new Map(families.flat().map((session) => [session.id, session])).values()]
            const locations = [
              ...new Map(sessions.map((session) => [session.location.directory, session.location])).values(),
            ]
            const requests = await Promise.all(
              locations.map(async (location) => {
                const [permissions, forms] = await Promise.all([
                  context.sdk.api.permission.request.list({ location }, { signal }),
                  context.sdk.api.form.list({ location }, { signal }),
                ])
                return { permissions: permissions.data, forms: forms.data }
              }),
            )
            await Promise.all([
              ...[
                ...new Set(requests.flatMap((requests) => requests.permissions.map((request) => request.sessionID))),
              ].map((id) => {
                context.data.session.permission.invalidate(id)
                return context.data.session.permission.sync(id)
              }),
              ...[...new Set(requests.flatMap((requests) => requests.forms.map((form) => form.sessionID)))]
                .filter((id) => id !== "global")
                .map((id) => {
                  context.data.session.form.invalidate(id)
                  return context.data.session.form.sync(id)
                }),
            ])
            return { active, sessions }
          }
        : skipToken,
      retry: false,
      staleTime: 30_000,
    }
  })
  createEffect(() => {
    const context = ctx()
    if (!context) return
    onCleanup(
      context.sdk.event.listen((event) => {
        if (event.type === "session.deleted") setState("deleted", (ids) => [...ids, event.data.sessionID])
        const refresh = sidebarRefresh(event.type)
        if (refresh.activity)
          void queryClient.invalidateQueries({ queryKey: ["sidebar-activity", connection], exact: true })
        if (refresh.history) {
          void queryClient.invalidateQueries({ queryKey: ["home-sessions", connection], exact: true })
          void queryClient.invalidateQueries({ queryKey: ["sidebar-history", connection] })
        }
        const requested =
          event.type === "permission.asked"
            ? event.data.sessionID
            : event.type === "form.created"
              ? event.data.form.sessionID
              : undefined
        if (requested && requested !== "global" && !context.data.session.get(requested))
          void context.data.session.sync(requested).catch(() => undefined)
        if (event.type === "permission.asked" || event.type === "permission.replied") {
          context.data.session.permission.invalidate(event.data.sessionID)
          void context.data.session.permission.sync(event.data.sessionID).catch(() => undefined)
        }
        if (event.type === "form.created" || event.type === "form.replied" || event.type === "form.cancelled") {
          const id = event.type === "form.created" ? event.data.form.sessionID : event.data.sessionID
          if (id === "global") return
          context.data.session.form.invalidate(id)
          void context.data.session.form.sync(id).catch(() => undefined)
        }
      }),
    )
  })
  const sessions = createMemo(() => [
    ...(filter().status === "active" && !index.isPending ? (index.data?.() ?? []) : []),
    ...(history.isPending ? [] : (history.data?.pages.flatMap((page) => page.data) ?? [])),
    ...(activity.isPending ? [] : (activity.data?.sessions ?? [])),
  ])
  const rows = createMemo(() => {
    const context = ctx()
    if (!context) return []
    const data = context.data.session
    const snapshot = activity.isPending ? undefined : activity.data
    const root = (id: string): string => {
      const session = data.get(id) ?? snapshot?.sessions.find((session) => session.id === id)
      return session?.parentID ? root(session.parentID) : data.root(id)
    }
    const permissions = data.permission
      .sessions()
      .filter(
        (id) =>
          !settings.permissions.autoApproves(
            projectSettingsKey(
              context.sdk.scope,
              (data.get(id) ?? snapshot?.sessions.find((session) => session.id === id))?.projectID,
            ),
          ),
      )
    const input = new Set(
      [...permissions, ...data.form.sessions().filter((id) => !!sessionFormRequest([], data.form.list, id))].map(root),
    )
    const working = new Set(
      [
        ...data.active(),
        ...Object.keys(snapshot?.active ?? {}),
        ...data
          .list()
          .filter((session) => data.pending.list(session.id).some((item) => item.type !== "synthetic"))
          .map((session) => session.id),
      ].map(root),
    )
    return sidebarRows({
      server: key,
      sessions: context.data.session.apply(sessions()).filter((session) => !state.deleted.includes(session.id)),
      known: data.list().filter((session) => !state.deleted.includes(session.id)),
      project: (session) => {
        const project = context.projects.forSession(session)
        return {
          id: project?.id ?? session.projectID,
          name: displayName(project ?? { worktree: session.location.directory }),
          directory: project?.worktree ?? session.location.directory,
        }
      },
      activity: {
        input,
        working,
        review: new Set(
          [...sessions(), ...data.list()]
            .filter((session) => {
              if (session.parentID) return false
              const acked = state.viewed[session.id]
              const idle = data.get(session.id)?.time.idle ?? session.time.idle
              if (acked !== undefined && idle !== undefined && idle <= acked) return false
              return context.notification.session.unread(session.id, session)
            })
            .map((session) => root(session.id)),
        ),
      },
    })
  })
  return {
    rows,
    loading: () => (filter().status === "active" ? index.isPending : history.isPending),
    failed: () => (filter().status === "active" && index.isError) || history.isError || activity.isError,
    connected,
    retry: () => {
      if (filter().status === "active") void index.refetch()
      if (filter().status === "archived" || state.history) void history.refetch()
      void activity.refetch()
    },
    more: () => (filter().status === "active" && !state.history) || !!history.hasNextPage,
    fetching: () => history.isFetching,
    loadMore: () => {
      if (filter().status === "active" && !state.history) return setState("history", true)
      void history.fetchNextPage()
    },
    open: (row: SidebarRow, options?: { background?: boolean }) => {
      const context = ctx()
      const session =
        context?.data.session.get(row.session.id) ?? sessions().find((session) => session.id === row.session.id)
      if (!context || !session) return
      void startTransition(() => {
        context.data.session.remember(session)
        context.projects.open(row.project.directory)
        if (!options?.background) context.projects.touch(row.project.directory)
        const tab = tabs.addSessionTab({ server: key, sessionId: session.id })
        if (!options?.background) {
          tabs.select(tab)
          if (session.time.idle !== undefined) {
            setState("viewed", session.id, session.time.idle)
          }
          context.notification.session.markViewed(session.id)
        }
      })
    },
    newSessionInProject: (directory: string) => {
      const context = ctx()
      if (!context) return
      context.projects.open(directory)
      context.projects.touch(directory)
      void tabs.newDraft({ server: key, directory }, "")
    },
    interrupt: async (row: SidebarRow) => {
      const context = ctx()
      if (!context) return false
      try {
        await context.sdk.api.session.interrupt({ sessionID: row.session.id })
        void queryClient.invalidateQueries({ queryKey: ["sidebar-activity", connection], exact: true })
        return true
      } catch {
        return false
      }
    },
    rename: async (row: SidebarRow, title: string) => {
      const context = ctx()
      const next = title.trim()
      if (!context || !next) return false
      const session =
        context.data.session.get(row.session.id) ?? sessions().find((item) => item.id === row.session.id)
      try {
        await context.sdk.api.session.update({ sessionID: row.session.id, title: next })
        if (session) context.data.session.remember({ ...session, title: next })
        context.data.session.invalidate(row.session.id)
        void context.data.session.sync(row.session.id).catch(() => undefined)
        queryClient.setQueryData<SessionInfo[]>(["home-sessions", connection], (current) => {
          if (!Array.isArray(current)) return current
          return current.map((item) => (item.id === row.session.id ? { ...item, title: next } : item))
        })
        void queryClient.invalidateQueries({ queryKey: ["sidebar-history", connection] })
        return true
      } catch {
        return false
      }
    },
    setArchived: async (row: SidebarRow, archived: boolean) => {
      const context = ctx()
      if (!context) return false
      const session =
        context.data.session.get(row.session.id) ?? sessions().find((item) => item.id === row.session.id)
      try {
        await context.sdk.api.session.update({ sessionID: row.session.id, archived })
        if (session) {
          const nextTime = { ...session.time }
          if (archived) nextTime.archived = Date.now()
          else delete nextTime.archived
          context.data.session.remember({ ...session, time: nextTime })
        }
        if (archived) {
          notifySessionTabsRemoved({
            server: key,
            directory: row.session.location.directory,
            sessionIDs: [row.session.id],
          })
        }
        void queryClient.invalidateQueries({ queryKey: ["home-sessions", connection], exact: true })
        void queryClient.invalidateQueries({ queryKey: ["sidebar-history", connection] })
        return true
      } catch {
        return false
      }
    },
    remove: async (row: SidebarRow) => {
      const context = ctx()
      if (!context) return false
      const ids = sessionTreeIDs(context.data.session.list(), row.session.id)
      try {
        await context.data.session.remove(row.session.id)
        setState("deleted", (current) => [...current, row.session.id])
        notifySessionTabsRemoved({
          server: key,
          directory: row.session.location.directory,
          sessionIDs: ids,
        })
        void queryClient.invalidateQueries({ queryKey: ["home-sessions", connection], exact: true })
        void queryClient.invalidateQueries({ queryKey: ["sidebar-history", connection] })
        return true
      } catch {
        return false
      }
    },
    markRead: (row: SidebarRow) => {
      const context = ctx()
      if (!context) return
      const current =
        context.data.session.get(row.session.id) ??
        sessions().find((item) => item.id === row.session.id) ??
        row.session
      const idle = current.time.idle ?? row.session.time.idle
      if (idle === undefined) return
      setState("viewed", row.session.id, idle)
      queryClient.setQueryData<SessionInfo[]>(["home-sessions", connection], (prev) => {
        if (!Array.isArray(prev)) return prev
        return prev.map((item) =>
          item.id === row.session.id
            ? { ...item, time: { ...item.time, viewed: Math.max(item.time.viewed ?? 0, idle) } }
            : item,
        )
      })
      if (context.data.session.get(row.session.id)?.time.idle !== undefined) {
        context.notification.session.markViewed(row.session.id)
      } else {
        void context.sdk.api.session.view({ sessionID: row.session.id, idle }).catch(() => undefined)
      }
    },
    markAllRead: () => {
      const context = ctx()
      if (!context) return
      const targets = rows().filter((row) => row.state === "review")
      if (targets.length === 0) return
      const acknowledgements = new Map<string, number>()
      batch(() => {
        for (const row of targets) {
          const current =
            context.data.session.get(row.session.id) ??
            sessions().find((item) => item.id === row.session.id) ??
            row.session
          const idle = current.time.idle ?? row.session.time.idle
          if (idle === undefined) continue
          setState("viewed", row.session.id, idle)
          acknowledgements.set(row.session.id, idle)
        }
      })
      if (acknowledgements.size > 0) {
        queryClient.setQueryData<SessionInfo[]>(["home-sessions", connection], (prev) => {
          if (!Array.isArray(prev)) return prev
          return prev.map((item) => {
            const idle = acknowledgements.get(item.id)
            if (idle === undefined) return item
            return { ...item, time: { ...item.time, viewed: Math.max(item.time.viewed ?? 0, idle) } }
          })
        })
      }
      for (const [id, idle] of acknowledgements) {
        if (context.data.session.get(id)?.time.idle !== undefined) {
          context.notification.session.markViewed(id)
        } else {
          void context.sdk.api.session.view({ sessionID: id, idle }).catch(() => undefined)
        }
      }
    },
  }
}
