import { atom, read, update } from 'claude-code'
import type { EngineInterface, McpToolResult, Register } from 'claude-code'

import type { CrabLimit, CrabRow, CrabSnapshot, CrabTheme } from '../types'
import { HATS, barSvg, crabSvg, ruleSvg } from './crab'

const PANE = 'crab-agents'
const TITLE = 'Agents'
const POLL_MS = 12_000
/** The usage card and each session's exact context reading are asked at most this often. */
const USAGE_MS = 60_000
/** A finished reply that ends on a question stops counting as "needs you" after this. */
const REPLY_STALE_MS = 3 * 60 * 60 * 1000
const WINDOW = 'ccd_window'
/** How often the pane checks whether the built-in browser is on screen. */
const BROWSER_MS = 2000
const BROWSER = 'Claude_Browser'
const VIEW = 'ccd_view'
const DAY_MS = 24 * 60 * 60 * 1000
/** A tool call waiting this long in a mode that asks before tools is a permission prompt. */
const APPROVAL_WAIT_MS = 20_000
const SESSIONS = 'ccd_session_mgmt'
/** Without the app's session tools, an open turn written to in this window counts as running. */
const RUNNING_FRESH_MS = 10 * 60 * 1000

const EMPTY: CrabSnapshot = { updatedAt: 0, rows: [], limits: [], limitsAt: 0, error: null }
const snapshot = atom({ plugin: 'crab-agents', key: 'snapshot' } as const, EMPTY)
const finishedOpen = atom({ plugin: 'crab-agents', key: 'finishedOpen' } as const, false)
const themeAtom = atom({ plugin: 'crab-agents', key: 'theme' } as const, 'auto' as CrabTheme)
const closedByYou = atom({ plugin: 'crab-agents', key: 'closedByYou' } as const, false)
const browserInUse = atom({ plugin: 'crab-agents', key: 'browserInUse' } as const, false)

type ListedSession = {
  sessionId: string
  title: string
  isArchived: boolean
  isRunning: boolean
  lastActivityAt: string
  link?: string
  startedBy?: string
}

type Scan = {
  sessionId: string
  cliSessionId: string
  title: string
  isArchived: boolean
  link: string
  parentSessionId: string | null
  model: string
  effort: string
  scheduledTaskId: string | null
  permissionMode: string
  latestUserFrameAt: number
  lastActivityAt: number
  transcript: null | {
    turnOpen: boolean
    progress: { done: number; total: number } | null
    question: string | null
    plan: boolean
    pendingTool: { name: string; at: number } | null
    lastAssistantText: string
    lastRole: string
    lastUserAt: number
    ctxTokens: number
    model: string
    mtimeMs: number
  }
}

type UsageWindow = { label: string; percentUsed: number; resetsAt?: string }
type Usage = {
  plan?: { status: string; windows?: UsageWindow[] }
  context?: { status: string; percentUsed?: number; contextWindow?: number; tokensUsed?: number }
}

// ---------- helpers ----------

const jsonOf = <T,>(r: McpToolResult): T | undefined => {
  if (r.isError) return undefined
  const block = r.content.find(b => (b as { type?: string }).type === 'text') as { text?: string } | undefined
  try {
    return block?.text ? (JSON.parse(block.text) as T) : undefined
  } catch {
    return undefined
  }
}

const callSessions = async <T,>($: EngineInterface, tool: string, args: Record<string, unknown> = {}) =>
  $.mcp.call(SESSIONS, tool, args).then(r => jsonOf<T>(r), () => undefined)

export const prettyModel = (id: string) => {
  const m = /claude-([a-z]+)-(\d+)-(\d+)/i.exec(id)
  if (!m) return id || 'model ?'
  const name = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1)
  return `${name} ${m[2]}.${m[3]}${/\[1m\]/i.test(id) ? ' 1M' : ''}`
}

/** The coloured word for each effort level, in Claude's muted tones. */
export const effortStyle = (effort: string): { word: string; color: string } => {
  switch (effort) {
    case 'low':
      return { word: 'light', color: '#5e9c76' }
    case 'medium':
      return { word: 'medium', color: '#6a8fd8' }
    case 'high':
      return { word: 'careful', color: '#d4a14a' }
    case 'xhigh':
    case 'max':
      return { word: 'heavy', color: '#d97757' }
    default:
      return { word: 'default', color: '#9a978e' }
  }
}

export const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)

export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export const until = (ms: number) => {
  if (ms <= 0) return 'now'
  const mins = Math.ceil(ms / 60000)
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
}

export const ago = (ms: number) => (ms < 60000 ? 'just now' : `${until(ms)} ago`)

/** The final paragraph of a reply asks the person something. */
export const endsWithQuestion = (text: string) => {
  const last = text.trim().split(/\n\s*\n/).at(-1) ?? ''
  return /\?\s*[`*_)"']*\s*$/.test(last) || /\?\s*$/m.test(last.split('\n').slice(-2).join('\n'))
}

export type Classified = { state: CrabRow['state']; attention: string | null }

/** Sorts one session into Needs you / Working / Finished, or drops it (null). */
export const classify = (
  s: { isRunning: boolean; lastActivityAt: number },
  scan: Scan | undefined,
  now: number,
): Classified | null => {
  const t = scan?.transcript
  if (t?.question) return { state: 'attention', attention: `Question: ${t.question}` }
  if (t?.plan) return { state: 'attention', attention: 'Plan waiting for your approval' }
  const asks = !['auto', 'bypassPermissions', 'dontAsk'].includes(scan?.permissionMode ?? 'auto')
  if (s.isRunning && asks && t?.pendingTool && now - t.pendingTool.at > APPROVAL_WAIT_MS)
    return { state: 'attention', attention: `Waiting for approval: ${t.pendingTool.name}` }
  if (s.isRunning) return { state: 'working', attention: null }
  if (now - s.lastActivityAt > DAY_MS) return null
  if (t?.lastRole === 'assistant' && now - s.lastActivityAt < REPLY_STALE_MS && endsWithQuestion(t.lastAssistantText))
    return { state: 'attention', attention: 'Waiting on your reply' }
  return { state: 'finished', attention: null }
}

/** Keeps each session's hat, and gives a new one a hat no visible crab wears. */
export const assignHats = (ids: string[], held: Record<string, number>) => {
  const out: Record<string, number> = {}
  const used = new Set<number>()
  for (const id of ids) {
    const hat = held[id]
    if (hat !== undefined && !used.has(hat) && used.size < HATS.length) {
      out[id] = hat
      used.add(hat)
    }
  }
  for (const id of ids) {
    if (out[id] !== undefined) continue
    let hat = 0
    while (used.has(hat) && hat < HATS.length) hat++
    if (hat >= HATS.length) hat = Object.keys(out).length % HATS.length
    out[id] = hat
    used.add(hat)
  }
  return out
}

// ---------- plan limits ----------

type StoredLimits = { limits: CrabLimit[]; readAt: number }

/** The kept reading; an older build stored a bare list with no time. */
export const asStoredLimits = (v: unknown): StoredLimits => {
  if (Array.isArray(v)) return { limits: v as CrabLimit[], readAt: 0 }
  const o = v as Partial<StoredLimits> | undefined
  return o && Array.isArray(o.limits) ? { limits: o.limits, readAt: Number(o.readAt) || 0 } : { limits: [], readAt: 0 }
}

/**
 * The app's usage card is the one source of truth: it is the account's live
 * figure, the same in every session. When the app cannot answer for a moment,
 * the last card reading is kept (shared by every session through the store)
 * until its window resets. A session's own last API reading is used only when
 * there has never been a card reading: it is that one session's view, often
 * hours old, and it never replaces the card's.
 */
export const pickLimits = (app: CrabLimit[] | null, stored: StoredLimits, fallback: CrabLimit[], now: number) => {
  const live = (ls: CrabLimit[]) => ls.filter(l => !l.resetsAt || Date.parse(l.resetsAt) > now)
  if (app) return { limits: app, readAt: now, source: 'app' as const }
  const kept = live(stored.limits)
  if (kept.length) return { limits: kept, readAt: stored.readAt, source: 'kept' as const }
  return { limits: live(fallback), readAt: 0, source: 'session' as const }
}

// ---------- on screen ----------

/**
 * Every open session runs this mod, so a session that is not on screen does
 * no work: no scan, no usage calls, no redraws, and it never reopens its pane
 * (which could pull the app's focus back to it). True when the app cannot say.
 */
let isShown = true
let shownAt = 0

const isOnScreen = async ($: EngineInterface) => {
  const now = await $.clock.now()
  if (now - shownAt < 1500) return isShown
  const layout = await $.mcp
    .call(WINDOW, 'get_window_layout', {})
    .then(r => jsonOf<{ this_session?: { on_screen?: boolean } }>(r), () => undefined)
  isShown = layout?.this_session?.on_screen ?? true
  shownAt = now
  return isShown
}

// ---------- polling ----------

let isPolling = false
let usageAt = 0
let usageLast: Usage | undefined
/** Exact context readings per session, asked at most once a USAGE_MS. */
const ctxRead = new Map<string, { at: number; percent: number }>()

const runScanner = async ($: EngineInterface, ids: string[]) => {
  const script = `${$.plugin.root}/bin/scan.mjs`
  const r = await $.process.run(['node', script], { stdin: JSON.stringify({ ids, all: true }), timeoutMs: 20000 })
  if (r.exitCode !== 0) throw new Error(`scanner: ${r.stderr.slice(0, 200)}`)
  return JSON.parse(r.stdout || '{}') as Record<string, Scan>
}

const poll = async ($: EngineInterface, force = false) => {
  if (isPolling) return
  if (!force && !(await isOnScreen($))) return
  isPolling = true
  try {
    const now = await $.clock.now()
    const isUsageDue = force || now - usageAt >= USAGE_MS
    const [listed, self, usageNow, cliId] = await Promise.all([
      callSessions<ListedSession[]>($, 'list_sessions', { limit: 60 }),
      callSessions<ListedSession>($, 'get_session', { session_id: 'self' }),
      isUsageDue ? callSessions<Usage>($, 'get_usage', {}) : Promise.resolve(undefined),
      $.session.id().catch(() => ''),
    ])
    if (usageNow) {
      usageLast = usageNow
      usageAt = now
    }
    const usage = usageNow ?? usageLast
    const fromApp = [...(self ? [self] : []), ...(listed ?? [])]
    const scans = await runScanner($, fromApp.map(s => s.sessionId)).catch(err => {
      $.ui.log(`crab-agents: ${String(err)}`, { to: 'debug' })
      return {} as Record<string, Scan>
    })
    if (!listed && !Object.keys(scans).length) throw new Error('no sessions found')

    // The app's own list when its session tools answer; else the app's files on disk.
    const byId = new Map<string, ListedSession & { isSelf: boolean }>()
    for (const sc of Object.values(scans)) {
      const t = sc.transcript
      byId.set(sc.sessionId, {
        sessionId: sc.sessionId,
        title: sc.title,
        isArchived: sc.isArchived,
        isRunning: !!t?.turnOpen && now - t.mtimeMs < RUNNING_FRESH_MS,
        lastActivityAt: new Date(sc.lastActivityAt).toISOString(),
        link: sc.link,
        startedBy: sc.parentSessionId ?? undefined,
        isSelf: !!cliId && sc.cliSessionId === cliId,
      })
    }
    if (listed) for (const s of byId.values()) if (!s.isSelf) s.isRunning = false
    for (const s of fromApp) byId.set(s.sessionId, { ...byId.get(s.sessionId), ...s, isSelf: s.sessionId === self?.sessionId })

    const all = [...byId.values()]
      .filter(s => !s.isArchived && !s.startedBy)
      .filter(s => s.isRunning || now - Date.parse(s.lastActivityAt) < DAY_MS)

    // Context windows learned per model from exact readings, for idle sessions.
    const windows = ((await $.store.get('windows')) ?? {}) as Record<string, number>
    const dismissed = ((await $.store.get('dismissed')) ?? {}) as Record<string, number>
    const exact = new Map<string, number>()
    const running = all.filter(s => s.isRunning).slice(0, 8)
    await Promise.all(
      running.map(async s => {
        const kept = ctxRead.get(s.sessionId)
        if (kept && now - kept.at < USAGE_MS) return void exact.set(s.sessionId, kept.percent)
        const u = s.isSelf ? usage : await callSessions<Usage>($, 'get_usage', { session_id: s.sessionId }).catch(() => undefined)
        const c = u?.context
        if (c?.status !== 'ok' || c.percentUsed == null) return
        ctxRead.set(s.sessionId, { at: now, percent: c.percentUsed })
        exact.set(s.sessionId, c.percentUsed)
        const model = scans[s.sessionId]?.model
        if (model && c.contextWindow) windows[model] = c.contextWindow
      }),
    )
    await $.store.set('windows', windows)

    const rows: Omit<CrabRow, 'hat'>[] = []
    for (const s of all) {
      const scan = scans[s.sessionId]
      if (scan?.scheduledTaskId) continue // routines and other scheduled runs stay out
      // The transcript's own write time: the app also bumps a session's
      // lastActivityAt when it is merely focused or its config is rewritten,
      // which made old sessions look fresh and undid every Dismiss.
      const lastActivityAt = scan?.transcript?.mtimeMs
        ? Math.round(scan.transcript.mtimeMs)
        : Math.max(Date.parse(s.lastActivityAt) || 0, scan?.lastActivityAt ?? 0)
      const c = classify({ isRunning: s.isRunning, lastActivityAt }, scan, now)
      if (!c) continue
      if (c.state === 'attention' && dismissed[s.sessionId] === lastActivityAt) {
        if (s.isRunning) c.state = 'working'
        else c.state = 'finished'
        c.attention = null
      }
      const t = scan?.transcript
      const model = t?.model || scan?.model || ''
      const ctxTokens = t?.ctxTokens ?? 0
      const window = windows[model] ?? (ctxTokens > 200_000 ? 1_000_000 : 200_000)
      rows.push({
        id: s.sessionId,
        title: s.title || 'Untitled',
        link: s.link ?? '',
        isSelf: s.isSelf,
        state: c.state,
        attention: c.attention,
        isRunning: s.isRunning,
        model,
        effort: scan?.effort ?? '',
        ctxTokens,
        ctxPercent: exact.get(s.sessionId) ?? (ctxTokens ? Math.min(100, Math.round((ctxTokens / window) * 100)) : null),
        progress: t?.progress ?? null,
        turnStartedAt: Math.max(scan?.latestUserFrameAt ?? 0, t?.lastUserAt ?? 0) || lastActivityAt,
        lastActivityAt,
      })
    }

    const order = { attention: 0, working: 1, finished: 2 }
    rows.sort((a, b) =>
      order[a.state] !== order[b.state]
        ? order[a.state] - order[b.state]
        : a.state === 'working'
          ? a.turnStartedAt - b.turnStartedAt
          : b.lastActivityAt - a.lastActivityAt,
    )

    const held = ((await $.store.get('hats')) ?? {}) as Record<string, number>
    const hats = assignHats(rows.map(r => r.id), held)
    // Keep a hat for a while after its crab leaves, so a returning session keeps it.
    await $.store.set('hats', Object.fromEntries(Object.entries({ ...held, ...hats }).slice(-80)))

    const app: CrabLimit[] | null =
      usage?.plan?.status === 'ok' && usage.plan.windows?.length
        ? usage.plan.windows.map(w => ({ label: w.label, percentUsed: w.percentUsed, resetsAt: w.resetsAt ?? null }))
        : null
    const stored = asStoredLimits(await $.store.get('limits'))
    const fallback = app || stored.limits.length
      ? []
      : ((await $.session.usage().catch(() => undefined))?.rateLimits ?? []).map(r => ({
          label: r.kind === 'five_hour' ? '5-hour limit' : r.kind === 'seven_day' ? 'Weekly · all models' : r.kind,
          percentUsed: r.percentUsed,
          resetsAt: r.resetsAt ?? null,
        }))
    const picked = pickLimits(app, stored, fallback, now)
    if (app) await $.store.set('limits', { limits: app, readAt: now })

    await update($, snapshot, () => ({
      updatedAt: now,
      rows: rows.map(r => ({ ...r, hat: hats[r.id] ?? 0 })),
      limits: picked.limits,
      limitsAt: picked.readAt,
      error: null,
    }))
    const tally = (st: CrabRow['state']) => rows.filter(r => r.state === st).length
    $.ui.log(`crab-agents: ${listed ? 'app' : 'disk'} list, needs you ${tally('attention')}, working ${tally('working')}, finished ${tally('finished')}, limits ${picked.source} ${picked.limits.length}: ${rows.map(r => `${r.title} [${r.state}${r.attention ? `: ${r.attention}` : ''}] hat ${hats[r.id]}`).join('; ')}`, { to: 'debug' })
  } catch (err) {
    await update($, snapshot, s => ({ ...s, error: String(err instanceof Error ? err.message : err) }))
  } finally {
    isPolling = false
  }
}

/**
 * The only link handed to the OS: the app's own session deep link, rebuilt
 * from a checked id. Whatever the session list says, nothing else (a file
 * path, another scheme) ever reaches rundll32, open or xdg-open.
 */
export const safeLink = (id: string) => (/^local_[A-Za-z0-9-]{1,80}$/.test(id) ? `claude://claude.ai/epitaxy/${id}` : null)

const openSession = async ($: EngineInterface, row: CrabRow) => {
  if (row.isSelf) {
    $.ui.toast('You are already in this session.')
    return
  }
  const link = safeLink(row.id)
  if (!link) {
    $.ui.toast(`Could not open “${row.title}”`)
    return
  }
  // Same as clicking its row in the sidebar: hand the app its own deep link,
  // through a small Node launcher that outlives the hand-off to the app.
  $.ui.toast(`Opening “${row.title}”…`)
  const argv = ['node', `${$.plugin.root}/bin/open.mjs`, link]
  const r = await $.process.run(argv, { timeoutMs: 10000 }).catch(err => ({ exitCode: 1, stderr: String(err), stdout: '' }))
  $.ui.log(`crab-agents: open ${row.id} exit ${r.exitCode} ${r.stderr.slice(0, 200)}`, { to: 'debug' })
  if (r.exitCode !== 0) $.ui.toast(`Could not open “${row.title}”`)
}

const dismiss = async ($: EngineInterface, row: CrabRow) => {
  const dismissed = ((await $.store.get('dismissed')) ?? {}) as Record<string, number>
  dismissed[row.id] = row.lastActivityAt
  await $.store.set('dismissed', Object.fromEntries(Object.entries(dismissed).slice(-100)))
  await poll($, true)
}

// ---------- pane visibility ----------

/** Reads the browser tool's answer: open, and on screen rather than hidden behind another pane. */
export const browserShown = (text: string) =>
  /"browserOpen"\s*:\s*true/.test(text) && !/\bis currently hidden\b/i.test(text)

/** True while the built-in browser pane is open and on screen in this session. */
const isBrowserInUse = async ($: EngineInterface) => {
  const r = await $.mcp.call(BROWSER, 'tabs_context', {}).catch(() => undefined)
  if (r && !r.isError) {
    const text = r.content.map(b => (b as { text?: string }).text ?? '').join('\n')
    if (/"browserOpen"/.test(text)) return browserShown(text)
  }
  // Without the browser tool: the app's layout lists the side panes that are open.
  const layout = await $.mcp.call(VIEW, 'get_layout', {}).then(x => jsonOf<{ open_panes?: unknown }>(x), () => undefined)
  return /browser|preview/i.test(JSON.stringify(layout?.open_panes ?? []))
}

let isSyncing = false

/**
 * Keeps the pane up unless the person closed it in this session or the
 * built-in browser is on screen; the browser closing brings it back.
 */
const syncPane = async ($: EngineInterface) => {
  if (isSyncing) return
  isSyncing = true
  try {
    const wasShown = isShown
    if (!(await isOnScreen($))) return
    // Back on screen: refresh now rather than at the next poll.
    if (!wasShown) void poll($)
    const browser = await isBrowserInUse($).catch(() => false)
    if (browser !== (await read($, browserInUse))) await update($, browserInUse, () => browser)
    const isWanted = !(await read($, closedByYou)) && !browser
    const isUp = (await $.ui.panes().catch(() => [])).some(p => p.id === PANE)
    if (isWanted && !isUp) await $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
    if (!isWanted && isUp) await $.ui.close({ id: PANE }).catch(() => undefined)
  } finally {
    isSyncing = false
  }
}

// ---------- look ----------

type Palette = {
  bg: string | undefined
  card: string | undefined
  hover: string
  line: string
  text: string
  dim: string
  red: string
  green: string
  amber: string
  accent: string
  /** Soft red behind a session that needs you, in place of a frame. */
  alert: string
  /** The hairline between rows, as a colour SVG can paint. */
  rule: string
}

/**
 * `auto` paints no background and uses the app's theme keys, so the pane
 * follows Claude's light or dark setting. `light` and `dark` force Claude
 * desktop's own surfaces: warm ivory and paper, or its charcoal greys.
 */
const PALETTES: Record<CrabTheme, Palette> = {
  auto: {
    bg: undefined,
    card: undefined,
    hover: 'promptBorder',
    line: 'subtle',
    text: 'text',
    dim: 'inactive',
    red: 'error',
    green: 'success',
    amber: 'warning',
    accent: 'claude',
    alert: 'diffRemovedDimmed',
    rule: '#8a877e55',
  },
  light: {
    bg: '#faf9f5',
    card: '#ffffff',
    hover: '#f0eee6',
    line: '#e3e0d6',
    text: '#141413',
    dim: '#73726c',
    red: '#c4433a',
    green: '#3f8a5a',
    amber: '#a8701f',
    accent: '#d97757',
    alert: '#f9e9e6',
    rule: '#e3e0d6',
  },
  dark: {
    bg: '#262624',
    card: '#30302e',
    hover: '#3a3a37',
    line: '#45443f',
    text: '#faf9f5',
    dim: '#a6a39a',
    red: '#ec6a60',
    green: '#6fb383',
    amber: '#d9a24a',
    accent: '#d97757',
    alert: '#3b2a27',
    rule: '#45443f',
  },
}

const NEXT_THEME: Record<CrabTheme, CrabTheme> = { auto: 'light', light: 'dark', dark: 'auto' }
const THEME_LABEL: Record<CrabTheme, string> = { auto: '◐ Auto', light: '☀ Light', dark: '☾ Dark' }

export const nextTheme = (t: CrabTheme) => NEXT_THEME[t]
const isTheme = (v: unknown): v is CrabTheme => v === 'auto' || v === 'light' || v === 'dark'

// ---------- hooks ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // The theme choice is kept across sessions; each session starts on it.
    const saved = await $.store.get('theme')
    if (isTheme(saved)) await update($, themeAtom, () => saved)
    await $.command.register({ name: 'crabs', description: 'Open the Agents pane: every working and finished session' })
    void syncPane($).catch(() => undefined)
    void poll($, true)
    $.clock.every(POLL_MS, () => void poll($))
    $.clock.every(BROWSER_MS, () => void syncPane($).catch(() => undefined))
    // The turn clocks tick each second only while a session runs and this one
    // is on screen; otherwise the "ago" labels are refreshed every half minute.
    let tick = 0
    $.clock.every(1000, () => {
      tick++
      if (!isShown) return
      void read($, snapshot).then(snap => {
        if (tick % 30 === 0 || snap.rows.some(r => r.isRunning)) $.ui.invalidate('ui.render')
      })
    })
    return started
  })

  on('prompt.submit', async ($, e, next) => {
    void syncPane($).catch(() => undefined)
    return next(e)
  })

  // Closed by hand: it stays closed for the rest of this session ($.state is
  // per session, so a new session shows it again). The mod's own close for
  // the browser has origin `plugin` and is not counted.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await update($, closedByYou, () => true).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'crabs' }, async $ => {
    await update($, closedByYou, () => false)
    await $.ui.open({ id: PANE, title: TITLE, focus: true })
    void poll($, true)
    const browser = await read($, browserInUse)
    return { text: browser ? 'Agents pane opened. It steps aside again while the browser is on screen.' : 'Agents pane opened.' }
  })

  // Clicks from the click layers: a crab card opens its session, COMPLETED folds.
  on('ui.message', async ($, e, next) => {
    const data = (e.data ?? {}) as { open?: unknown; toggle?: unknown }
    if (e.requestId !== PANE) return next(e)
    if (data.toggle === 'completed') {
      await update($, finishedOpen, v => !v)
      return {}
    }
    if (data.toggle === 'theme') {
      const chosen = nextTheme(await read($, themeAtom))
      await update($, themeAtom, () => chosen)
      await $.store.set('theme', chosen)
      return {}
    }
    if (typeof data.open !== 'string') return next(e)
    const row = (await read($, snapshot)).rows.find(r => r.id === data.open)
    if (row) await openSession($, row)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Svg = 'Svg' in els ? els.Svg : undefined
    const Client = 'Client' in els ? els.Client : undefined
    const snap = await read($, snapshot)
    const isFinishedOpen = await read($, finishedOpen)
    const theme = await read($, themeAtom)
    const C = PALETTES[theme]
    const now = await $.clock.now()
    const cols = e.props.bodyColumns
    const barPx = Math.max(80, Math.min(420, (cols - 10) * 7))

    const attention = snap.rows.filter(r => r.state === 'attention')
    const working = snap.rows.filter(r => r.state === 'working')
    const finished = snap.rows.filter(r => r.state === 'finished')

    const clickLayer = (key: string, msg: { open: string } | { toggle: string }) =>
      Client ? (
        <Box position="absolute" top={0} left={0} right={0} bottom={0}>
          <Client key={key} module="./click.ts" props={{ msg }} width="100%" height="100%" />
        </Box>
      ) : (
        ''
      )

    /** A small section label, like the sidebar's group headings in Claude. */
    const heading = (key: string, label: string, color: string) => (
      <Text key={key} bold color={color}>
        {label}
      </Text>
    )

    /** A 1px hairline across the pane: rows sit between these, like the sidebar's list. */
    const rule = (key: string) =>
      Svg ? (
        <Svg key={key} source={ruleSvg(C.rule)} alt="" height={1} />
      ) : (
        <Text key={key} color={C.line} wrap="truncate-end">{'─'.repeat(Math.max(4, cols - 2))}</Text>
      )
    /** Rows with a hairline between each, no frames. */
    const rows = (prefix: string, list: CrabRow[]) => list.flatMap((r, i) => (i ? [rule(`${prefix}-rule-${r.id}`), card(r)] : [card(r)]))

    const tile = (key: string, label: string, value: string, note: string, valueColor: string, noteColor = C.dim) => (
      <Box key={key} flexDirection="column" flexGrow={1}>
        <Text color={C.dim} wrap="truncate-end">{label}</Text>
        <Text bold color={valueColor} wrap="truncate-end">{value}</Text>
        <Text color={noteColor} wrap="truncate-end">{note}</Text>
      </Box>
    )

    const limitTile = (label: string, l: CrabLimit | undefined) => {
      const resets = l?.resetsAt ? Date.parse(l.resetsAt) - now : null
      const pct = l?.percentUsed ?? null
      const color = pct == null ? C.dim : pct >= 90 ? C.red : pct >= 70 ? C.amber : C.text
      return tile(`limit-${label}`, label, resets == null ? '—' : `resets in ${until(resets)}`, pct == null ? 'no data yet' : `${pct}% used`, color, color === C.text ? C.dim : color)
    }

    const card = (r: CrabRow) => {
      const eff = effortStyle(r.effort)
      const isAttention = r.state === 'attention'
      const isDone = r.state === 'finished'
      const barColor = isAttention ? C.red : isDone ? C.green : eff.color
      // No checklist: a working session shows a calm, full, faded bar. Nothing moves.
      const fraction = r.progress ? r.progress.done / Math.max(1, r.progress.total) : isDone || r.isRunning || isAttention ? 1 : 0
      const fillOpacity = r.progress || isAttention ? 1 : 0.45
      const elapsed = r.isRunning ? clock(now - r.turnStartedAt) : ago(now - r.lastActivityAt)
      const ctx = [r.ctxPercent != null ? `ctx ${r.ctxPercent}%` : null, r.ctxTokens ? tokens(r.ctxTokens) : null, elapsed]
        .filter(Boolean)
        .join(' · ')
      const count = r.progress ? `${r.progress.done}/${r.progress.total} tasks` : r.isRunning ? 'Working' : isDone ? 'Done' : 'Idle'
      return (
        <Box
          key={`card-${r.id}`}
          position="relative"
          flexDirection="column"
          paddingX={1}
          paddingY={isAttention ? 1 : 0}
          backgroundColor={isAttention ? C.alert : undefined}
          hover={{ backgroundColor: isAttention ? C.alert : C.hover }}
        >
          {/* The whole card is the click target, like a sidebar row; drawn first so Open / Dismiss stay on top. */}
          {r.isSelf ? '' : clickLayer(`click-${r.id}`, { open: r.id })}
          <Box flexDirection="row" gap={1}>
            {Svg ? (
              <Svg
                source={crabSvg(r.hat, isAttention)}
                alt={`crab in a ${HATS[r.hat % HATS.length]?.name ?? 'hat'}`}
                width={44}
                height={32}
                isInteractive={isAttention ? true : undefined}
              />
            ) : (
              <Text color={C.accent}>🦀</Text>
            )}
            <Box flexDirection="column" flexGrow={1}>
              <Box flexDirection="row" justifyContent="space-between" gap={1}>
                <Text bold color={C.text} wrap="truncate-end">
                  {r.title}
                </Text>
                {r.isSelf ? <Text color={C.dim}>this session</Text> : isDone ? <Text color={C.green}>✓</Text> : ''}
              </Box>
              <Text wrap="truncate-end">
                <Text color={eff.color}>● {eff.word}</Text>
                <Text color={C.dim}> · {prettyModel(r.model)}</Text>
              </Text>
              <Box flexDirection="row" justifyContent="space-between" gap={1}>
                <Text color={isAttention ? C.red : C.text}>{count}</Text>
                <Text color={C.dim} wrap="truncate-start">{ctx}</Text>
              </Box>
              {Svg ? (
                <Svg
                  source={barSvg(barPx, barColor, fraction, isAttention, fillOpacity)}
                  alt={count}
                  width={barPx}
                  height={6}
                  isInteractive={isAttention ? true : undefined}
                />
              ) : (
                <Text color={barColor}>{'━'.repeat(Math.max(4, Math.round((cols - 12) * fraction)))}</Text>
              )}
            </Box>
          </Box>
          {isAttention ? (
            <Box flexDirection="row" gap={1} justifyContent="space-between">
              <Text color={C.red} wrap="truncate-end">{r.attention}</Text>
              <Box flexDirection="row" gap={1}>
                <Button key={`go-${r.id}`} variant="primary" onPress={() => void openSession($, r)}>Open</Button>
                <Button key={`dismiss-${r.id}`} dimColor onPress={() => void dismiss($, r)}>Dismiss</Button>
              </Box>
            </Box>
          ) : !Client && !r.isSelf ? (
            <Button key={`open-${r.id}`} onPress={() => void openSession($, r)}>Open</Button>
          ) : (
            ''
          )}
        </Box>
      )
    }

    const fiveHour = snap.limits.find(l => /5-hour|five/i.test(l.label))
    const weekly = snap.limits.find(l => /weekly.*all|seven_day/i.test(l.label)) ?? snap.limits.find(l => /weekly/i.test(l.label))
    const otherWeekly = snap.limits.filter(l => l !== fiveHour && l !== weekly && /weekly/i.test(l.label))
    const summary = attention.length
      ? `${attention.length} need${attention.length === 1 ? 's' : ''} you · ${working.length} working`
      : working.length
        ? `${working.length} working · all clear`
        : 'All quiet'

    return (
      <Box flexDirection="column" gap={1} backgroundColor={C.bg} paddingX={1} paddingY={1} minHeight="100%" flexGrow={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
          <Text bold color={attention.length ? C.red : C.text} wrap="truncate-end">
            {summary}
          </Text>
          <Box key="theme-switch" position="relative" paddingX={1} hover={{ backgroundColor: C.hover }}>
            <Text color={C.dim}>{THEME_LABEL[theme]}</Text>
            {clickLayer('toggle-theme', { toggle: 'theme' })}
          </Box>
          {Client ? (
            ''
          ) : (
            <Button key="theme-button" dimColor onPress={() => void update($, themeAtom, t => nextTheme(t)).then(() => read($, themeAtom)).then(t => $.store.set('theme', t))}>
              Theme
            </Button>
          )}
        </Box>

        <Box flexDirection="row" gap={3}>
          {tile('working-count', 'Running', `${working.length + attention.length}`, attention.length ? `${attention.length} need you` : 'all clear', C.text, attention.length ? C.red : C.dim)}
          {limitTile('Session limit', fiveHour)}
          {limitTile('Weekly limit', weekly)}
        </Box>
        {snap.limitsAt && now - snap.limitsAt > 3 * 60_000 ? (
          <Text key="limits-age" color={C.dim}>Limits as of {ago(now - snap.limitsAt)}; the app's usage card did not answer since.</Text>
        ) : (
          ''
        )}
        {otherWeekly.map(l => (
          <Text key={`ow-${l.label}`} color={C.dim}>
            {l.label}: {l.percentUsed}% · resets in {l.resetsAt ? until(Date.parse(l.resetsAt) - now) : '—'}
          </Text>
        ))}
        {snap.error ? <Text color={C.amber}>Could not refresh: {snap.error}</Text> : ''}
        {snap.updatedAt === 0 ? <Text color={C.dim}>Looking for your sessions…</Text> : ''}

        {attention.length ? (
          <Box flexDirection="column">
            {heading('h-attention', `NEEDS YOU · ${attention.length}`, C.red)}
            {rows('a', attention)}
          </Box>
        ) : (
          ''
        )}

        <Box flexDirection="column">
          {heading('h-working', `WORKING · ${working.length}`, C.dim)}
          {working.length ? rows('w', working) : <Text color={C.dim}>Nothing running right now.</Text>}
        </Box>

        <Box flexDirection="column">
          {rule('completed-rule')}
          <Box key="completed-header" position="relative" flexDirection="row" justifyContent="space-between" hover={{ backgroundColor: C.hover }}>
            <Text bold color={C.dim}>
              {isFinishedOpen ? '▾' : '▸'} COMPLETED · {finished.length}
            </Text>
            <Text color={C.dim}>last 24h · {isFinishedOpen ? 'hide' : 'show'}</Text>
            {clickLayer('toggle-completed', { toggle: 'completed' })}
          </Box>
          {Client ? (
            ''
          ) : (
            <Button key="toggle-finished" dimColor onPress={() => void update($, finishedOpen, v => !v)}>
              {isFinishedOpen ? 'Hide completed' : 'Show completed'}
            </Button>
          )}
          {isFinishedOpen ? rows('f', finished) : ''}
        </Box>
      </Box>
    )
  })
}
