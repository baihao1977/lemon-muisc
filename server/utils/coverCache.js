/**
 * 封面磁盘缓存：远程代理图 + 本地内嵌图，避免重复拉 CDN / 反复解文件。
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getAppCacheSubdir } from './appPaths.js'

const MAX_ENTRIES = 800
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000

function cacheRoot() {
  const base = process.env.CONFIG_PATH || path.join(process.cwd(), 'config')
  return getAppCacheSubdir('cover', {
    legacyPaths: [path.join(base, 'cover-cache')],
  })
}

function hashKey(parts) {
  return crypto.createHash('sha1').update(parts.filter(Boolean).join('\0')).digest('hex')
}

function filePaths(key) {
  const root = cacheRoot()
  const shard = key.slice(0, 2)
  const dir = path.join(root, shard)
  return {
    dir,
    bin: path.join(dir, `${key}.bin`),
    meta: path.join(dir, `${key}.json`),
  }
}

function touchAndTrim(key) {
  // 轻量：仅在写入时 trim，按 mtime 删最旧
  try {
    const root = cacheRoot()
    const shards = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())
    let files = []
    for (const s of shards) {
      const dir = path.join(root, s.name)
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.bin')) continue
        const bin = path.join(dir, name)
        let mtime = 0
        try { mtime = fs.statSync(bin).mtimeMs } catch { continue }
        files.push({ bin, meta: bin.replace(/\.bin$/, '.json'), mtime })
      }
    }
    if (files.length <= MAX_ENTRIES) return
    files.sort((a, b) => a.mtime - b.mtime)
    const drop = files.length - MAX_ENTRIES
    for (let i = 0; i < drop; i++) {
      try { fs.unlinkSync(files[i].bin) } catch {}
      try { fs.unlinkSync(files[i].meta) } catch {}
    }
  } catch {}
}

export function buildRemoteCoverCacheKey(url, size = 0) {
  return hashKey(['remote', String(url || ''), String(size || 0)])
}

export function buildLocalCoverCacheKey(filePath, mtimeMs = 0, size = 0) {
  return hashKey(['local', path.resolve(String(filePath || '')), String(mtimeMs || 0), String(size || 0)])
}

export function getCachedCover(key) {
  if (!key) return null
  const { bin, meta } = filePaths(key)
  try {
    if (!fs.existsSync(bin) || !fs.existsSync(meta)) return null
    const info = JSON.parse(fs.readFileSync(meta, 'utf8'))
    if (info.expiresAt && Date.now() > info.expiresAt) {
      try { fs.unlinkSync(bin) } catch {}
      try { fs.unlinkSync(meta) } catch {}
      return null
    }
    const buffer = fs.readFileSync(bin)
    if (!buffer?.length) return null
    // 刷新 mtime，便于 LRU trim
    try { fs.utimesSync(bin, new Date(), new Date()) } catch {}
    return { buffer, mime: info.mime || 'image/jpeg' }
  } catch {
    return null
  }
}

export function setCachedCover(key, buffer, mime = 'image/jpeg', ttlMs = DEFAULT_TTL_MS) {
  if (!key || !buffer?.length) return
  const { dir, bin, meta } = filePaths(key)
  try {
    fs.mkdirSync(dir, { recursive: true })
    const tmp = `${bin}.${process.pid}.tmp`
    fs.writeFileSync(tmp, buffer)
    fs.renameSync(tmp, bin)
    fs.writeFileSync(meta, JSON.stringify({
      mime: mime || 'image/jpeg',
      size: buffer.length,
      expiresAt: Date.now() + ttlMs,
      at: Date.now(),
    }))
    touchAndTrim(key)
  } catch {}
}
