<div align="center">

# 🦀 Crab Agents

**See every Claude Code session at a glance. Jump straight to the ones waiting on you.**

A free Claude Code mod by **[Triple Digit](https://triple-digit.com)**, the AI agency that builds tailored AI solutions for each company.

[**Work with Triple Digit →**](https://triple-digit.com) &nbsp;·&nbsp; [Install](#install) &nbsp;·&nbsp; [How it works](#how-it-works)

</div>

---

## Built by Triple Digit

We built Crab Agents because we run many Claude Code agents side by side every day, building AI systems for our clients. Watching all of them at once, and seeing straight away which one needs a human, made our own work faster. So we are sharing it.

**Triple Digit is an AI agency.** We don't sell one product to everyone. We look at how *your* company actually works, then design and build the AI that fits it:

- 🤖 **Custom AI agents** that handle real work in your business: support, research, operations, reporting.
- ⚙️ **Workflow automation** across the tools your team already uses: email, CRM, docs, spreadsheets, internal systems.
- 🧠 **Agentic coding setups** like this one: Claude Code, MCP servers, mods and skills tuned to your codebase and team.
- 🌐 **AI-powered websites and internal tools**, designed, built, shipped and maintained.

If your team is wondering where AI could save hours every week, that is the conversation we like to have.

👉 **[Book a call at triple-digit.com](https://triple-digit.com)**

---

## What it shows

Crab Agents adds an **Agents** pane on the right of every Claude Code session. Each of your desktop sessions shows up as a pixel crab wearing its own hat, so while you work in one session you can see what all the others are doing.

- **Header:** a one-line summary, how many sessions are running (and how many need you), the time until the **5-hour session limit** resets and the time until the **weekly limit** resets, each with % used. Costs are never shown.
- **Needs you** (red, at the top): sessions with a pending `AskUserQuestion`, a plan waiting for approval, a tool call waiting for permission (in modes that ask first), or a reply whose last paragraph asks you something. **Open** jumps to the session; **Dismiss** hides the flag until that session does something new.
- **Working:** running sessions. Each card shows the title, effort (light / medium / careful / heavy) with the model, the checklist count (`3/5 tasks`) when the session keeps a todo or task list (otherwise a still, faded full bar), context % and tokens, and how long the current turn has run.
- **Completed · last 24h:** idle sessions, folded by default; click the bar to show them. Each one leaves the pane 24 hours after its last activity, but stays in the sidebar.
- **Click anywhere on a card** to open that session, the same as clicking it in the left sidebar.
- **Theme** follows the Claude app's light or dark setting by default. The small switch at the top right cycles ◐ Auto → ☀ Light → ☾ Dark (Claude desktop's ivory and charcoal surfaces), and the choice is remembered. Nothing moves while sessions work; only a crab and bar that need you blink.

Routines and scheduled runs, archived sessions, and sessions started by another session are left out.

### When the pane shows

- It opens by itself in every session.
- **Built-in browser:** while the app's built-in browser is open and on screen, the Agents pane steps aside. Once the browser closes or goes out of view, the pane comes back within about 2 seconds.
- **Closed by you:** close the pane with its × and it stays closed for the rest of that session. New sessions show it again. Type `/crabs` to bring it back sooner.

## Install

You need Claude Code **2.1.295 or newer** and `node` on your PATH.

**Option A: install it as a plugin** (recommended). In a Claude Code session:

```
/plugin install crab-agents --marketplace ecombuilder-web/TripleDigit-crab-agents
```

Choose the **user** scope so it loads in every new session, desktop app sessions included. To update later, run `claude plugin update crab-agents`, then `/reload-plugins`.

**Option B: run it from a clone.** Edits apply on `/reload-plugins`.

```bash
git clone https://github.com/ecombuilder-web/TripleDigit-crab-agents.git ~/.claude/mods/crab-agents
```

Then add the folder to the `env` block of `~/.claude/settings.json`. Separate folders with `;` on Windows and `:` on macOS/Linux:

```json
"env": { "CLAUDE_CODE_PLUGIN_DIRS": "C:\\Users\\<you>\\.claude\\mods\\crab-agents" }
```

**Option C: let Claude do it.** Give Claude Code [`INSTALL-WITH-CLAUDE.md`](INSTALL-WITH-CLAUDE.md) and it installs and verifies the mod for you.

Either way, the pane opens by itself in every **new** session. A session started before the install needs a restart.

## How it works

| Piece | Role |
| --- | --- |
| `hooks/register.tsx` | The hooks module: opens the pane, polls every 8 s, draws the pane, hides it for the browser, and registers `/crabs` |
| `hooks/click.ts` | Client surface module: an invisible layer over each card that posts the session id on click |
| `hooks/crab.ts` | SVG pixel crab with 20 hats, plus the progress bar |
| `bin/scan.mjs` | Node script, run by the mod: reads the desktop app's session metadata (`%APPDATA%\Claude\claude-code-sessions`) and the tail of each transcript (`~/.claude/projects`) for the model, effort, checklist, pending questions and context tokens |
| `types/index.d.ts` | State contract |

When the desktop app's session tools (`ccd_session_mgmt`) are reachable, they supply the exact running state, context % and plan limits. Without them, the mod falls back to the files on disk.

### Privacy and safety

- **Everything stays on your machine.** The mod reads local files and the app's local tools only. It makes no network requests and sends nothing anywhere.
- The scanner is read-only, except for one parse cache at `~/.claude/cache/crab-agents-scan.json`.
- Opening a session hands the OS only the app's own `claude://` deep link, rebuilt from a checked session id. No other path or link is ever opened.

## Develop

```bash
claude plugin validate ~/.claude/mods/crab-agents
claude plugin test ~/.claude/mods/crab-agents
```

Poll details are written to the debug log (`claude --debug`), on lines starting `crab-agents:`.

---

<div align="center">

### Want AI built around how your company works?

**[Triple Digit](https://triple-digit.com)** designs and builds tailored AI agents, automations and tools for each client.

[**triple-digit.com →**](https://triple-digit.com)

<sub>Crab Agents is an independent community mod. It is not made or endorsed by Anthropic. Claude and Claude Code are trademarks of Anthropic.</sub>

</div>
