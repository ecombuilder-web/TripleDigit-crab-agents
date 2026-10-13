// Crab Agents scanner: run by the mod with Node, outside the hooks sandbox.
// Reads the desktop app's per-session metadata and the tail of each session's
// transcript, and prints one compact JSON record per session id given on stdin.
//
//   echo '{"ids":["local_..."]}' | node scan.mjs
//
// Read-only, but for one parse cache in <config>/cache, readable by its owner alone.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOME = os.homedir()
const ROOTS = [
  path.join(process.env.APPDATA ?? path.join(HOME, 'AppData', 'Roaming'), 'Claude', 'claude-code-sessions'),
  path.join(HOME, 'Library', 'Application Support', 'Claude', 'claude-code-sessions'),
  path.join(HOME, '.config', 'Claude', 'claude-code-sessions'),
]
const CONFIG = process.env.CLAUDE_CONFIG_DIR ?? path.join(HOME, '.claude')
const PROJECTS = path.join(CONFIG, 'projects')
// The cache holds transcript snippets, so it lives in the person's own config
// folder (not the shared temp folder) and is readable by them alone.
const CACHE = path.join(CONFIG, 'cache', 'crab-agents-scan.json')
/** Ids that become file names: nothing that could climb out of a folder. */
const SESSION_ID = /^local_[A-Za-z0-9-]{1,80}$/
const CLI_ID = /^[A-Za-z0-9-]{1,80}$/
const TAIL_BYTES = 1_500_000
const QUESTION_TOOLS = new Set(['AskUserQuestion'])
const PLAN_TOOLS = new Set(['ExitPlanMode'])

const readStdin = () => {
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}') } catch { return {} }
}

/** local_<id>.json → full path, by walking <root>/<account>/<org>/ once. */
const indexMetadata = wanted => {
  const found = new Map()
  for (const root of ROOTS) {
    let accounts
    try { accounts = fs.readdirSync(root) } catch { continue }
    for (const a of accounts) {
      let orgs
      try { orgs = fs.readdirSync(path.join(root, a)) } catch { continue }
      for (const o of orgs) {
        for (const id of wanted) {
          if (found.has(id)) continue
          const p = path.join(root, a, o, `${id}.json`)
          if (fs.existsSync(p)) found.set(id, p)
        }
      }
    }
    if (found.size === wanted.length) break
  }
  return found
}

/** Every session metadata file touched in the last `ms`: the app's own list, read from disk. */
const recentMetadata = ms => {
  const found = new Map()
  const since = Date.now() - ms
  for (const root of ROOTS) {
    let accounts
    try { accounts = fs.readdirSync(root) } catch { continue }
    for (const a of accounts) {
      let orgs
      try { orgs = fs.readdirSync(path.join(root, a)) } catch { continue }
      for (const o of orgs) {
        let files
        try { files = fs.readdirSync(path.join(root, a, o)) } catch { continue }
        for (const f of files) {
          if (!f.startsWith('local_') || !f.endsWith('.json')) continue
          const p = path.join(root, a, o, f)
          try { if (fs.statSync(p).mtimeMs >= since) found.set(f.slice(0, -5), p) } catch {}
        }
      }
    }
    if (found.size) break
  }
  return found
}

const slug = cwd => cwd.replace(/[^A-Za-z0-9]/g, '-')

const findTranscript = (cli, cwds) => {
  for (const cwd of cwds) {
    if (!cwd) continue
    const p = path.join(PROJECTS, slug(cwd), `${cli}.jsonl`)
    if (fs.existsSync(p)) return p
  }
  // Fall back to any project folder holding that session file.
  try {
    for (const dir of fs.readdirSync(PROJECTS)) {
      const p = path.join(PROJECTS, dir, `${cli}.jsonl`)
      if (fs.existsSync(p)) return p
    }
  } catch {}
  return undefined
}

const readTail = file => {
  const { size } = fs.statSync(file)
  const start = Math.max(0, size - TAIL_BYTES)
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(size - start)
    fs.readSync(fd, buf, 0, buf.length, start)
    let text = buf.toString('utf8')
    if (start > 0) text = text.slice(text.indexOf('\n') + 1)
    return { text, isWhole: start === 0 }
  } finally {
    fs.closeSync(fd)
  }
}

const textOf = content =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter(b => b?.type === 'text').map(b => b.text).join('\n')
      : ''

/** Walks transcript lines once: checklist, pending tool calls, last words, context. */
const parseTranscript = (text, isWhole) => {
  let todos = null
  const tasks = new Map() // id → status
  let taskCreates = 0
  const pending = new Map() // tool_use_id → { name, input, at }
  let lastAssistantText = ''
  let lastRole = ''
  let ctxTokens = 0
  let model = ''
  let lastUserAt = 0
  const createIds = new Map() // tool_use_id of a TaskCreate → order

  for (const line of text.split('\n')) {
    if (!line || line[0] !== '{') continue
    let row
    try { row = JSON.parse(line) } catch { continue }
    if (row.isSidechain) continue
    const at = Date.parse(row.timestamp ?? '') || 0
    const msg = row.message
    if (row.type === 'assistant' && msg) {
      if (msg.model && msg.model !== '<synthetic>') model = msg.model
      const u = msg.usage
      if (u) ctxTokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0)
      for (const b of Array.isArray(msg.content) ? msg.content : []) {
        if (b?.type === 'text' && b.text?.trim()) { lastAssistantText = b.text; lastRole = 'assistant' }
        if (b?.type !== 'tool_use') continue
        lastRole = 'tool'
        pending.set(b.id, { name: b.name, input: b.input, at })
        if (b.name === 'TodoWrite' && Array.isArray(b.input?.todos)) todos = b.input.todos
        if (b.name === 'TaskCreate') { taskCreates++; createIds.set(b.id, taskCreates) }
        if (b.name === 'TaskUpdate' && b.input?.taskId != null) tasks.set(String(b.input.taskId), b.input.status ?? tasks.get(String(b.input.taskId)))
      }
    } else if (row.type === 'user' && msg) {
      const content = msg.content
      let isToolResult = false
      for (const b of Array.isArray(content) ? content : []) {
        if (b?.type !== 'tool_result') continue
        isToolResult = true
        pending.delete(b.tool_use_id)
        const order = createIds.get(b.tool_use_id)
        if (order != null) {
          const m = /#?(\d+)/.exec(textOf(b.content) || String(b.content ?? ''))
          const id = m ? m[1] : String(order)
          if (!tasks.has(id)) tasks.set(id, 'pending')
        }
      }
      if (!isToolResult && textOf(content).trim() && !row.isMeta) { lastRole = 'user'; lastUserAt = at }
    }
  }

  let progress = null
  if (todos?.length) {
    progress = { done: todos.filter(t => t.status === 'completed').length, total: todos.length }
  } else if (tasks.size || taskCreates) {
    const live = [...tasks.values()].filter(s => s !== 'deleted')
    progress = { done: live.filter(s => s === 'completed').length, total: Math.max(live.length, 1) }
  }

  const open = [...pending.values()]
  const question = open.find(p => QUESTION_TOOLS.has(p.name))
  const plan = open.find(p => PLAN_TOOLS.has(p.name))
  const other = open.filter(p => !QUESTION_TOOLS.has(p.name) && !PLAN_TOOLS.has(p.name))
  const oldestOther = other.reduce((m, p) => (m && m.at <= p.at ? m : p), null)

  return {
    turnOpen: lastRole === 'user' || lastRole === 'tool',
    progress,
    question: question ? String(question.input?.questions?.[0]?.question ?? 'A question is waiting for you') : null,
    plan: !!plan,
    pendingTool: oldestOther ? { name: oldestOther.name, at: oldestOther.at } : null,
    lastAssistantText: lastAssistantText.slice(-400),
    lastRole,
    lastUserAt,
    ctxTokens,
    model,
    isWhole,
  }
}

/** The few metadata fields the pane uses; the files themselves run to a megabyte. */
const META_FIELDS = ['cliSessionId', 'title', 'isArchived', 'parentSessionId', 'model', 'effort', 'scheduledTaskId', 'permissionMode', 'createdAt', 'latestUserFrameAt', 'lastActivityAt', 'cwd', 'originCwd']

/** Reads a metadata file only when its size or time changed since the last scan. */
const readMeta = (metaPath, metaCache, nextMeta) => {
  const st = fs.statSync(metaPath)
  const stamp = `${st.size}:${st.mtimeMs}`
  const hit = metaCache[metaPath]
  if (hit?.stamp === stamp) {
    nextMeta[metaPath] = hit
    return hit.meta
  }
  const full = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
  const meta = Object.fromEntries(META_FIELDS.map(k => [k, full[k]]))
  nextMeta[metaPath] = { stamp, meta }
  return meta
}

const main = () => {
  const input = readStdin()
  const ids = (Array.isArray(input.ids) ? input.ids : []).filter(id => typeof id === 'string' && SESSION_ID.test(id)).slice(0, 200)
  const all = input.all === true
  const withinMs = Math.min(Number(input.withinMs) || 26 * 3600 * 1000, 7 * 24 * 3600 * 1000)
  let cache = {}
  let metaCache = {}
  try {
    const kept = JSON.parse(fs.readFileSync(CACHE, 'utf8'))
    // { t: transcripts, m: metadata }; an older build kept transcripts alone.
    if (kept?.t && kept?.m) { cache = kept.t; metaCache = kept.m }
  } catch {}
  const metaPaths = all ? recentMetadata(withinMs) : new Map()
  const missing = ids.filter(id => !metaPaths.has(id))
  for (const [id, p] of indexMetadata(missing)) metaPaths.set(id, p)
  const out = {}
  const nextCache = {}
  const nextMeta = {}

  for (const [id, metaPath] of metaPaths) {
    let meta
    try { meta = readMeta(metaPath, metaCache, nextMeta) } catch { continue }
    if (meta.isArchived && !ids.includes(id)) continue
    const rec = {
      sessionId: id,
      cliSessionId: meta.cliSessionId ?? '',
      title: meta.title ?? '',
      isArchived: !!meta.isArchived,
      link: `claude://claude.ai/epitaxy/${id}`,
      parentSessionId: meta.parentSessionId ?? null,
      model: meta.model ?? '',
      effort: meta.effort ?? '',
      scheduledTaskId: meta.scheduledTaskId ?? null,
      permissionMode: meta.permissionMode ?? '',
      createdAt: meta.createdAt ?? 0,
      latestUserFrameAt: meta.latestUserFrameAt ?? 0,
      lastActivityAt: meta.lastActivityAt ?? 0,
      transcript: null,
    }
    const file = typeof meta.cliSessionId === 'string' && CLI_ID.test(meta.cliSessionId) ? findTranscript(meta.cliSessionId, [meta.cwd, meta.originCwd]) : undefined
    if (file) {
      try {
        const st = fs.statSync(file)
        const stamp = `${st.size}:${st.mtimeMs}`
        const hit = cache[file]
        const parsed = hit?.stamp === stamp ? hit.parsed : parseTranscript(...Object.values(readTail(file)))
        nextCache[file] = { stamp, parsed }
        rec.transcript = { ...parsed, mtimeMs: st.mtimeMs }
      } catch {}
    }
    out[id] = rec
  }

  try {
    fs.mkdirSync(path.dirname(CACHE), { recursive: true })
    const tmp = `${CACHE}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ t: nextCache, m: nextMeta }), { mode: 0o600 })
    fs.renameSync(tmp, CACHE) // whole or not at all, so a reader never sees half a file
  } catch {}
  try { fs.rmSync(path.join(os.tmpdir(), 'crab-agents-scan-cache.json'), { force: true }) } catch {}
  process.stdout.write(JSON.stringify(out))
}

main()
