import fs from 'fs'
import path from 'path'
import { dlnaPlay, getAdvertisedBaseUrl } from './dlna.js'
import { createStreamTicket } from './streamTicket.js'
import { resolvePlayStreamRel } from '../routes/play.js'
import { ensureDlnaPlayMp3 } from './dlnaTranscode.js'
import { resolvePathByTrackId } from './libraryCache.js'
import { mapToContainerPath } from './filePaths.js'

export function captureDlnaHttpContext(req) {
  return {
    user: { id: req.user.id, role: req.user.role },
    headers: {
      host: req.headers?.host || '',
      'x-forwarded-proto': req.headers?.['x-forwarded-proto'] || '',
      'x-forwarded-host': req.headers?.['x-forwarded-host'] || '',
    },
    protocol: req.protocol || 'http',
  }
}

export function makeDlnaReq(ctx, body) {
  return {
    user: ctx.user,
    headers: ctx.headers || {},
    protocol: ctx.protocol || 'http',
    body: body || {},
  }
}

function toAbs(req, relUrl) {
  let base = getAdvertisedBaseUrl(req)
  base = String(base || '').replace(/^https:/i, 'http:')
  if (!relUrl) return ''
  if (/^https?:\/\//i.test(relUrl)) return relUrl.replace(/^https:/i, 'http:')
  const pathPart = relUrl.startsWith('/') ? relUrl : `/${relUrl}`
  return `${base}${pathPart}`
}

function signRel(req, relUrl) {
  const ticket = createStreamTicket({
    userId: req.user.id,
    role: req.user.role,
    scope: String(relUrl).includes('/play/proxy') ? 'proxy' : 'local',
    ttlSec: 4 * 60 * 60,
  })
  const join = relUrl.includes('?') ? '&' : '?'
  return `${relUrl}${join}ticket=${encodeURIComponent(ticket)}`
}

function isLosslessQuality(q) {
  return /flac|hires|hi-res|hi_res|master|ape|wav|sq|999k|2000k/i.test(String(q || ''))
}

function toDlnaFriendlyRel(rel, extra = {}) {
  const raw = String(rel || '')
  if (!raw) return raw
  if (extra.local) {
    const q = raw.includes('?') ? raw.slice(raw.indexOf('?')) : ''
    return `/api/play/dlna.mp3${q}`
  }
  if (raw.includes('/play/proxy?')) return raw.replace('/play/proxy?', '/play/proxy.mp3?')
  return raw
}

async function resolveDlnaStreamRel(req) {
  if (!isLosslessQuality(req.body?.quality)) {
    const result = await resolvePlayStreamRel(req)
    return { ...result, rel: toDlnaFriendlyRel(result.rel, result.extra) }
  }
  const saved = req.body
  for (const quality of ['320k', '128k']) {
    try {
      req.body = { ...saved, quality, type: quality }
      const result = await resolvePlayStreamRel(req)
      if (result?.rel) {
        req.body = saved
        return { ...result, rel: toDlnaFriendlyRel(result.rel, result.extra) }
      }
    } catch {}
  }
  req.body = saved
  const result = await resolvePlayStreamRel(req)
  return { ...result, rel: toDlnaFriendlyRel(result.rel, result.extra) }
}

async function warmupDlnaMp3(req) {
  const tid = String(req.body?.trackId || '').trim()
  let file = tid ? (resolvePathByTrackId(tid) || '') : ''
  if (!file) file = String(req.body?.localPath || req.body?.filePath || '')
  if (!file) return
  const resolved = path.resolve(mapToContainerPath(file) || file)
  const exists = fs.existsSync(resolved) ? resolved : path.resolve(file)
  if (!fs.existsSync(exists)) return
  if (path.extname(exists).toLowerCase() === '.mp3') return
  await ensureDlnaPlayMp3(exists)
}

export function parseDurationSeconds(value) {
  if (value == null || value === '') return 0
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 10000) return value / 1000
    return value
  }
  const str = String(value).trim()
  const parts = str.split(':').map(Number)
  if (parts.length === 2 && parts.every((n) => !Number.isNaN(n))) return parts[0] * 60 + parts[1]
  if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2]
  }
  const n = parseFloat(str)
  return Number.isNaN(n) ? 0 : n
}

/** 把当前请求体解析成投屏 URI 并 SOAP 播放 */
export async function playTrackOnDlnaDevice(req, udn) {
  const title = String(req.body?.name || req.body?.title || '音频')
  const artist = String(req.body?.singer || req.body?.artist || '')
  const album = String(req.body?.album || '')
  const { rel, extra } = await resolveDlnaStreamRel(req)
  if (!rel) {
    const err = new Error('无法解析可投送的播放地址')
    err.status = 400
    throw err
  }
  if (extra?.local) {
    try { await warmupDlnaMp3(req) } catch {}
  }
  const uri = toAbs(req, signRel(req, rel))
  const duration = parseDurationSeconds(req.body?.interval || req.body?.duration)
  const result = await dlnaPlay(udn, { uri, title, artist, album, mime: 'audio/mpeg', duration })
  return { ...result, uri, duration }
}
