/**
 * inspector.js — real security audit of any HTTPS site.
 *
 * Makes a real TLS connection (tls.connect) to fetch the actual server
 * certificate and measures the TLS handshake time, then fetches the
 * page over HTTPS and reads the real security response headers.
 * Grades the site A–F like a mini Mozilla Observatory.
 *
 * No simulation: certificate comes from the live TLS handshake.
 */
const tls = require('tls')
const https = require('https')
const { URL } = require('url')

function checkTls(host, port = 443, timeout = 8000) {
  return new Promise((resolve) => {
    const started = Date.now()
    let settled = false
    const done = (result) => {
      if (settled) return
      settled = true
      try { socket.destroy() } catch (_) {}
      resolve(result)
    }

    const socket = tls.connect(
      { host, port, servername: host, rejectUnauthorized: false, timeout },
      () => {
        const cipher = socket.getCipher()
        const cert = socket.getPeerCertificate(true)
        const proto = socket.getProtocol()
        done({
          ok: true,
          protocol: proto,
          cipher: cipher ? `${cipher.name} (${cipher.version})` : null,
          handshakeMs: Date.now() - started,
          cert: cert && cert.subject ? {
            subjectCN: cert.subject.CN || '',
            issuerCN: (cert.issuer && cert.issuer.CN) || '',
            issuerO: (cert.issuer && cert.issuer.O) || '',
            validFrom: cert.valid_from,
            validTo: cert.valid_to,
            daysRemaining: Math.floor((new Date(cert.valid_to) - Date.now()) / 86400000),
            bits: cert.bits || null,
            serial: cert.serialNumber || '',
            fingerprint256: cert.fingerprint256 || '',
            altNames: (cert.subjectaltname || '')
              .split(',').map(s => s.trim()).filter(s => s.startsWith('DNS:')).map(s => s.slice(4)).slice(0, 12),
          } : null,
        })
      }
    )

    socket.on('error', (err) => done({ ok: false, error: err.message }))
    socket.setTimeout(timeout, () => done({ ok: false, error: 'TLS handshake timeout' }))
  })
}

function fetchHeaders(urlStr, timeout = 8000) {
  return new Promise((resolve) => {
    const req = https.get(urlStr, { timeout, headers: { 'User-Agent': 'AuroraAccessBrowser-Inspector/2.1' } }, (res) => {
      const headers = {}
      for (const [k, v] of Object.entries(res.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v
      res.destroy()
      resolve({
        ok: true,
        statusCode: res.statusCode,
        headers,
        hops: res.req && res.req._redirectable ? undefined : undefined,
      })
    })
    req.on('error', (err) => resolve({ ok: false, error: err.message }))
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Request timeout' }) })
  })
}

// ─── Header grading (Observatory-style) ───────────────────────────
const HEADER_CHECKS = [
  { key: 'content-security-policy',      weight: 25, good: 'present', fail: 'missing' },
  { key: 'strict-transport-security',    weight: 25, good: 'present', fail: 'missing' },
  { key: 'x-content-type-options',       weight: 10, good: 'nosniff', fail: 'missing' },
  { key: 'x-frame-options',              weight: 10, good: 'present', fail: 'missing' },
  { key: 'referrer-policy',              weight: 10, good: 'present', fail: 'missing' },
  { key: 'permissions-policy',           weight: 5,  good: 'present', fail: 'missing' },
  { key: 'cross-origin-opener-policy',   weight: 5,  good: 'present', fail: 'missing' },
  { key: 'set-cookie',                   weight: 5,  good: 'secure-cookies', fail: 'insecure', optional: true },
  { key: 'server',                       weight: 5,  good: 'no-banner', fail: 'banner', optional: true },
]

function gradeHeaders(headers) {
  let score = 100
  const findings = []

  for (const check of HEADER_CHECKS) {
    const raw = headers[check.key]
    const value = (raw || '').trim()
    let status

    if (check.key === 'set-cookie') {
      status = value && !/httponly/i.test(value) ? 'insecure' : 'secure-cookies'
      if (check.optional && (status === 'secure-cookies' || !value)) continue
    } else if (check.key === 'server') {
      // A detailed Server banner is information leakage (weak signal).
      status = value && value.length > 0 && !/^cloudflare$|^litespeed$/i.test(value) ? 'banner' : 'no-banner'
      if (check.optional) continue
    } else {
      status = value ? 'present' : 'missing'
    }

    if (status === check.fail) {
      score -= check.weight
      findings.push({ header: check.key, status, weight: check.weight, value: value.slice(0, 120) || null })
    } else if (value) {
      findings.push({ header: check.key, status: 'ok', weight: check.weight, value: value.slice(0, 120) })
    }
  }

  score = Math.max(0, Math.min(100, score))
  const grade =
    score >= 90 ? 'A' :
    score >= 75 ? 'B' :
    score >= 60 ? 'C' :
    score >= 40 ? 'D' : 'F'

  return { score, grade, findings }
}

async function inspect(targetUrl) {
  let url
  try {
    url = new URL(targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`)
  } catch {
    return { ok: false, error: 'Invalid URL' }
  }
  if (url.protocol !== 'https:') {
    return { ok: false, error: 'Only https:// sites can be inspected (Strict HTTPS mode)' }
  }
  const host = url.hostname

  const [tlsInfo, headerInfo] = await Promise.all([
    checkTls(host, 443),
    fetchHeaders(url.toString()),
  ])

  if (!tlsInfo.ok) {
    return { ok: false, error: `TLS connection failed: ${tlsInfo.error}` }
  }

  const headers = headerInfo.ok ? headerInfo.headers : {}
  const grade = gradeHeaders(headers)

  // Simple heuristic warnings
  const warnings = []
  if (headers['strict-transport-security'] && !/max-age=(\d{7,})/i.test(headers['strict-transport-security'])) {
    warnings.push('HSTS max-age is suspiciously short')
  }
  if (headers['content-security-policy'] && /unsafe-inline/i.test(headers['content-security-policy'])) {
    warnings.push("CSP contains 'unsafe-inline' — weakens XSS protection")
  }
  if (tlsInfo.cert && tlsInfo.cert.daysRemaining < 14 && tlsInfo.cert.daysRemaining >= 0) {
    warnings.push(`Certificate expires in ${tlsInfo.cert.daysRemaining} days`)
  }

  return {
    ok: true,
    url: url.toString(),
    host,
    inspectedAt: new Date().toISOString(),
    tls: {
      protocol: tlsInfo.protocol,
      cipher: tlsInfo.cipher,
      handshakeMs: tlsInfo.handshakeMs,
      cert: tlsInfo.cert,
    },
    http: {
      statusCode: headerInfo.ok ? headerInfo.statusCode : null,
      server: headers['server'] || null,
      poweredBy: headers['x-powered-by'] || null,
    },
    security: grade,
    warnings,
  }
}

module.exports = { inspect }
