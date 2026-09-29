/**
 * passaudit.js — real password audit for the Vault.
 *
 * Checks are performed locally:
 *   • strength estimation (length, charset variety, common patterns)
 *   • duplicate / reused passwords and similar logins
 *   • breach check via Have I Been Pwned using k-anonymity:
 *     only the first 5 hex chars of the SHA-1 hash are sent to the API.
 *     The password itself never leaves the machine.
 */
const crypto = require('crypto')
const https = require('https')
const { getProxyConfig } = require('./proxy')
const { Socks5HttpsAgent } = require('./socks5')

const COMMON_PASSWORDS = new Set([
  '123456', 'password', '123456789', '12345678', '12345', 'qwerty',
  '1234567', '111111', '1234567890', '123123', 'abc123', '1234',
  'password1', 'iloveyou', '000000', 'qwerty123', '1q2w3e', 'aa12345678',
  '654321', '555555', 'dragon', 'qwertyuiop', 'azerty', 'monkey',
  '11111111', '123321', 'qazwsx', 'michael', 'superman', 'shadow',
  'baseball', 'soccer', 'football', 'hello', 'freedom', 'whatever',
  'trustno1', 'batman', 'passw0rd', 'test123', 'admin', 'letmein',
  'welcome', 'master', 'sunshine', 'princess', 'flower', 'hottie',
  'loveme', 'zaq12wsx', 'password123', 'admin123', 'root', 'toor',
])

function estimateStrength(pw) {
  if (!pw) return { score: 0, label: 'empty', entropyBits: 0 }
  let charset = 0
  if (/[a-z]/.test(pw)) charset += 26
  if (/[A-Z]/.test(pw)) charset += 26
  if (/[0-9]/.test(pw)) charset += 10
  if (/[^a-zA-Z0-9]/.test(pw)) charset += 33
  const entropyBits = Math.round(pw.length * Math.log2(charset || 1))

  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (pw.length >= 16) score++
  if (charset >= 60) score++
  if (charset >= 90) score++

  // Pattern penalties
  if (/^(.)\1+$/.test(pw)) score = 0                                   // aaaaaa
  if (/^[0-9]+$/.test(pw)) score = Math.min(score, 1)                  // digits only
  if (/^(0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf|zxcv)/i.test(pw)) score = Math.min(score, 1)
  if (COMMON_PASSWORDS.has(pw.toLowerCase())) score = 0
  if (pw.length < 6) score = Math.min(score, 0)

  const label = score >= 4 ? 'strong' : score === 3 ? 'good' : score === 2 ? 'fair' : 'weak'
  return { score, label, entropyBits }
}

function sha1Hex(str) {
  return crypto.createHash('sha1').update(str, 'utf8').digest('hex').toUpperCase()
}

function hibpCheck(password) {
  return new Promise((resolve) => {
    const hash = sha1Hex(password)
    const prefix = hash.slice(0, 5)
    const suffix = hash.slice(5)

    const socks = getProxyConfig()
    // Tunnel the breach check through the proxy too, so the HIBP lookup does
    // not expose the real IP.
    const agent = socks ? new Socks5HttpsAgent(socks) : null
    const options = {
      timeout: 10000,
      headers: { 'User-Agent': 'AuroraAccessBrowser-PassAudit/2.1' },
    }
    if (agent) options.agent = agent

    // One audit can run several of these in parallel; each agent is torn down
    // as soon as its own request settles instead of piling up until GC.
    const done = (result) => {
      if (agent) agent.destroy()
      resolve(result)
    }

    const req = https.get(
      `https://api.pwnedpasswords.com/range/${prefix}`,
      options,
      (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => {
          if (res.statusCode !== 200) {
            done({ ok: false, error: `HIBP API returned ${res.statusCode}` })
            return
          }
          let count = 0
          for (const line of body.split('\n')) {
            const [suf, cnt] = line.trim().split(':')
            if (suf === suffix) { count = parseInt(cnt, 10) || 0; break }
          }
          done({ ok: true, breached: count > 0, count })
        })
      }
    )
    req.on('error', (err) => done({ ok: false, error: err.message }))
    req.on('timeout', () => { req.destroy(); done({ ok: false, error: 'HIBP request timeout' }) })
  })
}

/**
 * Audit all vault logins. `logins` = [{ url, username, password }]
 * (fetched from Vault inside main process — passwords never leave it,
 * except the 5-char hash prefix sent to HIBP).
 */
async function audit(logins) {
  const entries = []
  const seenPasswords = new Map() // password -> [indices]

  logins.forEach((l, i) => {
    if (l.password) {
      if (!seenPasswords.has(l.password)) seenPasswords.set(l.password, [])
      seenPasswords.get(l.password).push(i)
    }
  })

  const reuseIdx = new Set()
  for (const indices of seenPasswords.values()) {
    if (indices.length > 1) indices.forEach(i => reuseIdx.add(i))
  }

  // HIBP checks in small parallel batches (politeness + speed balance)
  const results = new Array(logins.length)
  const BATCH = 6
  for (let start = 0; start < logins.length; start += BATCH) {
    const batch = logins.slice(start, start + BATCH).map(async (l, j) => {
      const i = start + j
      const strength = estimateStrength(l.password)
      const reused = reuseIdx.has(i)
      let breach = { ok: false, skipped: true }
      if (l.password && !reused) {
        breach = await hibpCheck(l.password)
      }
      const issues = []
      if (strength.score <= 1) issues.push('weak')
      if (reused) issues.push('reused')
      if (breach.ok && breach.breached) issues.push('breached')
      results[i] = {
        url: l.url,
        username: l.username,
        strength,
        reused,
        breach: breach.ok
          ? { checked: true, breached: breach.breached, count: breach.count }
          : { checked: false, error: breach.error, skipped: !!breach.skipped },
        issues,
      }
    })
    await Promise.all(batch)
  }

  const total = results.length
  const weak = results.filter(r => r.issues.includes('weak')).length
  const reusedCount = results.filter(r => r.reused).length
  const breached = results.filter(r => r.breach && r.breach.breached).length
  const okCount = total - results.filter(r => r.issues.length > 0).length

  let health = Math.round((okCount / Math.max(total, 1)) * 100)
  if (breached > 0) health = Math.max(0, health - 10 * breached)

  return {
    ok: true,
    auditedAt: new Date().toISOString(),
    summary: { total, ok: okCount, weak, reused: reusedCount, breached, health },
    entries: results,
  }
}

module.exports = { audit, estimateStrength }
