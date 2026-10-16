/**
 * ipc-guard.js — TZ security audit rule #2: the renderer process is treated
 * as PERPETUALLY COMPROMISED. Every argument crossing the IPC bridge is
 * validated here (type, length, structure) in the MAIN process before any
 * handler logic runs. Validation failures are logged once per call — the
 * main process always answers in its own stable shape (ok:false / error).
 */

const IPC_MAX_STR = 4096

class IpcValidationError extends Error {}

/** Strict string: must be a string, within length bounds; strips nothing —
 *  caller decides what to do with content. Length caps blunt buffer-bombing
 *  and regex-bombing vectors from a hostile renderer. */
function vStr(val, { field = 'arg', max = IPC_MAX_STR } = {}) {
  if (typeof val !== 'string') throw new IpcValidationError(`${field}: expected string`)
  if (val.length > max) throw new IpcValidationError(`${field}: string too long (>${max})`)
  return val
}

/** Strict non-empty string (vault logins etc.). */
function vNonEmpty(val, opts) {
  const s = vStr(val, opts)
  if (!s.trim()) throw new IpcValidationError(`${opts.field}: empty`)
  return s
}

/** Web URL for navigation/fetch targets: absolute http(s) only — file:, smb:,
 *  custom schemes and system URLs are rejected here, at the trust boundary. */
function vWebUrl(val, { field = 'url' } = {}) {
  const s = vStr(val, { field, max: 2048 })
  let u
  try { u = new URL(s) } catch (_) { throw new IpcValidationError(`${field}: not a valid URL`) }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new IpcValidationError(`${field}: scheme not allowed (${u.protocol})`)
  }
  if (!u.hostname) throw new IpcValidationError(`${field}: empty host`)
  return s
}

/** Safe integer or integer-like string with bounds. */
function vInt(val, { field = 'arg', min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = typeof val === 'number' ? val : Number.parseInt(String(val ?? ''), 10)
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new IpcValidationError(`${field}: expected integer ${min}..${max}`)
  }
  return n
}

/** Proxy endpoint config from the renderer: host (no paths), port, optional creds,
 *  Rejects anything that is not exactly the documented shape — extra fields
 *  are ignored, missing required ones reject. */
function vProxyConfig(config, { field = 'config' } = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new IpcValidationError(`${field}: expected object`)
  }
  const host = vStr(config.host, { field: `${field}.host`, max: 253 })
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host)) {
    throw new IpcValidationError(`${field}.host: invalid hostname`)
  }
  const port = vInt(config.port, { field: `${field}.port`, min: 1, max: 65535 })
  const out = { host, port }
  if (config.username != null) out.username = vStr(config.username, { field: `${field}.username`, max: 256 })
  if (config.password != null) out.password = vStr(config.password, { field: `${field}.password`, max: 256 })
  if (config.protocol != null) {
    const proto = vStr(config.protocol, { field: `${field}.protocol`, max: 8 }).toLowerCase()
    if (proto !== 'socks5' && proto !== 'http') throw new IpcValidationError(`${field}.protocol: unsupported`)
    out.protocol = proto
  }
  // The UI sends 'enabled' and Chromium-style bypassRules with every set —
  // dropping them here would silently flip a fresh proxy ON→OFF and lose
  // the bypass list. Both pass through strict validation instead.
  if (config.enabled != null) {
    if (typeof config.enabled !== 'boolean') {
      throw new IpcValidationError(`${field}.enabled: expected boolean`)
    }
    out.enabled = config.enabled
  }
  if (config.bypassRules != null) {
    // TZ v2.0.9 fix #1: recent Chromium builds refuse bypass rule lists
    // containing spaces AND split the list on commas is no longer honoured
    // the way the UI formats it — the canonical separator is now ';'.
    // Sanitize FIRST (strip all whitespace, commas ➜ semicolons) and only
    // then validate, so a harmless "localhost, 127.0.0.1" never trips the
    // guard with 'invalid characters' before it can even reach setProxy().
    const rules = (typeof config.bypassRules === 'string')
      ? config.bypassRules.replace(/\s+/g, '').replace(/,/g, ';')
      : config.bypassRules
    const checked = vStr(rules, { field: `${field}.bypassRules`, max: 1024 })
    // Conservative charset: hosts, ports, wildcards, CIDR masks and pattern tokens like
    // '<local>' — ';' is the legal list separator. An empty string is valid (no bypass).
    if (checked !== '' && !/^[A-Za-z0-9.;:[\]<>*?!~|~/-]+$/.test(checked)) {
      throw new IpcValidationError(`${field}.bypassRules: invalid characters`)
    }
    out.bypassRules = checked
  }
  return out
}

/** Wrap an ipcMain.handle callback with validation; failures answer the
 *  caller in the codebase-wide { ok:false, error } shape. */
function guardValidate(fn) {
  return async (...args) => {
    try {
      return await fn(...args)
    } catch (e) {
      if (e instanceof IpcValidationError) {
        console.warn(`[IPC-Guard] rejected: ${e.message}`)
        return { ok: false, error: e.message }
      }
      throw e
    }
  }
}

module.exports = { vStr, vNonEmpty, vWebUrl, vInt, vProxyConfig, IpcValidationError, guardValidate }
