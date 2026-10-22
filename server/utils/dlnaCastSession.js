import { dlnaGetStatus, dlnaStop, dlnaPause, dlnaResume, pinDlnaDevice, unpinDlnaDevice } from './dlna.js'
import { broadcast } from '../ws.js'
import {
  captureDlnaHttpContext,
  makeDlnaReq,
  parseDurationSeconds,
  playTrackOnDlnaDevice,
} from './dlnaCastPlay.js'

const MAX_QUEUE = 400
const TICK_MS = 1500
const IGNORE_STOP_MS = 12000

/** @type {Map<string, object>} */
const sessions = new Map()
let tickTimer = 0

const KEEP_ITEM_KEYS = [
  'name', 'singer', 'artist', 'album', 'albumName', 'id', 'trackId', 'songId', 'songmid',
  'hash', 'copyrightId', 'musicId', 'strMediaMid', 'albumAudioId', 'albumId', 'albumMid',
  'albummid', 'rid', 'dcTargetId', 'interval', 'duration', 'source', 'localPath', 'filePath',
  'path', 'podcastEpisodeId', 'podcastFeedId', 'img', 'picUrl', 'qualitys', 'types', 'quality',
  'key',
]

function slimItem(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  for (const k of KEEP_ITEM_KEYS) {
    if (src[k] != null && src[k] !== '') out[k] = src[k]
  }
  return out
}

function slimQueue(list) {
  const arr = Array.isArray(list) ? list.slice(0, MAX_QUEUE) : []
  return arr.map((entry) => {
    const item = slimItem(entry?.item ?? entry)
    const source = String(entry?.source || item.source || '')
    const key = String(entry?.key || item.key || '')
    return { key, source, item }
  }).filter((e) => e.item?.name)
}

export function trackKeyOf(entry) {
  const item = entry?.item || entry || {}
  const local = item.localPath || item.filePath || item.path || ''
  if (local) return `local:${local}`
  const podcastId = item.podcastEpisodeId || (item.source === 'podcast' ? item.id : '')
  if (podcastId) return `podcast:${podcastId}`
  if (entry?.key) return String(entry.key)
  const id = item.songmid || item.hash || item.songId || item.musicId || item.copyrightId || item.id
  return `${item.source || entry?.source || ''}:${id || ''}`
}

function ensureTicker() {
  if (tickTimer) return
  tickTimer = setInterval(() => {
    tickAll().catch(() => {})
  }, TICK_MS)
  if (typeof tickTimer === 'object' && tickTimer.unref) tickTimer.unref()
}

function stopTickerIfIdle() {
  if (sessions.size) return
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = 0
  }
}

function publicSession(s, extra = {}) {
  if (!s) return { active: false }
  const entry = s.queue[s.index]
  return {
    active: true,
    udn: s.udn,
    index: s.index,
    playMode: s.playMode,
    quality: s.quality,
    duration: s.durationSec || 0,
    paused: Boolean(s.paused),
    item: entry?.item || null,
    source: entry?.source || '',
    key: trackKeyOf(entry),
    ...extra,
  }
}

function notify(s, type, extra = {}) {
  broadcast(type, publicSession(s, extra), s.userId)
}

function itemToPlayBody(entry, quality) {
  const item = { ...(entry?.item || {}) }
  const source = item.podcastEpisodeId || item.source === 'podcast' || entry?.source === 'podcast'
    ? 'podcast'
    : (entry?.source || item.source || '')
  const rawId = String(item.id || item.trackId || '')
  const localPath = item.localPath || item.filePath || ''
  const trackId = localPath && /^[0-9a-f-]{36}$/i.test(rawId) ? rawId : (item.trackId || '')
  const episodeId = item.podcastEpisodeId || (source === 'podcast' ? item.id : '')
  return {
    ...item,
    source,
    quality: item.quality || quality || '128k',
    trackId: trackId || undefined,
    localPath: localPath || undefined,
    podcastEpisodeId: episodeId || undefined,
    name: item.name,
    singer: item.singer || item.artist,
    album: item.album || item.albumName,
  }
}

function nextIndex(s) {
  const n = s.queue.length
  const i = s.index
  if (!n) return -1
  if (s.playMode === 'single') return i
  if (s.playMode === 'random') {
    if (n === 1) return i
    let j = i
    let guard = 0
    while (j === i && guard < 8) {
      j = Math.floor(Math.random() * n)
      guard += 1
    }
    return j
  }
  if (i + 1 < n) return i + 1
  if (s.playMode === 'loop') return 0
  return -1
}

function isLiveSession(s) {
  return Boolean(s) && sessions.get(sessionKey(s.userId)) === s
}

async function playSessionIndex(s, index) {
  if (!isLiveSession(s)) return false
  if (index < 0 || index >= s.queue.length) return false
  s.index = index
  s.advancing = true
  s.ignoreStopUntil = Date.now() + IGNORE_STOP_MS
  s.seenPlaying = false
  s.startedAt = Date.now()
  s.clockFrozenElapsed = 0
  s.paused = false
  const entry = s.queue[index]
  const body = itemToPlayBody(entry, s.quality)
  const req = makeDlnaReq(s.http, body)
  try {
    const result = await playTrackOnDlnaDevice(req, s.udn)
    s.durationSec = Number(result.duration) || parseDurationSeconds(body.interval || body.duration)
    s.lastUri = result.uri || ''
    pinDlnaDevice(s.udn)
    notify(s, 'dlna:now-playing')
    return true
  } finally {
    s.advancing = false
  }
}

async function advanceSession(s) {
  if (!isLiveSession(s) || s.advancing) return
  const next = nextIndex(s)
  if (next < 0) {
    try { await dlnaStop(s.udn) } catch {}
    unpinDlnaDevice(s.udn)
    notify(s, 'dlna:queue-ended', { active: false })
    sessions.delete(s.userId)
    stopTickerIfIdle()
    return
  }
  let idx = next
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const ok = await playSessionIndex(s, idx)
      if (ok) return
    } catch (e) {
      console.warn('[dlna-cast] 下一首失败:', e?.message || e)
    }
    if (s.playMode === 'single') return
    const more = nextIndex({ ...s, index: idx })
    if (more < 0 || more === idx) return
    idx = more
  }
}

function sessionElapsed(s, now) {
  if (s.paused) return Number(s.clockFrozenElapsed) || 0
  return Math.max(0, (now - s.startedAt) / 1000)
}

function playbackLooksFinished(s, rel, now) {
  const dur = Number(s.durationSec) || 0
  const elapsed = sessionElapsed(s, now)
  const nearEndByRel = dur > 5 && rel >= dur - 4
  const nearEndByClock = dur > 5 && elapsed >= dur - 1.2
  return nearEndByRel || (rel < 1.5 && nearEndByClock)
}

function enterPaused(s, now, state = 'PAUSED_PLAYBACK') {
  if (s.paused) return
  s.clockFrozenElapsed = sessionElapsed(s, now)
  s.paused = true
  notify(s, 'dlna:transport', { paused: true, state })
}

function exitPaused(s, now) {
  if (!s.paused) return
  s.startedAt = now - (Number(s.clockFrozenElapsed) || 0) * 1000
  s.paused = false
  notify(s, 'dlna:transport', { paused: false, state: 'PLAYING' })
}

async function endSessionFromDevice(s) {
  if (!isLiveSession(s)) return
  sessions.delete(sessionKey(s.userId))
  stopTickerIfIdle()
  unpinDlnaDevice(s.udn)
  notify(s, 'dlna:queue-ended', { active: false, reason: 'device-stop' })
}

async function tickSession(s) {
  if (!isLiveSession(s) || s.advancing) return
  const now = Date.now()
  try {
    const st = await dlnaGetStatus(s.udn)
    const state = String(st?.state || '').toUpperCase()
    const rel = Number(st?.relTime) || 0
    const durFromTv = Number(st?.duration) || 0
    if (durFromTv > 1 && durFromTv < 86400 && !(s.durationSec > 1)) s.durationSec = durFromTv

    if (state === 'PLAYING' || state === 'TRANSITIONING') s.seenPlaying = true
    if (rel > 0.4) s.seenPlaying = true

    if (state === 'PAUSED_PLAYBACK') {
      enterPaused(s, now, state)
      return
    }

    if (state === 'PLAYING' || state === 'TRANSITIONING') {
      exitPaused(s, now)
      return
    }

    if (now < s.ignoreStopUntil) return
    if (!s.seenPlaying) return
    if (state === 'STOPPED' || state === 'NO_MEDIA_PRESENT') {
      if (playbackLooksFinished(s, rel, now)) {
        await advanceSession(s)
        return
      }
      // 进度还在曲中：设备暂停常报 STOPPED，勿切下一首
      if (rel >= 0.8) {
        enterPaused(s, now, state)
        return
      }
      await endSessionFromDevice(s)
    }
  } catch {
    /* 部分音箱不报状态，用曲长墙钟切歌 */
  }

  if (s.paused) return
  if (now < s.ignoreStopUntil) return
  const dur = Number(s.durationSec) || 0
  if (dur > 3) {
    const elapsed = sessionElapsed(s, now)
    if (elapsed >= dur + 1.5) await advanceSession(s)
  }
}

async function tickAll() {
  const list = [...sessions.values()]
  for (const s of list) {
    try { await tickSession(s) } catch {}
  }
}

function normalizePlayMode(mode) {
  return ['list', 'loop', 'single', 'random'].includes(mode) ? mode : 'list'
}

function sessionKey(userId) {
  return String(userId ?? '')
}

export function getCastSession(userId) {
  return publicSession(sessions.get(sessionKey(userId)))
}

export function attachCastSession(req, {
  udn,
  queue,
  index,
  playMode,
  quality,
} = {}) {
  const userId = req.user?.id
  if (userId == null || userId === '' || !udn) return { active: false }
  const q = slimQueue(queue)
  const idx = Math.max(0, Math.min(Number(index) || 0, Math.max(0, q.length - 1)))
  const prev = sessions.get(sessionKey(userId))
  if (prev && prev.udn && prev.udn !== udn) {
    unpinDlnaDevice(prev.udn)
  }
  const s = {
    userId,
    role: req.user.role,
    udn: String(udn),
    queue: q.length ? q : (prev?.queue || []),
    index: q.length ? idx : (prev?.index || 0),
    playMode: normalizePlayMode(playMode || prev?.playMode),
    quality: String(quality || prev?.quality || '128k'),
    http: captureDlnaHttpContext(req),
    startedAt: Date.now(),
    durationSec: 0,
    ignoreStopUntil: Date.now() + IGNORE_STOP_MS,
    seenPlaying: false,
    advancing: false,
    paused: false,
    clockFrozenElapsed: 0,
    lastUri: '',
  }
  if (!s.queue.length && req.body) {
    s.queue = slimQueue([{ item: req.body, source: req.body.source }])
    s.index = 0
  } else if (s.queue.length && req.body) {
    const bodyKey = trackKeyOf({ item: req.body, source: req.body.source, key: req.body.key })
    const found = s.queue.findIndex((e) => trackKeyOf(e) === bodyKey)
    if (found >= 0) s.index = found
  }
  sessions.set(sessionKey(userId), s)
  pinDlnaDevice(s.udn)
  ensureTicker()
  return publicSession(s, { serverOwned: true })
}

export function updateCastQueue(req, { queue, playMode, udn, quality } = {}) {
  const s = sessions.get(sessionKey(req.user?.id))
  if (!s) return null
  if (udn && String(udn) !== s.udn) s.udn = String(udn)
  const key = trackKeyOf(s.queue[s.index])
  if (Array.isArray(queue)) {
    s.queue = slimQueue(queue)
    const found = s.queue.findIndex((e) => trackKeyOf(e) === key)
    s.index = found >= 0 ? found : Math.min(s.index, Math.max(0, s.queue.length - 1))
  }
  if (playMode) s.playMode = normalizePlayMode(playMode)
  if (quality) s.quality = String(quality)
  s.http = captureDlnaHttpContext(req)
  return publicSession(s)
}

export function markCastPlayed(userId, durationSec = 0) {
  const s = sessions.get(sessionKey(userId))
  if (!s) return
  s.startedAt = Date.now()
  s.ignoreStopUntil = Date.now() + IGNORE_STOP_MS
  s.seenPlaying = false
  s.paused = false
  s.clockFrozenElapsed = 0
  if (durationSec > 1) s.durationSec = durationSec
  else {
    const item = s.queue[s.index]?.item
    s.durationSec = parseDurationSeconds(item?.interval || item?.duration)
  }
}

export async function pauseCastSession(userId) {
  const s = sessions.get(sessionKey(userId))
  if (!s) return null
  try { await dlnaPause(s.udn) } catch {}
  enterPaused(s, Date.now(), 'PAUSED_PLAYBACK')
  return publicSession(s)
}

export async function resumeCastSession(userId) {
  const s = sessions.get(sessionKey(userId))
  if (!s) return null
  await dlnaResume(s.udn)
  exitPaused(s, Date.now())
  s.seenPlaying = true
  return publicSession(s)
}

export async function stopCastSession(userId, { stopDevice = true } = {}) {
  const s = sessions.get(sessionKey(userId))
  if (!s) return { ok: true }
  sessions.delete(sessionKey(userId))
  stopTickerIfIdle()
  unpinDlnaDevice(s.udn)
  if (stopDevice) {
    try { await dlnaStop(s.udn) } catch {}
  }
  broadcast('dlna:queue-ended', { active: false, udn: s.udn, reason: 'stop' }, s.userId)
  return { ok: true, udn: s.udn }
}
