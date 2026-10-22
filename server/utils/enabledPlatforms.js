import { AVAILABLE_SOURCES } from '../musicSdk.js'
import { getMergedSettings, setUserSettings } from './userSettings.js'
import { getStoredActiveSourceIds } from './activeSources.js'
import { getActiveSources } from '../sourceManager.js'
import {
  CORE_PLATFORM_ORDER,
  isValidPlatformKey,
  orderPlatformKeys,
  platformDisplayName,
} from './platformCatalog.js'

export const ENABLED_PLATFORMS_KEY = 'source.enabledPlatforms'
export const AUTO_CLOSED_KEY = 'source.autoClosedPlatforms'
export const AUTO_CLOSE_SKIP_KEY = 'source.previewAutoCloseSkip'

/** 内置五家顺序；完整列表见 allPlatformKeys() */
export const PLATFORM_ORDER = CORE_PLATFORM_ORDER

function declaredKeysFromActiveSources() {
  const keys = []
  try {
    for (const entry of getActiveSources()) {
      for (const k of Object.keys(entry?.sources || {})) keys.push(k)
    }
  } catch {}
  return keys
}

export function allPlatformKeys() {
  const core = CORE_PLATFORM_ORDER.filter((k) => AVAILABLE_SOURCES[k])
  return orderPlatformKeys([...core, ...declaredKeysFromActiveSources()])
}

function parseJson(raw, fallback) {
  if (raw == null || raw === '') return fallback
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

/** @returns {Record<string, string[]>} sourceId → enabled platforms */
export function parseSourcePlatformMap(raw) {
  const data = parseJson(raw, null)

  // 兼容旧版全局数组 ["tx","wy"]
  if (Array.isArray(data)) {
    const global = orderPlatformKeys(data.map(String).filter((k) => isValidPlatformKey(k)))
    return { __global__: global }
  }
  if (!data || typeof data !== 'object') return {}

  const out = {}
  for (const [id, list] of Object.entries(data)) {
    if (!id || id === '__global__') continue
    if (!Array.isArray(list)) continue
    out[String(id)] = orderPlatformKeys(list.map(String).filter((k) => isValidPlatformKey(k)))
  }
  return out
}

export function getSourcePlatformMap(userId = null) {
  if (!userId) return {}
  try {
    const settings = getMergedSettings(userId)
    return parseSourcePlatformMap(settings[ENABLED_PLATFORMS_KEY])
  } catch {
    return {}
  }
}

/** 音源脚本声明的平台；无声明时视为全部 */
export function platformsDeclaredBySource(sourceId) {
  const all = allPlatformKeys()
  try {
    const entry = getActiveSources().find((s) => s.id === sourceId)
    const keys = Object.keys(entry?.sources || {}).filter((k) => isValidPlatformKey(k))
    if (keys.length) return orderPlatformKeys(keys)
  } catch {}
  return [...all]
}

/**
 * 某音源对某平台是否允许解析。
 * 未配置时默认开启（脚本声明的全部平台）。
 */
export function isSourcePlatformEnabled(userId, sourceId, platform) {
  const key = String(platform || '').trim()
  if (!key || key === 'local' || key === 'podcast') return true
  if (!isValidPlatformKey(key)) return true
  const sid = String(sourceId || '').trim()
  if (!sid || !userId) return true

  const map = getSourcePlatformMap(userId)
  const declared = platformsDeclaredBySource(sid)
  const extraDeclared = declared.filter((k) => !CORE_PLATFORM_ORDER.includes(k))
  if (Object.prototype.hasOwnProperty.call(map, sid)) {
    if (map[sid].includes(key)) return true
    return extraDeclared.includes(key)
  }
  // 旧版全局开关：对所有音源生效
  if (Object.prototype.hasOwnProperty.call(map, '__global__')) {
    if (map.__global__.includes(key)) return true
    return extraDeclared.includes(key)
  }
  return platformsDeclaredBySource(sid).includes(key)
}

/** 当前用户「至少有一个激活音源允许」的平台并集 */
export function getEnabledPlatforms(userId = null) {
  const all = allPlatformKeys()
  if (!userId) return [...all]
  const activeIds = getStoredActiveSourceIds(userId)
  if (!activeIds.length) return [...all]

  const map = getSourcePlatformMap(userId)
  const enabled = new Set()
  for (const id of activeIds) {
    let list
    if (Object.prototype.hasOwnProperty.call(map, id)) list = map[id]
    else if (Object.prototype.hasOwnProperty.call(map, '__global__')) list = map.__global__
    else list = platformsDeclaredBySource(id)
    const declared = platformsDeclaredBySource(id)
    const extra = declared.filter((k) => !CORE_PLATFORM_ORDER.includes(k))
    for (const p of [...list, ...extra]) enabled.add(p)
  }
  return orderPlatformKeys([...enabled])
}

export function isPlatformEnabled(userId, platform) {
  const key = String(platform || '').trim()
  if (!key || key === 'local' || key === 'podcast') return true
  if (!isValidPlatformKey(key)) return true
  return getEnabledPlatforms(userId).includes(key)
}

export function serializeSourcePlatformMap(map) {
  const out = {}
  for (const [id, list] of Object.entries(map || {})) {
    if (!id || id === '__global__') continue
    out[id] = orderPlatformKeys((list || []).filter((k) => isValidPlatformKey(k)))
  }
  return JSON.stringify(out)
}

function parseAutoClosedMap(raw) {
  const data = parseJson(raw, null)
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  const out = {}
  for (const [sid, plats] of Object.entries(data)) {
    if (!sid || !plats || typeof plats !== 'object') continue
    const src = {}
    for (const [plat, info] of Object.entries(plats)) {
      if (!isValidPlatformKey(plat) || !info || typeof info !== 'object') continue
      src[plat] = {
        at: String(info.at || ''),
        label: String(info.label || plat),
        dismissed: Boolean(info.dismissed),
      }
    }
    if (Object.keys(src).length) out[sid] = src
  }
  return out
}

function parseSkipMap(raw) {
  const data = parseJson(raw, null)
  if (!data || typeof data !== 'object') return {}
  const out = {}
  for (const [sid, list] of Object.entries(data)) {
    if (!sid || !Array.isArray(list)) continue
    out[sid] = orderPlatformKeys(list.map(String).filter((k) => isValidPlatformKey(k)))
  }
  return out
}

function getAutoClosedMap(userId) {
  if (!userId) return {}
  try {
    return parseAutoClosedMap(getMergedSettings(userId)[AUTO_CLOSED_KEY])
  } catch {
    return {}
  }
}

function getSkipMap(userId) {
  if (!userId) return {}
  try {
    return parseSkipMap(getMergedSettings(userId)[AUTO_CLOSE_SKIP_KEY])
  } catch {
    return {}
  }
}

export function getAutoClosedPlatformsPublic(userId, sourceId) {
  const src = getAutoClosedMap(userId)[String(sourceId || '')] || {}
  return Object.entries(src)
    .filter(([, info]) => info && !info.dismissed)
    .map(([id, info]) => ({ id, label: info.label || id, at: info.at || '' }))
}

/**
 * 某平台被判定为「多为试听」时，自动关闭该音源对该平台的解析。
 * 用户手动重新打开后，在健康恢复前不会再次自动关闭。
 */
export function applyPreviewAutoClose(userId, sourceId, platform, label = '') {
  const uid = userId || null
  const sid = String(sourceId || '').trim()
  const plat = String(platform || '').trim()
  if (!uid || !sid || !plat || !isValidPlatformKey(plat)) return { closed: false }

  const skip = new Set(getSkipMap(uid)[sid] || [])
  if (skip.has(plat)) return { closed: false }

  const map = getSourcePlatformMap(uid)
  let current
  if (Object.prototype.hasOwnProperty.call(map, sid)) current = [...map[sid]]
  else if (Object.prototype.hasOwnProperty.call(map, '__global__')) current = [...map.__global__]
  else current = platformsDeclaredBySource(sid)

  if (!current.includes(plat)) return { closed: false }

  map[sid] = current.filter((k) => k !== plat)
  const notices = getAutoClosedMap(uid)
  notices[sid] = {
    ...(notices[sid] || {}),
    [plat]: {
      at: new Date().toISOString(),
      label: label || platformDisplayName(plat) || plat,
      dismissed: false,
    },
  }
  setUserSettings(uid, {
    [ENABLED_PLATFORMS_KEY]: serializeSourcePlatformMap(map),
    [AUTO_CLOSED_KEY]: JSON.stringify(notices),
  })
  return { closed: true }
}

/** 用户手动打开已被自动关闭的平台后，记入跳过，避免立刻再关 */
export function syncPreviewAutoCloseOverrides(userId, nextPlatformMap) {
  if (!userId) return
  const notices = getAutoClosedMap(userId)
  const skip = getSkipMap(userId)
  let changed = false
  for (const [sid, closed] of Object.entries(notices)) {
    const enabled = Array.isArray(nextPlatformMap?.[sid]) ? nextPlatformMap[sid] : null
    if (!enabled) continue
    for (const plat of Object.keys(closed)) {
      if (!enabled.includes(plat)) continue
      delete closed[plat]
      skip[sid] = [...new Set([...(skip[sid] || []), plat])]
      changed = true
    }
    if (!Object.keys(closed).length) delete notices[sid]
  }
  if (!changed) return
  setUserSettings(userId, {
    [AUTO_CLOSED_KEY]: JSON.stringify(notices),
    [AUTO_CLOSE_SKIP_KEY]: JSON.stringify(skip),
  })
}

export function dismissAutoClosedPlatforms(userId, sourceId) {
  const uid = userId || null
  const sid = String(sourceId || '').trim()
  if (!uid || !sid) return
  const notices = getAutoClosedMap(uid)
  const src = notices[sid]
  if (!src) return
  for (const info of Object.values(src)) {
    if (info) info.dismissed = true
  }
  setUserSettings(uid, { [AUTO_CLOSED_KEY]: JSON.stringify(notices) })
}

/** 该平台健康恢复后，允许下次再自动关闭 */
export function clearPreviewAutoCloseSkip(userId, sourceId, platform) {
  const uid = userId || null
  const sid = String(sourceId || '').trim()
  const plat = String(platform || '').trim()
  if (!uid || !sid || !plat) return
  const skip = getSkipMap(uid)
  const list = skip[sid] || []
  if (!list.includes(plat)) return
  skip[sid] = list.filter((k) => k !== plat)
  if (!skip[sid].length) delete skip[sid]
  setUserSettings(uid, { [AUTO_CLOSE_SKIP_KEY]: JSON.stringify(skip) })
}
