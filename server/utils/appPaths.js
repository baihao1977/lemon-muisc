import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function getConfigRoot() {
  const fromEnv = String(process.env.CONFIG_PATH || '').trim()
  if (fromEnv) return path.resolve(fromEnv)
  return path.resolve(path.join(process.cwd(), 'config'))
}

let cachedAppCacheDir = ''

/**
 * 应用磁盘缓存根目录：CONFIG_PATH/cache（飞牛 @appdata/…/config/cache）。
 * 勿写入用户音乐库 / 下载目录，避免扫库误收转码半成品。
 */
export function getAppCacheDir() {
  if (cachedAppCacheDir) return cachedAppCacheDir
  const dir = path.join(getConfigRoot(), 'cache')
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {}
  cachedAppCacheDir = dir
  return dir
}

/**
 * 缓存子目录。若提供 legacyPaths，旧路径存在且新路径为空时会尽量迁移（rename）。
 * @param {string} name
 * @param {{ legacyPaths?: string[] }} [opts]
 */
export function getAppCacheSubdir(name, { legacyPaths = [] } = {}) {
  const dir = path.join(getAppCacheDir(), String(name || 'misc'))

  for (const legacy of legacyPaths) {
    const oldPath = String(legacy || '').trim()
    if (!oldPath || path.resolve(oldPath) === path.resolve(dir)) continue
    try {
      if (!fs.existsSync(oldPath)) continue
      const st = fs.statSync(oldPath)
      if (!st.isDirectory()) continue
      const entries = fs.readdirSync(oldPath)
      if (!entries.length) {
        try { fs.rmdirSync(oldPath) } catch {}
        continue
      }
      let destExists = false
      let destEmpty = true
      try {
        if (fs.existsSync(dir)) {
          destExists = true
          destEmpty = fs.readdirSync(dir).length === 0
        }
      } catch {}
      if (!destExists || destEmpty) {
        try {
          if (destExists && destEmpty) fs.rmdirSync(dir)
          fs.renameSync(oldPath, dir)
        } catch {
          // 跨设备 rename 失败：继续用新目录，旧缓存留在原处
        }
      }
    } catch {}
  }

  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {}
  return dir
}

let cachedExcludeRoots = null

function getAppCacheExcludeRoots() {
  if (cachedExcludeRoots) return cachedExcludeRoots
  const config = getConfigRoot()
  cachedExcludeRoots = [
    path.join(config, 'cache'),
    path.join(config, 'cover-cache'),
    path.join(config, 'discover-feed-cache'),
    path.join(config, 'download-staging'),
  ].map((p) => path.resolve(p))
  return cachedExcludeRoots
}

/** 解析后的绝对路径是否落在应用缓存根下（含旧版 config 旁缓存目录名） */
export function isUnderAppCachePath(filePath) {
  const resolved = path.resolve(String(filePath || ''))
  if (!resolved) return false
  for (const root of getAppCacheExcludeRoots()) {
    if (resolved === root || resolved.startsWith(root + path.sep)) return true
  }
  return false
}

/**
 * 解析当前设备上的应用日志目录（飞牛 @appdata/log 或本地开发目录）。
 */
export function getAppLogDir() {
  const fromEnv = String(process.env.LOG_PATH || '').trim()
  if (fromEnv) return path.resolve(fromEnv)

  const pkgvar = String(process.env.TRIM_PKGVAR || process.env.PKGVAR_PATH || '').trim()
  if (pkgvar) return path.resolve(pkgvar, 'log')

  const config = String(process.env.CONFIG_PATH || '').trim()
  if (config && (process.env.LEMON_NATIVE === '1' || /@appdata/i.test(config))) {
    return path.resolve(path.dirname(path.resolve(config)), 'log')
  }

  // 本地开发：优先仓库旁 data/log，否则 config 旁
  const candidates = [
    path.join(__dirname, '..', '..', 'data', 'log'),
    path.join(__dirname, '..', '..', 'log'),
  ]
  if (config) candidates.unshift(path.resolve(path.dirname(path.resolve(config)), 'log'))
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir)) return dir
    } catch {}
  }
  return candidates[0]
}

/** 常见日志文件名（用于提示用户） */
const MAIN_LOG_NAMES = ['app.log', 'runtime.log', 'npm-install.log', 'install.log', 'config.log']

export function readLogTail(filePath, maxBytes = 80 * 1024) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return ''
    const size = fs.statSync(filePath).size || 0
    if (size <= 0) return ''
    const start = Math.max(0, size - maxBytes)
    const fd = fs.openSync(filePath, 'r')
    try {
      const len = size - start
      const buf = Buffer.alloc(len)
      fs.readSync(fd, buf, 0, len, start)
      let text = buf.toString('utf8')
      if (start > 0) {
        const nl = text.indexOf('\n')
        if (nl >= 0 && nl < text.length - 1) text = text.slice(nl + 1)
      }
      return text
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return ''
  }
}

export function getAppLogInfo() {
  const logDir = getAppLogDir()
  let exists = false
  try {
    exists = fs.existsSync(logDir)
  } catch {}

  const files = []
  if (exists) {
    for (const name of MAIN_LOG_NAMES) {
      const fp = path.join(logDir, name)
      try {
        if (fs.existsSync(fp)) {
          const st = fs.statSync(fp)
          files.push({
            name,
            path: fp,
            size: st.size || 0,
          })
        }
      } catch {}
    }
  }

  return {
    logDir,
    exists,
    appLog: path.join(logDir, 'app.log'),
    files,
  }
}
