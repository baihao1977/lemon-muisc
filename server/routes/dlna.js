import { Router } from 'express'
import {
  discoverDlnaDevices,
  listCachedDevices,
  dlnaStop,
  dlnaGetStatus,
  getAdvertisedBaseUrl,
} from '../utils/dlna.js'
import { playTrackOnDlnaDevice } from '../utils/dlnaCastPlay.js'
import {
  attachCastSession,
  getCastSession,
  markCastPlayed,
  stopCastSession,
  pauseCastSession,
  resumeCastSession,
  updateCastQueue,
} from '../utils/dlnaCastSession.js'

export const dlnaRouter = Router()

dlnaRouter.get('/devices', async (req, res) => {
  try {
    const refresh = String(req.query.refresh || '') === '1'
    const devices = refresh ? await discoverDlnaDevices() : listCachedDevices()
    if (!devices.length && !refresh) {
      const found = await discoverDlnaDevices()
      return res.json({ ok: true, data: found, advertisedBase: getAdvertisedBaseUrl(req) })
    }
    res.json({ ok: true, data: devices, advertisedBase: getAdvertisedBaseUrl(req) })
  } catch (e) {
    res.status(500).json({ error: e.message || '搜索 DLNA 设备失败。Docker 需使用 host 网络才能发现电视/音箱。' })
  }
})

dlnaRouter.get('/session', (req, res) => {
  res.json({ ok: true, ...getCastSession(req.user.id) })
})

dlnaRouter.post('/session', (req, res) => {
  const updated = updateCastQueue(req, {
    udn: req.body?.udn,
    queue: req.body?.queue,
    playMode: req.body?.playMode,
    quality: req.body?.quality,
  })
  if (!updated) return res.status(404).json({ error: '当前没有投屏会话' })
  res.json({ ok: true, ...updated })
})

dlnaRouter.post('/play', async (req, res) => {
  try {
    const udn = String(req.body?.udn || '').trim()
    if (!udn) return res.status(400).json({ error: '请选择设备' })
    const result = await playTrackOnDlnaDevice(req, udn)
    const session = attachCastSession(req, {
      udn,
      queue: req.body?.queue,
      index: req.body?.index,
      playMode: req.body?.playMode,
      quality: req.body?.quality,
    })
    markCastPlayed(req.user.id, result.duration)
    res.json({ ok: true, ...result, serverOwned: true, session })
  } catch (e) {
    const status = Number(e.status) || 400
    res.status(status >= 400 && status < 600 ? status : 400).json({
      error: e.message || '投屏失败',
      code: e.code,
    })
  }
})

dlnaRouter.get('/status', async (req, res) => {
  try {
    const udn = String(req.query.udn || '').trim()
    if (!udn) return res.status(400).json({ error: '缺少设备' })
    const result = await dlnaGetStatus(udn)
    const session = getCastSession(req.user.id)
    res.json({ ok: true, ...result, session: session.active ? session : undefined })
  } catch (e) {
    res.status(400).json({ error: e.message || '查询投屏状态失败' })
  }
})

dlnaRouter.post('/pause', async (req, res) => {
  try {
    const session = await pauseCastSession(req.user.id)
    if (!session) return res.status(404).json({ error: '当前没有投屏会话' })
    res.json({ ok: true, ...session })
  } catch (e) {
    res.status(400).json({ error: e.message || '暂停失败' })
  }
})

dlnaRouter.post('/resume', async (req, res) => {
  try {
    const session = await resumeCastSession(req.user.id)
    if (!session) return res.status(404).json({ error: '当前没有投屏会话' })
    res.json({ ok: true, ...session })
  } catch (e) {
    res.status(400).json({ error: e.message || '继续播放失败' })
  }
})

dlnaRouter.post('/stop', async (req, res) => {
  try {
    const udn = String(req.body?.udn || '').trim()
    const existing = getCastSession(req.user.id)
    if (!existing.active && !udn) return res.status(400).json({ error: '请选择设备' })
    const result = await stopCastSession(req.user.id, { stopDevice: true })
    if (udn && udn !== result.udn) {
      try { await dlnaStop(udn) } catch {}
    }
    res.json({ ok: true, ...result })
  } catch (e) {
    res.status(400).json({ error: e.message || '停止失败' })
  }
})
