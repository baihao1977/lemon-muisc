import { Router } from 'express'
import { AVAILABLE_SOURCES, fetchPlaylist, fetchRecommendPlaylists } from '../musicSdk.js'
import { fetchPluginSheet } from '../sourceManager.js'
import { getStoredActiveSourceIds } from '../utils/activeSources.js'
import { getDisplaySources } from '../utils/displaySources.js'
import { formatUserError } from '../utils/userError.js'
import { createLimiter, withTimeout } from '../utils/asyncLimit.js'
import { buildPlaylistCacheKey, getCachedPlaylist, getOrFetchPlaylist } from '../utils/playlistCache.js'
import {
  buildDiscoverFeedKey,
  getOrFetchDiscoverFeed,
} from '../utils/discoverFeedCache.js'

export const playlistRouter = Router()

const availableSources = (req) => getDisplaySources(req.user?.id)
const playlistLimiter = createLimiter(3)
/** 与前端发现页超时对齐 */
const RECOMMEND_TIMEOUT_MS = 18000
const PLAYLIST_TIMEOUT_MS = 120000

playlistRouter.get('/sources', (req, res) => {
  res.json({ sources: getDisplaySources(req.user?.id) })
})

playlistRouter.get('/recommend', async (req, res) => {
  try {
    const { source = 'kw', sort = 'new', page = 1, limit } = req.query
    if (!availableSources(req)[source]) {
      return res.status(400).json({ error: `不支持的平台: ${source}` })
    }
    if (!AVAILABLE_SOURCES[source]) {
      return res.json({ ok: true, data: { list: [], allPage: 1, total: 0 } })
    }
    const pageNum = Math.max(1, Number(page) || 1)
    const limitNum = Math.min(60, Math.max(10, Number(limit) || 30))
    const cacheKey = buildDiscoverFeedKey(['recommend', source, sort, pageNum, limitNum])
    const result = await getOrFetchDiscoverFeed(cacheKey, () => playlistLimiter(() => withTimeout(
      fetchRecommendPlaylists(source, String(sort), pageNum, limitNum),
      RECOMMEND_TIMEOUT_MS,
      '获取推荐歌单超时，请稍后重试',
    )))
    res.setHeader('Cache-Control', result.cached
      ? (result.stale ? 'private, max-age=30' : 'private, max-age=120')
      : 'private, max-age=15')
    res.json({
      ok: true,
      data: result.data,
      cached: result.cached,
      stale: result.stale,
    })
  } catch (e) {
    res.status(500).json({ error: formatUserError(e, '获取推荐歌单失败，请稍后重试') })
  }
})

playlistRouter.get('/', async (req, res) => {
  try {
    const { url, source = 'kw' } = req.query
    if (!url) return res.status(400).json({ error: '缺少歌单链接或 ID' })
    if (!availableSources(req)[source]) {
      return res.status(400).json({ error: `不支持的平台: ${source}` })
    }

    const partial = req.query.partial === '1' || req.query.partial === 'true'
    const cacheKey = buildPlaylistCacheKey(source, url, partial)
    const cached = getCachedPlaylist(cacheKey)
    const allowIds = req.user?.id ? getStoredActiveSourceIds(req.user.id) : null
    const loadSheet = AVAILABLE_SOURCES[source]
      ? () => fetchPlaylist(source, url, { partial })
      : () => fetchPluginSheet(source, url, allowIds)
    const data = cached || await getOrFetchPlaylist(cacheKey, () => playlistLimiter(() => withTimeout(
      loadSheet(),
      partial ? 30000 : PLAYLIST_TIMEOUT_MS,
      '获取歌单超时，请稍后重试',
    )))
    res.json({ ok: true, data, cached: Boolean(cached) })
  } catch (e) {
    res.status(500).json({ error: formatUserError(e, '获取歌单失败，请检查链接后重试') })
  }
})
