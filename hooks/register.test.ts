import { describe, expect, mock, test } from 'claude-code/testing'

import { HATS, barSvg, crabSvg } from './crab'
import { asStoredLimits, assignHats, browserShown, classify, pickLimits, effortStyle, endsWithQuestion, prettyModel, safeLink, until } from './register'

declare const setTimeout: (fn: (v?: unknown) => void, ms: number) => unknown

const NOW = Date.parse('2026-10-11T12:00:00Z')
const scan = (over: Record<string, unknown> = {}, t: Record<string, unknown> | null = {}) =>
  ({
    model: 'claude-opus-5-5',
    effort: 'high',
    scheduledTaskId: null,
    permissionMode: 'auto',
    latestUserFrameAt: NOW - 60_000,
    lastActivityAt: NOW - 30_000,
    transcript: t && {
      progress: null,
      question: null,
      plan: false,
      pendingTool: null,
      lastAssistantText: 'Done. All four files are updated.',
      lastRole: 'assistant',
      lastUserAt: NOW - 60_000,
      ctxTokens: 50_000,
      model: 'claude-opus-5-5',
      mtimeMs: NOW,
      ...t,
    },
    ...over,
  }) as never

describe('classify', () => {
  test('running session is working', async () => {
    expect(classify({ isRunning: true, lastActivityAt: NOW }, scan(), NOW)?.state).toBe('working')
  })
  test('pending AskUserQuestion needs you, running or not', async () => {
    const s = scan({}, { question: 'Which folder?' })
    expect(classify({ isRunning: true, lastActivityAt: NOW }, s, NOW)).toEqual({ state: 'attention', attention: 'Question: Which folder?' })
    expect(classify({ isRunning: false, lastActivityAt: NOW }, s, NOW)?.state).toBe('attention')
  })
  test('idle reply that ends on a question needs you', async () => {
    const s = scan({}, { lastAssistantText: 'Updated both.\n\nShould I start the next one?' })
    expect(classify({ isRunning: false, lastActivityAt: NOW - 1000 }, s, NOW)?.attention).toBe('Waiting on your reply')
  })
  test('a slow tool in a mode that asks first is an approval wait; in auto it is not', async () => {
    const pending = { pendingTool: { name: 'Bash', at: NOW - 60_000 }, lastRole: 'tool' }
    expect(classify({ isRunning: true, lastActivityAt: NOW }, scan({ permissionMode: 'default' }, pending), NOW)?.state).toBe('attention')
    expect(classify({ isRunning: true, lastActivityAt: NOW }, scan({ permissionMode: 'auto' }, pending), NOW)?.state).toBe('working')
  })
  test('idle session is finished, and gone after 24h', async () => {
    expect(classify({ isRunning: false, lastActivityAt: NOW - 3_600_000 }, scan(), NOW)?.state).toBe('finished')
    expect(classify({ isRunning: false, lastActivityAt: NOW - 25 * 3_600_000 }, scan(), NOW)).toBe(null)
  })
})

describe('hats', () => {
  test('every visible crab wears a different hat and keeps it', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `s${i}`)
    const first = assignHats(ids, {})
    expect(new Set(Object.values(first)).size).toBe(12)
    const again = assignHats(['new', ...ids], first)
    for (const id of ids) expect(again[id]).toBe(first[id])
    expect(new Set(Object.values(again)).size).toBe(13)
  })
  test('a clash in stored hats is resolved', async () => {
    const out = assignHats(['a', 'b'], { a: 3, b: 3 })
    expect(out.a).not.toBe(out.b)
  })
  test('there are twenty hats and each draws', async () => {
    expect(HATS.length).toBe(20)
    for (let i = 0; i < HATS.length; i++) expect(crabSvg(i, i % 2 === 0)).toMatch(/^<svg[\s\S]*<\/svg>$/)
    expect(barSvg(200, '#fff', 0.5)).toContain('width="100"')
  })
  test('nothing moves while working; only a crab or bar that needs you blinks', async () => {
    expect(crabSvg(3, false)).not.toContain('<animate')
    expect(barSvg(200, '#fff', 1)).not.toContain('<animate')
    expect(crabSvg(3, true)).toContain('attributeName="opacity"')
    expect(barSvg(200, '#f00', 1, true)).toContain('attributeName="opacity"')
  })
})

describe('labels', () => {
  test('model, effort and countdown read as in the screenshot', async () => {
    expect(prettyModel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(prettyModel('claude-opus-5-5[1m]')).toBe('Opus 5.5 1M')
    expect(effortStyle('xhigh').word).toBe('heavy')
    expect(effortStyle('low').word).toBe('light')
    expect(effortStyle('high').word).toBe('careful')
    expect(until(4 * 3_600_000 + 28 * 60_000)).toBe('4h 28m')
    expect(until(51 * 3_600_000)).toBe('2d 3h')
    expect(endsWithQuestion('All done.')).toBe(false)
  })
})

describe('pane', () => {
  for (const surface of ['desktop', 'terminal'] as const) {
    test(`draws the limit cards and sections on ${surface}`, async ($, on) => {
      mock.clock(on, { now: NOW })
      mock.store(on)
      const ui = await $.ui.mount({
        plugin: 'crab-agents',
        surface,
        component: 'Pane',
        requestId: 'crab-agents',
        props: { title: 'Agents', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { top: 0, bodyRows: 40 }, view: {} } as never,
      })
      expect(await ui.find({ text: /Session limit/ })).toBeDefined()
      expect(await ui.find({ text: /Weekly limit/ })).toBeDefined()
      expect(await ui.find({ text: /WORKING · 0/ })).toBeDefined()
      expect(await ui.find({ key: 'toggle-completed' })).toBeDefined()
      expect(await ui.find({ text: /COMPLETED · 0/ })).toBeDefined()
      await ui.unmount()
    })
  }
})

describe('live pane', () => {
  const T = Date.parse('2026-10-11T12:00:00Z')
  const rec = (id: string, title: string, t: Record<string, unknown>) => ({
    sessionId: id, cliSessionId: `cli-${id}`, title, isArchived: false, link: `claude://claude.ai/epitaxy/${id}`,
    parentSessionId: null, model: 'claude-opus-5-5', effort: 'xhigh', scheduledTaskId: null, permissionMode: 'auto',
    latestUserFrameAt: T - 20_000, lastActivityAt: T - 5_000,
    transcript: { turnOpen: true, progress: { done: 2, total: 3 }, question: null, plan: false, pendingTool: null,
      lastAssistantText: '', lastRole: 'tool', lastUserAt: T - 20_000, ctxTokens: 31_000, model: 'claude-opus-5-5', mtimeMs: T - 1000, ...t },
  })
  const SCANS = {
    local_a: rec('local_a', 'Review the whole kit', {}),
    local_b: rec('local_b', 'Build the landing page', { question: 'Which colour?' }),
    local_r: { ...rec('local_r', 'Hourly routine', {}), scheduledTaskId: 'hourly' },
    local_f: rec('local_f', 'Old finished job', { turnOpen: false, lastRole: 'assistant', lastAssistantText: 'All done.', progress: null }),
  }

  test('rows, and a click on the crab opens that session', async ($, on) => {
    mock.clock(on, { now: T })
    mock.store(on)
    mock.env(on, { OS: 'Windows_NT' })
    const ran: string[][] = []
    on('mcp.call', async () => ({ value: { content: [], isError: true } }) as never)
    on('session.id', async () => ({ value: 'cli-self' }) as never)
    on('ui.log', async () => ({ value: undefined }) as never)
    on('ui.toast', async () => ({ value: undefined }) as never)
    on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
    on('ui.panes', async () => ({ value: [] }) as never)
    on('process.run', async (_$, e) => {
      ran.push([...e.argv])
      return { value: { exitCode: 0, stdout: e.argv[0] === 'node' ? JSON.stringify(SCANS) : '', stderr: '' } } as never
    })
    await $.command.run({ command: 'crabs', args: '' } as never)
    const ui = await $.ui.mount({
      plugin: 'crab-agents', surface: 'desktop', component: 'Pane', requestId: 'crab-agents',
      props: { title: 'Agents', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { top: 0, bodyRows: 60 }, view: {} } as never,
    })
    for (let i = 0; i < 100 && !(await ui.find({ text: /Review the whole kit/ })); i++) await new Promise(r => setTimeout(r, 10))
    expect(await ui.find({ text: /Review the whole kit/ })).toBeDefined()
    expect(await ui.find({ text: /Hourly routine/ })).toBeUndefined()
    expect(await ui.find({ text: /NEEDS YOU · 1/ })).toBeDefined()
    expect(await ui.find({ text: /2\/3/ })).toBeDefined()
    expect(await ui.find({ text: /heavy/ })).toBeDefined()
    expect(await ui.find({ key: 'click-local_a' })).toBeDefined()
    // COMPLETED starts folded; a click on its header shows the finished sessions, titles included.
    expect(await ui.find({ text: /COMPLETED · 1/ })).toBeDefined()
    expect(await ui.find({ text: /Old finished job/ })).toBeUndefined()
    await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'toggle-completed' })
    await ui.pointer({ type: 'up', x: 1, y: 0, button: 'left', in: 'toggle-completed' })
    for (let i = 0; i < 50 && !(await ui.find({ text: /Old finished job/ })); i++) await new Promise(r => setTimeout(r, 10))
    expect(await ui.find({ text: /Old finished job/ })).toBeDefined()
    await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'click-local_a' })
    await ui.pointer({ type: 'up', x: 1, y: 0, button: 'left', in: 'click-local_a' })
    for (let i = 0; i < 50 && !ran.some(a => a[0] === 'rundll32.exe'); i++) await new Promise(r => setTimeout(r, 10))
    expect(ran.find(a => a[0] === 'rundll32.exe')).toEqual(['rundll32.exe', 'url.dll,FileProtocolHandler', 'claude://claude.ai/epitaxy/local_a'])
    await ui.unmount()
  })
})

describe('background', () => {
  test('starts on the app theme and the switch cycles Light, Dark, then back', async ($, on) => {
    mock.clock(on, { now: Date.parse('2026-10-11T12:00:00Z') })
    mock.store(on)
    const ui = await $.ui.mount({
      plugin: 'crab-agents', surface: 'desktop', component: 'Pane', requestId: 'crab-agents',
      props: { title: 'Agents', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { top: 0, bodyRows: 60 }, view: {} } as never,
    })
    const label = async (want: RegExp) => {
      for (let i = 0; i < 50 && !(await ui.find({ text: want })); i++) await new Promise(r => setTimeout(r, 10))
      return ui.find({ text: want })
    }
    expect(await label(/Auto/)).toBeDefined()
    for (const want of [/Light/, /Dark/, /Auto/]) {
      await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'toggle-theme' })
      await ui.pointer({ type: 'up', x: 1, y: 0, button: 'left', in: 'toggle-theme' })
      expect(await label(want)).toBeDefined()
    }
    await ui.unmount()
  })
})

describe('pane visibility and safety', () => {
  const answer = (open: boolean, line: string) => `${JSON.stringify({ browserOpen: open, tabs: [] }, null, 2)}\n${line}`
  test('the browser counts only while it is open and on screen', async () => {
    expect(browserShown(answer(true, 'The Browser pane is currently displayed.'))).toBe(true)
    expect(browserShown(answer(true, 'The Browser pane is currently hidden.'))).toBe(false)
    expect(browserShown(answer(false, ''))).toBe(false)
  })
  test('only a checked session id becomes a link for the OS', async () => {
    expect(safeLink('local_00000000-0000-4000-8000-000000000000')).toBe('claude://claude.ai/epitaxy/local_00000000-0000-4000-8000-000000000000')
    expect(safeLink('C:/Windows/System32/calc.exe')).toBe(null)
    expect(safeLink('local_../../x')).toBe(null)
    expect(safeLink('local_a" & calc')).toBe(null)
  })
})

describe('plan limits', () => {
  const N = Date.parse('2026-10-12T02:00:00Z')
  const card = [{ label: '5-hour limit', percentUsed: 38, resetsAt: '2026-10-12T05:10:00Z' }, { label: 'Weekly · all models', percentUsed: 58, resetsAt: '2026-10-13T13:00:00Z' }]
  const stale = [{ label: '5-hour limit', percentUsed: 1, resetsAt: '2026-10-12T05:10:00Z' }, { label: 'Weekly · all models', percentUsed: 52, resetsAt: '2026-10-13T13:00:00Z' }]
  test('the app usage card wins', async () => {
    expect(pickLimits(card, { limits: [], readAt: 0 }, stale, N)).toEqual({ limits: card, readAt: N, source: 'app' })
  })
  test('when the card does not answer, its last reading is kept over a session reading', async () => {
    const out = pickLimits(null, { limits: card, readAt: N - 60_000 }, stale, N)
    expect(out.source).toBe('kept')
    expect(out.limits[0]?.percentUsed).toBe(38)
    expect(out.readAt).toBe(N - 60_000)
  })
  test('a kept window that has reset drops out; a session reading is the last resort', async () => {
    const later = Date.parse('2026-10-12T06:00:00Z')
    expect(pickLimits(null, { limits: card, readAt: N }, [], later).limits.map(l => l.label)).toEqual(['Weekly · all models'])
    expect(pickLimits(null, { limits: [], readAt: 0 }, stale, N).source).toBe('session')
  })
  test('an older bare list is still read', async () => {
    expect(asStoredLimits(card)).toEqual({ limits: card, readAt: 0 })
    expect(asStoredLimits(undefined)).toEqual({ limits: [], readAt: 0 })
  })
})
