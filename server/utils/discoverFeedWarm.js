/**
 * 发现页后台预热：周期性把推荐/新歌/新碟/榜单写入磁盘缓存，
 * 用户打开时优先读盘，避免当场打音源。
 */
import {
  fetchNewSongs,
  fetchNewAlbums,
  fetchToplists,
} from '../discoverSdk.js'
import { AVAILABLE_SOURCES, fetchRecommendPlaylists } from '../musicSdk.js'
import { getActiveSources } from '../sourceManager.js'
import { createLimiter, withTimeout } from './asyncLimit.js'
import {
  buildDiscoverFeedKey,
  forceFetchDiscoverFeed,
  getDiscoverFeedCacheStats,
} from './discoverFeedCache.js'

const WARM_TIMEOUT_MS = 18000
const WARM_INTERVAL_MS = 12 * 60 * 1000
/** 首次预热再等一会儿，避开用户刚打开应用时的 IO */
const WARM_INITIAL_DELAY_MS = 30 * 1000

const warmLimiter = createLimiter(2)
let timer = null
let running = false
let lastRunAt = 0
let lastError = ''

function defaultSongRegion(source) {
  if (source === 'tx') return 'latest'
  if (source === 'wy') return '0'
  return ''
}

function defaultAlbumRegion(source) {
  if (source === 'tx') return 'inland'
  if (source === 'wy') return 'ALL'
  return ''
}

function listWarmSources() {
  const keys = new Set()
  for (const entry of getActiveSources() || []) {
    for (const key of Object.keys(entry.sources || {})) {
      if (AVAILABLE_SOURCES[key]) keys.add(key)
    }
  }
  // 无激活音源时仍预热常见平台，便于首次激活后立刻有盘缓存
  if (!keys.size) {
    for (const key of ['tx', 'wy', 'kg', 'kw', 'mg']) {
      if (AVAILABLE_SOURCES[key]) keys.add(key)
    }
  }
  return [...keys]
}

function buildWarmJobs(source) {
  const jobs = []
  const songRegion = defaultSongRegion(source)
  const albumRegion = defaultAlbumRegion(source)

  for (const sort of ['new', 'hot']) {
    jobs.push({
      key: buildDiscoverFeedKey(['recommend', source, sort, 1, 20]),
      run: () => fetchRecommendPlaylists(source, sort, 1, 20),
      label: `recommend:${source}:${sort}`,
    })
  }
  jobs.push({
    key: buildDiscoverFeedKey(['newsongs', source, songRegion, 1, 27]),
    run: () => fetchNewSongs(source, songRegion, 1, 27),
    label: `newsongs:${source}`,
  })
  jobs.push({
    key: buildDiscoverFeedKey(['newalbums', source, albumRegion, 1, 20]),
    run: () => fetchNewAlbums(source, albumRegion, 1, 20),
    label: `newalbums:${source}`,
  })
  jobs.push({
    key: buildDiscoverFeedKey(['toplists', source]),
    run: () => fetchToplists(source),
    label: `toplists:${source}`,
  })
  return jobs
}

async function runWarmJob(job) {
  await forceFetchDiscoverFeed(job.key, () => warmLimiter(() => withTimeout(
    job.run(),
    WARM_TIMEOUT_MS,
    `${job.label} 预热超时`,
  )))
}

export async function warmDiscoverFeedsOnce({ reason = 'manual' } = {}) {
  if (running) return { skipped: true, reason: 'busy' }
  running = true
  lastError = ''
  const started = Date.now()
  const sources = listWarmSources()
  let ok = 0
  let fail = 0
  try {
    for (const source of sources) {
      for (const job of buildWarmJobs(source)) {
        try {
          await runWarmJob(job)
          ok++
        } catch (e) {
          fail++
          lastError = e?.message || String(e)
        }
      }
    }
    lastRunAt = Date.now()
    console.log(`[discover-warm] ${reason}: sources=${sources.join(',') || '-'} ok=${ok} fail=${fail} ${Date.now() - started}ms`)
    return { ok, fail, sources, ms: Date.now() - started }
  } finally {
    running = false
  }
}

export function startDiscoverFeedWarm() {
  if (timer) return
  const tick = () => {
    warmDiscoverFeedsOnce({ reason: 'interval' }).catch(() => {})
  }
  setTimeout(() => {
    tick()
    timer = setInterval(tick, WARM_INTERVAL_MS)
    timer.unref?.()
  }, WARM_INITIAL_DELAY_MS).unref?.()
  console.log(`[discover-warm] scheduled (first in ${WARM_INITIAL_DELAY_MS / 1000}s, every ${WARM_INTERVAL_MS / 60000}min)`)
}

export function stopDiscoverFeedWarm() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export function getDiscoverFeedWarmStatus() {
  return {
    running,
    lastRunAt: lastRunAt || null,
    lastError: lastError || '',
    intervalMs: WARM_INTERVAL_MS,
    cache: getDiscoverFeedCacheStats(),
  }
}
