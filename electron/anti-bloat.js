// TZ v2.0.9 Anti-Bloat Layer: Chromium constantly re-creates diagnostic and
// cache directories inside the userData tree (GPUCache, CrashDumps, blob
// storage, network logs…). This module physically deletes them — at startup
// (trash from the previous session) and before quit (recreated during this
// run), so the app's disk footprint never grows through them.
//
// Scope: the userData root AND every Partition directory — <webview>
// sessions (persist:aurora, the YouTube RAM partition, …) keep their own
// copies of these folders, and only deleting the root would miss them.
// Everything else (Cookies, vault, history, proxy state, the per-partition
// storage/sites data) is deliberately NOT touched.
const fs = require('fs')
const path = require('path')

const TRASH_FOLDERS = [
  'Cache',
  'GPUCache',
  'CrashDumps',
  'blob_storage',
  'Network Action Predictor',
]

function purgeChromiumTrash(userDataPath, log = () => {}) {
  if (!userDataPath || !path.isAbsolute(userDataPath)) return

  let purgeRoots = []
  try {
    purgeRoots = [userDataPath]
    const partitionsDir = path.join(userDataPath, 'Partitions')
    for (const name of fs.readdirSync(partitionsDir)) {
      const dir = path.join(partitionsDir, name)
      try { if (fs.statSync(dir).isDirectory()) purgeRoots.push(dir) } catch (_) {}
    }
  } catch (_) { /* no Partitions dir yet — root only */ }

  for (const dir of purgeRoots) {
    for (const folder of TRASH_FOLDERS) {
      const targetPath = path.join(dir, folder)
      try {
        // Safety: never delete anything outside the userData tree.
        if (!targetPath.startsWith(userDataPath + path.sep)) continue
        if (fs.existsSync(targetPath)) {
          fs.rmSync(targetPath, { recursive: true, force: true })
          log(`🧹 Anti-Bloat Manager: deleted trash directory: ${path.relative(userDataPath, targetPath)}`)
        }
      } catch (e) {
        // Locked by a running process (fresh session already opened a handle)
        // — harmless, the next purge cycle will take it; never crash startup
        // or shutdown because a directory refuses to die.
      }
    }
  }
}

module.exports = { TRASH_FOLDERS, purgeChromiumTrash }
