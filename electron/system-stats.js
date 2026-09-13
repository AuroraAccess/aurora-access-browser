/**
 * system-stats.js — real machine telemetry via Node os module.
 * Everything is measured, nothing simulated.
 */
const os = require('os')
const { app } = require('electron')

// CPU usage needs two samples of os.cpus() times to compute deltas.
let prevCpus = os.cpus()
let prevSampleAt = Date.now()

function sampleCpu() {
  const now = Date.now()
  const cpus = os.cpus()
  const dt = (now - prevSampleAt) || 1
  let idleDelta = 0
  let totalDelta = 0
  cpus.forEach((cpu, i) => {
    const p = prevCpus[i] || cpu
    const idle = cpu.times.idle - p.times.idle
    const total =
      cpu.times.user - p.times.user +
      cpu.times.nice - p.times.nice +
      cpu.times.sys - p.times.sys +
      cpu.times.idle - p.times.idle +
      cpu.times.irq - p.times.irq
    idleDelta += idle
    totalDelta += total
  })
  prevCpus = cpus
  prevSampleAt = now
  const usage = totalDelta > 0 ? Math.round((1 - idleDelta / totalDelta) * 100) : 0
  return Math.max(0, Math.min(100, usage))
}

function getStats() {
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedMem = totalMem - freeMem
  const cpus = os.cpus()

  const nets = os.networkInterfaces()
  const interfaces = []
  for (const [name, addrs] of Object.entries(nets)) {
    if (name === 'lo') continue
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) {
        interfaces.push({ name, address: a.address, mac: a.mac })
      }
    }
  }

  const procMem = process.getProcessMemoryInfo ? process.getProcessMemoryInfo() : null

  return {
    platform: process.platform,
    arch: process.arch,
    osType: os.type(),
    osRelease: os.release(),
    hostname: os.hostname(),
    uptimeSec: Math.floor(os.uptime()),
    processUptimeSec: Math.floor(process.uptime()),
    cpu: {
      model: cpus[0] ? cpus[0].model.trim() : 'Unknown',
      cores: cpus.length,
      speedMhz: cpus[0] ? cpus[0].speed : 0,
      loadPercent: sampleCpu(),
      loadAvg: os.loadavg(),
    },
    memory: {
      totalBytes: totalMem,
      freeBytes: freeMem,
      usedBytes: usedMem,
      usedPercent: Math.round((usedMem / totalMem) * 100),
      appBytes: procMem ? (procMem.private || 0) : process.memoryUsage().rss,
    },
    network: {
      interfaces,
      proxy: app.getSystemProxy ? app.getSystemProxy('https://example.com') : null,
    },
    processInfo: {
      pid: process.pid,
      nodeVersion: process.versions.node,
      chromeVersion: process.versions.chrome,
      electronVersion: process.versions.electron,
    },
  }
}

module.exports = { getStats }
