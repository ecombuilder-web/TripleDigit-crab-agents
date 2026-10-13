// Crab Agents opener: hands the desktop app one of its own session deep links.
//
//   node open.mjs claude://claude.ai/epitaxy/local_...
//
// The OS launcher starts a short-lived second Claude instance that forwards the
// link to the running app. Started straight from the hooks runner, that hand-off
// can be cut short when the runner tears its process tree down, so this script
// starts the launcher detached, with no pipes, and waits a moment before exiting.

import { spawn } from 'node:child_process'

const link = process.argv[2] ?? ''
if (!/^claude:\/\/claude\.ai\/epitaxy\/local_[A-Za-z0-9-]{1,80}$/.test(link)) {
  process.stderr.write('not a session link')
  process.exit(2)
}

const argv =
  process.platform === 'win32'
    ? ['rundll32.exe', 'url.dll,FileProtocolHandler', link]
    : process.platform === 'darwin'
      ? ['open', link]
      : ['xdg-open', link]

const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: 'ignore', windowsHide: true })
child.on('error', err => {
  process.stderr.write(String(err))
  process.exit(1)
})
child.unref()
setTimeout(() => process.exit(0), 2500)
