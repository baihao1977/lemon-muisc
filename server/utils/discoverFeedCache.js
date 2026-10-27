/**
 * 发现页 Feed 缓存：内存 + 磁盘落盘。
 * - 新鲜命中：直接返回
 * - 过期但仍有盘：立刻返回旧数据，并后台刷新（SWR）
 * - 无缓存：拉取后落盘
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getAppCacheSubdir } from './appPaths.js'

const FRESH_TTL_MS = 15 * 60 * 1000
const STALE_TTL_MS = 24 * 60 * 60 * 1000
const MAX_ENTRIES = 120

/** @type {Map<string, { data: object, freshUntil: number, staleUntil: number }>} */
const cache = new Map()
/** @type {Map<string, Promise<{ data: object, cached: boolean, stale: boolean }>>} */
const inflight = new Map()
/** @type {Set<string>} */
const refreshing = new Set()

function cacheRoot() {
  const base = process.env.CONFIG_PATH || path.join(process.cwd(), 'config')
  return getAppCacheSubdir('discover-feed', {
    legacyPaths: [path.join(base, 'discover-feed-cache')],
  })
}

function fileForKey(key) {
  const hash = crypto.createHash('sha1').update(String(key)).digest('hex')
  const shard = hash.slice(0, 2)
  const dir = path.join(cacheRoot(), shard)
  return { dir, file: path.join(dir, `${hash}.json`) }
}

function touchOrder(key) {
  const entry = cache.get(key)
  if (!entry) return
  cache.delete(key)
  cache.set(key, entry)
}

function trimToMax() {
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
}

function readDiskEntry(key) {
  try {
    const { file } = fileForKey(key)
    if (!fs.existsSync(file)) return null
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!raw || raw.data == null) return null
    return {
      data: raw.data,
      freshUntil: Number(raw.freshUntil) || 0,
      staleUntil: Number(raw.staleUntil) || 0,
    }
  } catch {
    return null
  }
}

function writeDiskEntry(key, entry) {
  try {
    const { dir, file } = fileForKey(key)
    fs.mkdirSync(dir, { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({
      key,
      data: entry.data,
      freshUntil: entry.freshUntil,
      staleUntil: entry.staleUntil,
      at: Date.now(),
    }))
    fs.renameSync(tmp, file)
  } catch {}
}

function loadIntoMemory(key) {
  const disk = readDiskEntry(key)
  if (!disk) return null
  if (Date.now() > disk.staleUntil) {
    try { fs.unlinkSync(fileForKey(key).file) } catch {}
    return null
  }
  cache.set(key, disk)
  trimToMax()
  return disk
}

export function buildDiscoverFeedKey(parts = []) {
  return parts.map((p) => String(p ?? '')).join(':')
}

export function getFreshDiscoverFeed(key) {
  let entry = cache.get(key)
  if (!entry) entry = loadIntoMemory(key)
  if (!entry) return null
  if (Date.now() > entry.freshUntil) return null
  touchOrder(key)
  return entry.data
}

/** 新鲜窗口已过、仍在 stale 窗口内的数据 */
export function getStaleDiscoverFeed(key) {
  let entry = cache.get(key)
  if (!entry) entry = loadIntoMemory(key)
  if (!entry) return null
  if (Date.now() > entry.staleUntil) {
    cache.delete(key)
    try { fs.unlinkSync(fileForKey(key).file) } catch {}
    return null
  }
  touchOrder(key)
  return entry.data
}

export function setDiscoverFeed(key, data, {
  freshTtlMs = FRESH_TTL_MS,
  staleTtlMs = STALE_TTL_MS,
} = {}) {
  if (!key || data == null) return
  const now = Date.now()
  const entry = {
    data,
    freshUntil: now + freshTtlMs,
    staleUntil: now + Math.max(freshTtlMs, staleTtlMs),
  }
  cache.set(key, entry)
  trimToMax()
  writeDiskEntry(key, entry)
}

function scheduleBackgroundRefresh(key, fetcher) {
  if (!key || typeof fetcher !== 'function') return
  if (inflight.has(key) || refreshing.has(key)) return
  refreshing.add(key)
  Promise.resolve()
    .then(fetcher)
    .then((data) => {
      if (data != null) setDiscoverFeed(key, data)
    })
    .catch(() => {})
    .finally(() => {
      refreshing.delete(key)
    })
}

/**
 * 有新鲜缓存直接返回；有过期缓存则立刻返回并后台刷新；否则拉取。
 */
export async function getOrFetchDiscoverFeed(key, fetcher) {
  const fresh = getFreshDiscoverFeed(key)
  if (fresh != null) return { data: fresh, cached: true, stale: false }

  const stale = getStaleDiscoverFeed(key)
  if (stale != null) {
    scheduleBackgroundRefresh(key, fetcher)
    return { data: stale, cached: true, stale: true }
  }

  const pending = inflight.get(key)
  if (pending) return pending

  const promise = Promise.resolve()
    .then(fetcher)
    .then((data) => {
      setDiscoverFeed(key, data)
      return { data, cached: false, stale: false }
    })
    .catch((err) => {
      const again = getStaleDiscoverFeed(key)
      if (again != null) return { data: again, cached: true, stale: true }
      throw err
    })
    .finally(() => {
      inflight.delete(key)
    })

  inflight.set(key, promise)
  return promise
}

/** 预热专用：强制拉取并写入磁盘（忽略新鲜命中） */
export async function forceFetchDiscoverFeed(key, fetcher) {
  if (!key || typeof fetcher !== 'function') return null
  const pending = inflight.get(key)
  if (pending) {
    try { return (await pending).data } catch { return getStaleDiscoverFeed(key) }
  }
  const promise = Promise.resolve()
    .then(fetcher)
    .then((data) => {
      setDiscoverFeed(key, data)
      return { data, cached: false, stale: false }
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, promise)
  const result = await promise
  return result.data
}

export function getDiscoverFeedCacheStats() {
  let diskFiles = 0
  try {
    const root = cacheRoot()
    for (const shard of fs.readdirSync(root, { withFileTypes: true })) {
      if (!shard.isDirectory()) continue
      diskFiles += fs.readdirSync(path.join(root, shard.name)).filter((n) => n.endsWith('.json')).length
    }
  } catch {}
  return {
    size: cache.size,
    diskFiles,
    maxEntries: MAX_ENTRIES,
    inflight: inflight.size,
    refreshing: refreshing.size,
    freshTtlMs: FRESH_TTL_MS,
    staleTtlMs: STALE_TTL_MS,
    root: cacheRoot(),
  }
}
