import { useState, useEffect, useCallback } from 'react'

/**
 * Hook for interacting with the RCF device over IPC.
 * Falls back to mock data when running in plain browser (dev mode).
 */
export function useRCF() {
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.isElectron;
  const [status, setStatus] = useState(null)
  const [devices, setDevices] = useState([])
  const [connected, setConnected] = useState(null)
  const [loading, setLoading] = useState(false)
  const [flashProgress, setFlashProgress] = useState(0)
  const [logs, setLogs] = useState([])
  const [error, setError] = useState(null)

  const fetchStatus = useCallback(async () => {
    try {
      if (isElectron) {
        const s = await window.electronAPI.rcf.status()
        setStatus(s)
        setLogs(s.logs || [])
        setConnected(s.connectedDevice)
      } else {
        // Browser dev mock
        setStatus({ state: 'DISCONNECTED', connectedDevice: null, flashProgress: 0, uptimeSeconds: Math.floor(performance.now() / 1000) })
      }
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 3000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  const scan = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (isElectron) {
        const result = await window.electronAPI.rcf.scan()
        setDevices(result)
        return result
      } else {
        const mock = [
          { id: 'rcf-001', name: 'RCF Node Alpha', mcu: 'STM32F446RE', port: '/dev/mock001', fw: 'v3.2.1', status: 'IDLE' },
          { id: 'rcf-002', name: 'RCF Node Beta',  mcu: 'STM32F103C8', port: '/dev/mock002', fw: 'v3.1.4', status: 'IDLE' },
        ]
        setDevices(mock)
        return mock
      }
    } catch (e) {
      setError(e.message)
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  const connect = useCallback(async (deviceId) => {
    setLoading(true)
    setError(null)
    try {
      if (isElectron) {
        const result = await window.electronAPI.rcf.connect(deviceId)
        if (result.ok) {
          setConnected(result.device)
          await fetchStatus()
        }
        return result
      } else {
        const dev = devices.find(d => d.id === deviceId)
        setConnected(dev || { id: deviceId })
        return { ok: true, device: dev }
      }
    } catch (e) {
      setError(e.message)
      return { ok: false, error: e.message }
    } finally {
      setLoading(false)
    }
  }, [devices, fetchStatus])

  const disconnect = useCallback(async () => {
    setLoading(true)
    try {
      if (isElectron) await window.electronAPI.rcf.disconnect()
      setConnected(null)
      await fetchStatus()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [fetchStatus])

  const readRegister = useCallback(async (addr) => {
    try {
      if (isElectron) return await window.electronAPI.rcf.readRCF(addr)
      return { ok: true, register: addr, name: 'MOCK_REG', value: 0xDEADBEEF, hex: '0xDEADBEEF', desc: 'Mock register' }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }, [])

  const flash = useCallback(async (firmwarePayload) => {
    if (!connected) return { ok: false, error: 'No device connected' }
    setFlashProgress(1)
    try {
      // poll progress from status while flashing
      const progressInterval = setInterval(async () => {
        const s = isElectron ? await window.electronAPI.rcf.status() : null
        if (s) setFlashProgress(s.flashProgress || 0)
      }, 400)

      const result = isElectron
        ? await window.electronAPI.rcf.flash(firmwarePayload)
        : await new Promise(r => setTimeout(() => r({ ok: true, crc: '0xMOCK1234', duration_ms: 3000 }), 3000))

      clearInterval(progressInterval)
      setFlashProgress(0)
      await fetchStatus()
      return result
    } catch (e) {
      setFlashProgress(0)
      return { ok: false, error: e.message }
    }
  }, [connected, fetchStatus])

  return { status, devices, connected, loading, flashProgress, logs, error, scan, connect, disconnect, readRegister, flash }
}
