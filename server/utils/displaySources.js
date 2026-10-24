import { AVAILABLE_SOURCES } from '../musicSdk.js'
import {
  getMergedSources,
  hasActiveSource,
  getActiveSources,
  hasPluginSource,
} from '../sourceManager.js'
import { getStoredActiveSourceIds } from './activeSources.js'
import { getEnabledPlatforms, isSourcePlatformEnabled } from './enabledPlatforms.js'
import { platformDisplayName } from './platformCatalog.js'

function resolveSourceDisplayName(key, scriptName) {
  const fallback = AVAILABLE_SOURCES[key]?.name || platformDisplayName(key)
  const custom = String(scriptName || '').trim()
  if (!custom || custom === key) return fallback
  return custom
}

function allAvailableSources() {
  const base = {}
  for (const [key, info] of Object.entries(AVAILABLE_SOURCES)) {
    base[key] = { ...info, searchable: true }
  }
  return base
}

function filterByEnabledPlatforms(sources, userId) {
  if (!userId || !sources || typeof sources !== 'object') return sources
  const enabled = new Set(getEnabledPlatforms(userId))
  const result = {}
  for (const [key, info] of Object.entries(sources)) {
    if (enabled.has(key)) result[key] = info
  }
  return result
}

/** 仅取链、不能搜的扩展平台（星海 qs 等）；有 MusicFree 同名可搜插件时才展示 */
const PLAY_ONLY_EXTENDED = new Set(['qs', 'bili', 'ytb', 'xm'])

function toDisplayEntry(key, info = {}) {
  const builtin = AVAILABLE_SOURCES[key]
  return {
    ...(builtin || { name: platformDisplayName(key, info), key }),
    name: resolveSourceDisplayName(key, info.name),
    qualitys: info.qualitys || [],
    actions: info.actions || [],
    searchable: Boolean(builtin) || info.searchable === true,
  }
}

function canShowInSearchTabs(key, info, allowedIds) {
  if (info?.searchable !== false) return true
  // 脚本未标 searchable：仅当存在可搜索的 MusicFree 插件时才显示（否则无搜索/无下载入口）
  if (PLAY_ONLY_EXTENDED.has(key) && hasPluginSource(key, allowedIds)) return true
  return false
}

/** 按用户平台开关裁剪合并后的音源能力 */
export function getMergedSourcesForUser(userId, allowedSourceIds = null) {
  const allow = Array.isArray(allowedSourceIds)
    ? new Set(allowedSourceIds.map(String))
    : null
  const merged = {}
  for (const entry of getActiveSources()) {
    if (allow && !allow.has(entry.id)) continue
    for (const [key, info] of Object.entries(entry.sources || {})) {
      if (userId && !isSourcePlatformEnabled(userId, entry.id, key)) continue
      if (!merged[key]) {
        merged[key] = {
          name: info.name || key,
          type: info.type || 'music',
          actions: [...(info.actions || [])],
          qualitys: [...(info.qualitys || [])],
          searchable: info.searchable === true,
        }
        continue
      }
      const cur = merged[key]
      for (const a of info.actions || []) {
        if (!cur.actions.includes(a)) cur.actions.push(a)
      }
      for (const q of info.qualitys || []) {
        if (!cur.qualitys.includes(q)) cur.qualitys.push(q)
      }
      if (info.searchable) cur.searchable = true
    }
  }
  return merged
}

/** 搜索/发现/歌单页展示的平台：按当前用户已激活音源 + 各音源平台开关过滤 */
export function getDisplaySources(userId = null) {
  const allowedIds = userId ? getStoredActiveSourceIds(userId) : null
  let base

  if (!Array.isArray(allowedIds) || !allowedIds.length || !hasActiveSource(allowedIds)) {
    base = allAvailableSources()
  } else {
    const merged = userId
      ? getMergedSourcesForUser(userId, allowedIds)
      : getMergedSources(allowedIds)
    const keys = Object.keys(merged)
    if (!keys.length) {
      return {}
    }
    base = {}
    for (const key of keys) {
      base[key] = toDisplayEntry(key, merged[key] || {})
    }
  }

  const enabled = filterByEnabledPlatforms(base, userId)
  const searchable = {}
  for (const [key, info] of Object.entries(enabled || {})) {
    if (!canShowInSearchTabs(key, info, allowedIds)) continue
    searchable[key] = info?.searchable === false
      ? { ...info, searchable: true }
      : info
  }
  return searchable
}
