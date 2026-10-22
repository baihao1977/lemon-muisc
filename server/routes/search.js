import { Router } from 'express'
import { AVAILABLE_SOURCES, searchMusic, searchAlbums, searchPlaylists, fetchAlbum } from '../musicSdk.js'
import { fetchPluginAlbum, hasPluginSource, searchPluginMedia } from '../sourceManager.js'
import { getStoredActiveSourceIds } from '../utils/activeSources.js'
import { getDisplaySources } from '../utils/displaySources.js'
import { formatUserError } from '../utils/userError.js'
import { createLimiter, withTimeout } from '../utils/asyncLimit.js'
import { buildAlbumCacheKey, getCachedAlbum, getOrFetchAlbum } from '../utils/albumCache.js'

export const searchRouter = Router()

const availableSources = (req) => getDisplaySources(req.user?.id)
const pluginAllowIds = (req) => (req.user?.id ? getStoredActiveSourceIds(req.user.id) : null)

function queryText(req, key, fallback = '') {
  const raw = req.query?.[key]
  const v = Array.isArray(raw) ? raw[0] : raw
  return String(v ?? fallback ?? '').trim()
}

function canUseSource(req, source) {
  const info = availableSources(req)[source]
  if (info && info.searchable !== false) return true
  return hasPluginSource(source, pluginAllowIds(req))
}
const searchLimiter = createLimiter(4)
const SEARCH_TIMEOUT_MS = 20000
const ALBUM_TIMEOUT_MS = 45000

function sliceAlbumList(data, page, limit) {
  if (!limit || !data?.list?.length || data.list.length <= limit) return data
  const start = (page - 1) * limit
  return {
    ...data,
    list: data.list.slice(start, start + limit),
    trackPage: page,
    trackPageSize: limit,
    trackTotal: data.list.length,
  }
}

searchRouter.get('/album', async (req, res) => {
  try {
    const keyword = queryText(req, 'keyword')
    const source = queryText(req, 'source', 'kw')
    const page = queryText(req, 'page', '1')
    const limit = queryText(req, 'limit', '30')
    if (!keyword) return res.status(400).json({ error: '缺少搜索关键词' })
    if (!canUseSource(req, source)) {
      return res.status(400).json({ error: `不支持的搜索源: ${source}` })
    }
    const run = AVAILABLE_SOURCES[source]
      ? () => searchAlbums(keyword, source, Number(page), Number(limit))
      : () => searchPluginMedia(source, keyword, Number(page), Number(limit), 'album', pluginAllowIds(req))
    const result = await searchLimiter(() => withTimeout(
      run(),
      SEARCH_TIMEOUT_MS,
      '专辑搜索超时，请稍后重试',
    ))
    res.json({ ok: true, data: result })
  } catch (e) {
    res.status(500).json({ error: formatUserError(e, '专辑搜索失败，请稍后重试') })
  }
})

searchRouter.get('/playlist', async (req, res) => {
  try {
    const keyword = queryText(req, 'keyword')
    const source = queryText(req, 'source', 'kw')
    const page = queryText(req, 'page', '1')
    const limit = queryText(req, 'limit', '30')
    if (!keyword) return res.status(400).json({ error: '缺少搜索关键词' })
    if (!canUseSource(req, source)) {
      return res.status(400).json({ error: `不支持的搜索源: ${source}` })
    }
    const run = AVAILABLE_SOURCES[source]
      ? () => searchPlaylists(keyword, source, Number(page), Number(limit))
      : () => searchPluginMedia(source, keyword, Number(page), Number(limit), 'sheet', pluginAllowIds(req))
    const result = await searchLimiter(() => withTimeout(
      run(),
      SEARCH_TIMEOUT_MS,
      '歌单搜索超时，请稍后重试',
    ))
    res.json({ ok: true, data: result })
  } catch (e) {
    res.status(500).json({ error: formatUserError(e, '歌单搜索失败，请稍后重试') })
  }
})

searchRouter.get('/album/detail', async (req, res) => {
  try {
    const source = queryText(req, 'source', 'kw')
    const id = queryText(req, 'id')
    const page = queryText(req, 'page', '1')
    const limit = queryText(req, 'limit', '0')
    if (!id) return res.status(400).json({ error: '缺少专辑 ID' })
    if (!canUseSource(req, source)) {
      return res.status(400).json({ error: `不支持的平台: ${source}` })
    }
    const cacheKey = buildAlbumCacheKey(source, id)
    const cached = getCachedAlbum(cacheKey)
    const loadAlbum = AVAILABLE_SOURCES[source]
      ? () => fetchAlbum(source, id)
      : () => fetchPluginAlbum(source, id, pluginAllowIds(req))
    const data = cached || await getOrFetchAlbum(cacheKey, () => searchLimiter(() => withTimeout(
      loadAlbum(),
      ALBUM_TIMEOUT_MS,
      '获取专辑超时，请稍后重试',
    )))
    const trackLimit = Math.min(Math.max(Number(limit) || 0, 0), 100)
    res.json({
      ok: true,
      data: trackLimit > 0 ? sliceAlbumList(data, Number(page) || 1, trackLimit) : data,
      cached: Boolean(cached),
    })
  } catch (e) {
    res.status(500).json({ error: formatUserError(e, '获取专辑失败，请稍后重试') })
  }
})

searchRouter.get('/', async (req, res) => {
  try {
    const keyword = queryText(req, 'keyword')
    const source = queryText(req, 'source', 'kw')
    const page = queryText(req, 'page', '1')
    const limit = queryText(req, 'limit', '30')
    if (!keyword) return res.status(400).json({ error: '缺少搜索关键词' })

    if (!canUseSource(req, source)) {
      return res.status(400).json({ error: `不支持的搜索源: ${source}` })
    }

    const run = AVAILABLE_SOURCES[source]
      ? () => searchMusic(keyword, source, Number(page), Number(limit))
      : () => searchPluginMedia(source, keyword, Number(page), Number(limit), 'music', pluginAllowIds(req))
    const result = await searchLimiter(() => withTimeout(
      run(),
      SEARCH_TIMEOUT_MS,
      '搜索超时，请稍后重试',
    ))
    res.json({ ok: true, data: result })
  } catch (e) {
    res.status(500).json({ error: formatUserError(e, '搜索失败，请稍后重试') })
  }
})

searchRouter.get('/sources', (req, res) => {
  res.json({ sources: getDisplaySources(req.user?.id) })
})
