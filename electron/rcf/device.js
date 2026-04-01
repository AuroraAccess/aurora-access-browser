/**
 * RCF Device Manager
 * Simulates STM32-based hardware running EHA protocol.
 * In production, replace mock methods with real SerialPort / USB HID communication.
 */

const RCF_REGISTERS = {
  '0x00': { name: 'DEVICE_ID',    value: 0x5A4F_0001, desc: 'Unique device identifier' },
  '0x01': { name: 'FW_VERSION',   value: 0x0102_0009, desc: 'Firmware version (v1.2.9)' },
  '0x02': { name: 'STATUS',       value: 0x0000_0001, desc: '1=IDLE, 2=BUSY, 3=ERROR' },
  '0x03': { name: 'CRC32',        value: 0xA4F2_B1D3, desc: 'Firmware CRC-32' },
  '0x04': { name: 'CLOCK_MHZ',    value: 180,          desc: 'CPU clock in MHz' },
  '0x05': { name: 'FLASH_SIZE',   value: 512,          desc: 'Flash size in KB' },
  '0x06': { name: 'RAM_SIZE',     value: 128,          desc: 'RAM size in KB' },
  '0x07': { name: 'TEMP_CELSIUS', value: 42,           desc: 'Core temperature' },
}

const MOCK_DEVICES = [
  {
    id: 'rcf-001',
    name: 'RCF Node Alpha',
    mcu: 'STM32F446RE',
    port: '/dev/tty.usbmodem001',
    fw: 'v1.2.9 (Alpha)',
    protocol: 'RCF-PL v1.2.8',
    status: 'IDLE',
    crc: '0xA4F2B1D3',
  },
  {
    id: 'rcf-002',
    name: 'RCF Node Beta',
    mcu: 'STM32F103C8',
    port: '/dev/tty.usbmodem002',
    fw: 'v1.2.8-beta',
    protocol: 'RCF-PL v1.2.7',
    status: 'IDLE',
    crc: '0xB3E1A0C2',
  },
]

class RCFDevice {
  constructor() {
    this._connectedId = null
    this._state = 'DISCONNECTED'  // DISCONNECTED | CONNECTED | FLASHING | ERROR
    this._flashProgress = 0
    this._logs = []
    this._log('RCF Device Manager initialised')
  }

  _log(msg) {
    const entry = `[${new Date().toISOString()}] ${msg}`
    this._logs.push(entry)
    if (this._logs.length > 200) this._logs.shift()
    console.log('[RCF]', entry)
  }

  // ── Public API ────────────────────────────────────────────────

  scan() {
    this._log('Scanning for RCF devices…')
    // In production: enumerate SerialPort / libusb devices
    return MOCK_DEVICES.map(d => ({
      id: d.id,
      name: d.name,
      mcu: d.mcu,
      port: d.port,
      fw: d.fw,
      status: d.id === this._connectedId ? 'CONNECTED' : d.status,
    }))
  }

  connect(deviceId) {
    const dev = MOCK_DEVICES.find(d => d.id === deviceId)
    if (!dev) return { ok: false, error: `Device ${deviceId} not found` }

    this._connectedId = deviceId
    this._state = 'CONNECTED'
    this._log(`Connected to ${dev.name} on ${dev.port}`)

    // RCF handshake simulation
    const handshake = this._rcfHandshake(dev)
    return { ok: true, device: dev, handshake }
  }

  disconnect() {
    if (!this._connectedId) return { ok: false, error: 'No device connected' }
    this._log(`Disconnected from ${this._connectedId}`)
    this._connectedId = null
    this._state = 'DISCONNECTED'
    return { ok: true }
  }

  getStatus() {
    const dev = MOCK_DEVICES.find(d => d.id === this._connectedId) || null
    return {
      state: this._state,
      connectedDevice: dev
        ? { id: dev.id, name: dev.name, mcu: dev.mcu, fw: dev.fw, protocol: dev.protocol }
        : null,
      flashProgress: this._flashProgress,
      uptimeSeconds: Math.floor(process.uptime()),
      logs: this._logs.slice(-20),
    }
  }

  getDeviceInfo(deviceId) {
    const dev = MOCK_DEVICES.find(d => d.id === deviceId)
    if (!dev) return { error: `Device ${deviceId} not found` }
    return { ...dev, connected: dev.id === this._connectedId }
  }

  /**
   * Read an RCF-PL protocol register.
   * RCF packet format: [SOF 0x55][LEN 2B][CMD 0x01][ADDR 2B][CRC 4B][EOF 0xAA]
   */
  readRCF(register) {
    const reg = RCF_REGISTERS[register]
    if (!reg) return { ok: false, error: `Unknown register ${register}` }

    // Simulate RCF packet framing
    const packet = this._buildRCFPacket(0x01, register, reg.value)
    this._log(`RCF READ  ${register} (${reg.name}) = 0x${reg.value.toString(16).toUpperCase()}`)

    return {
      ok: true,
      register,
      name: reg.name,
      value: reg.value,
      hex: `0x${reg.value.toString(16).padStart(8, '0').toUpperCase()}`,
      desc: reg.desc,
      packet,
    }
  }

  /**
   * Write an RCF-PL protocol register.
   */
  writeRCF(register, value) {
    if (!RCF_REGISTERS[register]) return { ok: false, error: `Unknown register ${register}` }
    RCF_REGISTERS[register].value = value
    const packet = this._buildRCFPacket(0x02, register, value)
    this._log(`RCF WRITE ${register} = 0x${value.toString(16).toUpperCase()} → ACK`)
    return { ok: true, register, value, packet, ack: true }
  }

  /**
   * Flash firmware to connected device.
   * firmwarePayload: { name, size, crc, data (base64) }
   */
  async flashFirmware(firmwarePayload) {
    if (!this._connectedId) return { ok: false, error: 'No device connected' }
    if (this._state === 'FLASHING') return { ok: false, error: 'Already flashing' }

    this._state = 'FLASHING'
    this._flashProgress = 0
    this._log(`Flash started: ${firmwarePayload?.name || 'unknown'} (${firmwarePayload?.size || '?'} bytes)`)

    // Simulate flashing with progress
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        this._flashProgress += 10
        this._log(`Flash progress: ${this._flashProgress}%`)
        if (this._flashProgress >= 100) {
          clearInterval(interval)
          this._state = 'CONNECTED'
          this._flashProgress = 0
          const newCrc = `0x${Math.floor(Math.random() * 0xFFFFFFFF).toString(16).toUpperCase()}`
          this._log(`Flash complete. New CRC: ${newCrc}`)
          resolve({ ok: true, crc: newCrc, duration_ms: 3000 })
        }
      }, 300)
    })
  }

  // ── EHA Protocol Internals ────────────────────────────────────

  _rcfHandshake(device) {
    return {
      sof: '0x55',
      cmd: '0x00 (HANDSHAKE)',
      deviceId: `0x${parseInt(device.id.replace('rcf-', ''), 10).toString(16).padStart(4, '0').toUpperCase()}`,
      protocolVersion: device.protocol,
      crc: '0x' + this._crc32(device.id).toString(16).toUpperCase(),
      eof: '0xAA',
      ack: true,
    }
  }

  _buildRCFPacket(cmd, addr, value) {
    const addrInt = parseInt(addr, 16)
    const crc = this._crc32(`${cmd}${addrInt}${value}`)
    return {
      SOF: '0x55',
      LEN: '0x0008',
      CMD: `0x${cmd.toString(16).padStart(2, '0').toUpperCase()}`,
      ADDR: `0x${addrInt.toString(16).padStart(4, '0').toUpperCase()}`,
      DATA: `0x${value.toString(16).padStart(8, '0').toUpperCase()}`,
      CRC32: `0x${crc.toString(16).padStart(8, '0').toUpperCase()}`,
      EOF: '0xAA',
    }
  }

  /** Simple CRC-32 implementation */
  _crc32(str) {
    let crc = 0xFFFFFFFF
    for (let i = 0; i < str.length; i++) {
      crc ^= str.charCodeAt(i)
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0
  }
}

module.exports = { RCFDevice }
