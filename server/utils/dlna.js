import dgram from 'dgram'
import os from 'os'
import needle from 'needle'

const SSDP_ADDR = '239.255.255.250'
const SSDP_PORT = 1900
const DEVICE_TTL_MS = 90_000

/** @type {Map<string, { udn: string, name: string, location: string, controlURL: string, seenAt: number }>} */
const deviceCache = new Map()
/** 正在投屏的设备不过期，避免连播下一首时报「设备不在线」 */
const stickyUdns = new Set()

function parseHeaderMap(text) {
  const map = {}
  for (const line of String(text || '').split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i <= 0) continue
    map[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
  }
  return map
}

function xmlTag(xml, name) {
  const re = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'i')
  const m = String(xml || '').match(re)
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : ''
}

function resolveUrl(base, rel) {
  try {
    return new URL(rel, base).href
  } catch {
    return String(rel || '')
  }
}

function parseAvTransport(xml, location) {
  const name = xmlTag(xml, 'friendlyName') || xmlTag(xml, 'modelName') || 'DLNA 设备'
  const udn = xmlTag(xml, 'UDN') || location
  const services = String(xml).match(/<service\b[\s\S]*?<\/service>/gi) || []
  let controlURL = ''
  for (const svc of services) {
    const type = xmlTag(svc, 'serviceType')
    if (!/AVTransport/i.test(type)) continue
    controlURL = xmlTag(svc, 'controlURL')
    if (controlURL) break
  }
  if (!controlURL) return null
  return {
    udn,
    name,
    location,
    controlURL: resolveUrl(location, controlURL),
    seenAt: Date.now(),
  }
}

async function fetchDevice(location) {
  const res = await needle('get', location, {
    parse_response: false,
    follow_max: 3,
    timeout: 8000,
    headers: { 'User-Agent': 'LemonMusic/1.2 DLNA' },
  })
  if ((res.statusCode || 0) >= 400) return null
  const xml = Buffer.isBuffer(res.body) ? res.body.toString('utf8') : String(res.body || '')
  return parseAvTransport(xml, location)
}

function sendSearch(sock) {
  const targets = [
    'urn:schemas-upnp-org:device:MediaRenderer:1',
    'urn:schemas-upnp-org:service:AVTransport:1',
  ]
  for (const st of targets) {
    const msg = Buffer.from(
      `M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP_ADDR}:${SSDP_PORT}\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`,
    )
    sock.send(msg, SSDP_PORT, SSDP_ADDR)
  }
}

export async function discoverDlnaDevices({ timeoutMs = 2800 } = {}) {
  const locations = new Set()
  await new Promise((resolve) => {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    const done = () => {
      try { sock.close() } catch {}
      resolve()
    }
    sock.on('error', () => done())
    sock.on('message', (buf) => {
      const headers = parseHeaderMap(buf.toString('utf8'))
      const loc = headers.location
      if (loc) locations.add(loc)
    })
    sock.bind(0, () => {
      try { sock.setBroadcast(true) } catch {}
      try { sock.addMembership(SSDP_ADDR) } catch {}
      sendSearch(sock)
    })
    setTimeout(done, Math.max(800, timeoutMs))
  })

  const found = []
  for (const loc of locations) {
    try {
      const device = await fetchDevice(loc)
      if (!device) continue
      deviceCache.set(device.udn, device)
      found.push(device)
    } catch {}
  }
  pruneCache()
  return listCachedDevices()
}

function pruneCache() {
  const now = Date.now()
  for (const [id, d] of deviceCache) {
    if (stickyUdns.has(id)) continue
    if (now - d.seenAt > DEVICE_TTL_MS) deviceCache.delete(id)
  }
}

export function listCachedDevices() {
  pruneCache()
  return [...deviceCache.values()].map((d) => ({
    udn: d.udn,
    name: d.name,
    location: d.location,
  }))
}

export function getCachedDevice(udn) {
  const id = String(udn || '')
  const hit = deviceCache.get(id)
  if (hit) return hit
  pruneCache()
  return deviceCache.get(id) || null
}

export function pinDlnaDevice(udn) {
  const id = String(udn || '').trim()
  if (!id) return
  stickyUdns.add(id)
  const d = deviceCache.get(id)
  if (d) d.seenAt = Date.now()
}

export function unpinDlnaDevice(udn) {
  stickyUdns.delete(String(udn || ''))
}

export async function ensureDlnaDevice(udn) {
  const id = String(udn || '').trim()
  if (!id) throw new Error('缺少设备')
  let device = getCachedDevice(id)
  if (!device) {
    await discoverDlnaDevices({ timeoutMs: 2200 })
    device = getCachedDevice(id)
  }
  if (!device) throw new Error('设备不在线，请重新搜索')
  pinDlnaDevice(id)
  return device
}

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function soap(controlURL, action, bodyInner, timeout = 10000) {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${action} xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">${bodyInner}</u:${action}>
  </s:Body>
</s:Envelope>`
  const res = await needle('post', controlURL, xml, {
    parse_response: false,
    timeout,
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      SOAPACTION: `"urn:schemas-upnp-org:service:AVTransport:1#${action}"`,
      'User-Agent': 'LemonMusic/1.2 DLNA',
    },
  })
  const text = Buffer.isBuffer(res.body) ? res.body.toString('utf8') : String(res.body || '')
  if ((res.statusCode || 0) >= 400 || /<s:Fault/i.test(text)) {
    const msg = xmlTag(text, 'errorDescription') || xmlTag(text, 'errorCode') || `DLNA ${action} 失败`
    throw new Error(msg)
  }
  return text
}

function dlnaPn(mime) {
  const m = String(mime || 'audio/mpeg').toLowerCase()
  if (m.includes('mp4') || m.includes('aac') || m.includes('m4a')) return 'AAC_ISO'
  if (m.includes('flac')) return 'FLAC'
  if (m.includes('wav') || m.includes('lpcm')) return 'LPCM'
  return 'MP3'
}

function protocolInfo(mime) {
  const m = String(mime || 'audio/mpeg').split(';')[0].trim() || 'audio/mpeg'
  const pn = dlnaPn(m)
  return `http-get:*:${m}:DLNA.ORG_PN=${pn};DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000`
}

export function formatUpnpDuration(sec) {
  const n = Math.max(0, Math.floor(Number(sec) || 0))
  const h = Math.floor(n / 3600)
  const m = Math.floor((n % 3600) / 60)
  const s = n % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function didl({ title, artist, album, uri, mime, duration, size }) {
  const durAttr = Number(duration) > 1 ? ` duration="${formatUpnpDuration(duration)}"` : ''
  const sizeAttr = Number(size) > 0 ? ` size="${Math.floor(Number(size))}"` : ''
  return `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">
    <item id="1" parentID="0" restricted="1">
      <dc:title>${escapeXml(String(title || '音频').slice(0, 200))}</dc:title>
      <upnp:class>object.item.audioItem.musicTrack</upnp:class>
      <dc:creator>${escapeXml(String(artist || '').slice(0, 200))}</dc:creator>
      <upnp:artist>${escapeXml(String(artist || '').slice(0, 200))}</upnp:artist>
      <upnp:album>${escapeXml(String(album || '').slice(0, 200))}</upnp:album>
      <res protocolInfo="${escapeXml(protocolInfo(mime))}"${durAttr}${sizeAttr}>${escapeXml(uri)}</res>
    </item>
  </DIDL-Lite>`
}

function friendlyDlnaError(raw) {
  const s = String(raw || '')
  if (/无法读取媒体音频|716|714|701|resource not found|illegal mime|unsupported/i.test(s)) {
    return '音箱无法读取该音频（常见于小爱只认 MP3）。已按投屏转码重试；仍失败请确认音箱与 NAS 同一网段，并用局域网地址打开柠檬。'
  }
  return s || '投屏失败'
}

async function setTransportUri(device, uri, metaInner) {
  await soap(device.controlURL, 'SetAVTransportURI', `
    <InstanceID>0</InstanceID>
    <CurrentURI>${escapeXml(uri)}</CurrentURI>
    <CurrentURIMetaData>${metaInner}</CurrentURIMetaData>
  `)
}

export async function dlnaPlay(udn, { uri, title, artist, album, mime = 'audio/mpeg', duration = 0, size = 0 }) {
  const device = await ensureDlnaDevice(udn)
  if (!uri) throw new Error('缺少播放地址')
  try {
    await soap(device.controlURL, 'Stop', '<InstanceID>0</InstanceID>')
  } catch {}
  const xml = didl({ title, artist, album, uri, mime, duration, size })
  const attempts = [
    () => setTransportUri(device, uri, escapeXml(xml)),
    () => setTransportUri(device, uri, `<![CDATA[${xml}]]>`),
    () => setTransportUri(device, uri, ''),
  ]
  let lastErr = null
  for (const run of attempts) {
    try {
      await run()
      lastErr = null
      break
    } catch (e) {
      lastErr = e
    }
  }
  if (lastErr) throw new Error(friendlyDlnaError(lastErr.message))
  try {
    await soap(device.controlURL, 'Play', '<InstanceID>0</InstanceID><Speed>1</Speed>')
  } catch (e) {
    throw new Error(friendlyDlnaError(e.message))
  }
  return { ok: true, udn: device.udn, name: device.name }
}

export async function dlnaPause(udn) {
  const device = await ensureDlnaDevice(udn)
  await soap(device.controlURL, 'Pause', '<InstanceID>0</InstanceID>')
  return { ok: true, udn: device.udn }
}

export async function dlnaResume(udn) {
  const device = await ensureDlnaDevice(udn)
  await soap(device.controlURL, 'Play', '<InstanceID>0</InstanceID><Speed>1</Speed>')
  return { ok: true, udn: device.udn }
}

export async function dlnaStop(udn) {
  const id = String(udn || '').trim()
  let device = getCachedDevice(id)
  if (!device) {
    try { device = await ensureDlnaDevice(id) } catch {}
  }
  unpinDlnaDevice(id)
  if (!device) return { ok: true }
  try {
    await soap(device.controlURL, 'Stop', '<InstanceID>0</InstanceID>')
  } catch {}
  return { ok: true }
}

function parseUpnpTime(raw) {
  const s = String(raw || '').trim()
  if (!s || s === 'NOT_IMPLEMENTED' || s === '-1') return 0
  const hms = s.match(/^(\d+):(\d{1,2}):(\d{1,2})(?:\.(\d+))?$/)
  if (hms) return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3])
  const ms = s.match(/^(\d{1,2}):(\d{1,2})(?:\.(\d+))?$/)
  if (ms) return Number(ms[1]) * 60 + Number(ms[2])
  const n = Number(s)
  return Number.isFinite(n) && n > 0 && n < 86400 ? n : 0
}

export async function dlnaGetStatus(udn) {
  const device = await ensureDlnaDevice(udn)
  let state = ''
  let relTime = 0
  let duration = 0
  try {
    const info = await soap(device.controlURL, 'GetTransportInfo', '<InstanceID>0</InstanceID>', 4000)
    state = xmlTag(info, 'CurrentTransportState')
  } catch {}
  try {
    const pos = await soap(device.controlURL, 'GetPositionInfo', '<InstanceID>0</InstanceID>', 4000)
    relTime = parseUpnpTime(xmlTag(pos, 'RelTime') || xmlTag(pos, 'AbsTime'))
    duration = parseUpnpTime(xmlTag(pos, 'TrackDuration'))
  } catch {}
  return {
    ok: true,
    udn: device.udn,
    state: String(state || '').toUpperCase(),
    relTime,
    duration,
  }
}

export function getAdvertisedBaseUrl(req) {
  const env = String(process.env.LEMON_PUBLIC_URL || '').replace(/\/+$/, '')
  if (env) return env
  const port = process.env.PORT || '7983'
  const ips = []
  for (const list of Object.values(os.networkInterfaces() || {})) {
    for (const a of list || []) {
      const family = a.family === 4 || a.family === 'IPv4'
      if (!family || a.internal) continue
      ips.push(a.address)
    }
  }
  const prefer = ips.find((ip) => ip.startsWith('192.168.') || ip.startsWith('10.'))
    || ips.find((ip) => /^172\.(1[6-9]|2\d|3[01])\./.test(ip) && !ip.startsWith('172.17.') && !ip.startsWith('172.18.'))
    || ips[0]
  if (prefer) return `http://${prefer}:${port}`
  const host = String(req.headers.host || '').split(',')[0].trim()
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0]
  if (host) return `${proto}://${host}`
  return `http://127.0.0.1:${port}`
}
