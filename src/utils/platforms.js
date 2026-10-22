import { ref } from 'vue'

/** 内置搜索/发现 SDK 覆盖的平台 */
export const PLATFORM_ORDER = ['tx', 'wy', 'kw', 'kg', 'mg']

/** 平台 key → 界面显示名 */
export const PLATFORM_LABELS = {
  kw: '酷我',
  kg: '酷狗',
  tx: 'QQ音乐',
  wy: '网易云',
  mg: '咪咕',
  qs: '汽水',
  bili: 'B站',
  ytb: 'YouTube',
  xm: '喜马拉雅',
}

export const ENABLED_PLATFORMS_KEY = 'source.enabledPlatforms'

const PLATFORM_KEY_RE = /^[a-z][a-z0-9_-]{0,15}$/i

/** 运行时从搜索/发现源列表注入的显示名（MusicFree 的 mf******** 等） */
const runtimePlatformLabels = Object.create(null)
/** 变更计数，供 computed 依赖，注册后播放栏会刷新 */
export const platformLabelEpoch = ref(0)

export function isValidPlatformKey(key) {
  const k = String(key || '').trim()
  if (!k || k === 'local' || k === 'podcast') return false
  return PLATFORM_KEY_RE.test(k)
}

/**
 * 用 /search/sources 等返回的 { key: { name } } 注册可读平台名，
 * 避免播放栏等处只显示内部 key（如 mf53c4f95a）。
 */
export function registerPlatformLabels(sourcesMap) {
  if (!sourcesMap || typeof sourcesMap !== 'object') return
  let changed = false
  for (const [rawKey, info] of Object.entries(sourcesMap)) {
    const key = String(rawKey || '').trim()
    if (!key) continue
    const name = String(
      (typeof info === 'string' ? info : (info?.name || info?.label || '')),
    ).trim()
    if (name && name !== key && runtimePlatformLabels[key] !== name) {
      runtimePlatformLabels[key] = name
      changed = true
    }
  }
  if (changed) platformLabelEpoch.value += 1
}

/** 优先标准中文名；音源脚本 name 为 key 或空时回退 */
export function platformLabel(key, info = {}) {
  const k = String(key || '').trim()
  if (!k) return ''
  const custom = String(info?.name || '').trim()
  if (custom && custom !== k) return custom
  if (PLATFORM_LABELS[k]) return PLATFORM_LABELS[k]
  if (runtimePlatformLabels[k]) return runtimePlatformLabels[k]
  return k
}

export function orderPlatformKeys(keys, hintOrder = []) {
  const seen = new Set()
  const out = []
  const push = (raw) => {
    const k = String(raw || '').trim()
    if (!isValidPlatformKey(k) || seen.has(k)) return
    seen.add(k)
    out.push(k)
  }
  for (const k of PLATFORM_ORDER) {
    if ((keys || []).includes(k)) push(k)
  }
  for (const k of hintOrder) push(k)
  for (const k of keys || []) push(k)
  return out
}

/** 歌单导入平台选项（API 无数据时的兜底，应与已激活音源一致） */
export const PLAYLIST_PLATFORM_OPTIONS = PLATFORM_ORDER
  .filter((value) => PLATFORM_LABELS[value])
  .map((value) => ({ value, label: PLATFORM_LABELS[value] }))

/** @returns {Record<string, string[]>} */
export function parseSourcePlatformMap(raw) {
  if (raw == null || raw === '') return {}
  let data = raw
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw) } catch { return {} }
  }
  if (Array.isArray(data)) {
    return { __global__: orderPlatformKeys(data.map(String)) }
  }
  if (!data || typeof data !== 'object') return {}
  const out = {}
  for (const [id, list] of Object.entries(data)) {
    if (!id) continue
    if (!Array.isArray(list)) continue
    out[String(id)] = orderPlatformKeys(list.map(String))
  }
  return out
}

export function serializeSourcePlatformMap(map) {
  const out = {}
  for (const [id, list] of Object.entries(map || {})) {
    if (!id || id === '__global__') continue
    out[id] = orderPlatformKeys(list || [])
  }
  return JSON.stringify(out)
}

/** 音源声明的平台列表（按脚本，不限于内置五家） */
export function platformsOfSource(source) {
  const keys = Object.keys(source?.sources || {}).filter((k) => isValidPlatformKey(k))
  if (keys.length) return orderPlatformKeys(keys)
  return [...PLATFORM_ORDER]
}
