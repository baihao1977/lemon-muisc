/**
 * 跨平台同曲匹配：当前平台拿不到目标音质时，先搜其它平台同名曲再试同档，最后才降档。
 */
import { searchMusic, AVAILABLE_SOURCES } from '../musicSdk.js'
import { getDisplaySources } from './displaySources.js'
import { buildMusicInfo } from './musicInfo.js'
import {
  isSourcePlatformEnabled,
  platformsDeclaredBySource,
  PLATFORM_ORDER,
} from './enabledPlatforms.js'

const MIN_MATCH_SCORE = 60

function normalizeMatchText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, '')
    .replace(/[\[【].*?[\]】]/g, '')
    .replace(/\s+/g, '')
    .trim()
}

export function trackNameArtistScore(candidate, name, artist) {
  const cn = normalizeMatchText(candidate?.name || candidate?.songname || '')
  const ca = normalizeMatchText(candidate?.singer || candidate?.artist || '')
  const n = normalizeMatchText(name)
  const a = normalizeMatchText(artist)
  if (!cn || !n) return 0
  let score = 0
  if (cn === n) score += 100
  else if (cn.includes(n) || n.includes(cn)) score += 60
  else return 0
  if (a && ca) {
    if (ca === a || ca.includes(a) || a.includes(ca)) score += 40
    else score += 5
  }
  return score
}

export function listOnlinePlatforms(userId = null, exclude = []) {
  const skip = new Set((exclude || []).map(String).filter(Boolean))
  skip.add('local')
  const map = getDisplaySources(userId) || AVAILABLE_SOURCES
  const keys = Object.keys(map).filter((k) => k && !skip.has(k) && AVAILABLE_SOURCES[k])
  // 稳定顺序，与设置页平台顺序一致
  const ordered = PLATFORM_ORDER.filter((k) => keys.includes(k))
  const rest = keys.filter((k) => !ordered.includes(k))
  return [...ordered, ...rest]
}

/** 某激活音源可用的平台（脚本声明 ∩ 用户开关），用于「锁源后穷尽平台」 */
export function listPlatformsForSource(userId = null, sourceId = null, exclude = []) {
  const sid = String(sourceId || '').trim()
  if (!sid) return listOnlinePlatforms(userId, exclude)
  const skip = new Set((exclude || []).map(String).filter(Boolean))
  skip.add('local')
  const declared = platformsDeclaredBySource(sid)
  return declared.filter((k) => {
    if (!k || skip.has(k) || !AVAILABLE_SOURCES[k]) return false
    if (userId && !isSourcePlatformEnabled(userId, sid, k)) return false
    return true
  })
}

function searchKeywords(name, artist) {
  const n = String(name || '').trim()
  const a = String(artist || '').trim()
  const list = []
  if (n && a) list.push(`${n} ${a}`)
  if (n) list.push(n)
  return [...new Set(list.filter(Boolean))]
}

/**
 * 在指定平台搜最匹配的一首；分数不足则返回 null。
 * allowedSourceIds：限定只用这些插件音源（用于「先当前源、再其它源」）。
 */
export async function findCrossPlatformMatch({
  name,
  singer,
  artist,
  platform,
  limit = 12,
  allowedSourceIds = null,
} = {}) {
  const plat = String(platform || '').trim()
  if (!plat || plat === 'local') return null
  const title = String(name || '').trim()
  const art = String(singer || artist || '').trim()
  if (!title) return null

  const searchOpts = Array.isArray(allowedSourceIds) && allowedSourceIds.length
    ? { allowedSourceIds: allowedSourceIds.map(String).filter(Boolean) }
    : {}

  let best = null
  let bestScore = 0
  for (const keyword of searchKeywords(title, art)) {
    try {
      const result = await searchMusic(keyword, plat, 1, Math.max(8, limit), searchOpts)
      for (const row of result?.list || []) {
        const score = trackNameArtistScore(row, title, art)
        if (score > bestScore) {
          bestScore = score
          best = row
        }
      }
      if (bestScore >= 100) break
    } catch {
      // try next keyword
    }
  }
  if (!best || bestScore < MIN_MATCH_SCORE) return null
  const source = best.source || plat
  return buildMusicInfo({ ...best, source })
}

/**
 * 按平台顺序找下一首可用同曲；excludePlatforms 为已试过的平台。
 * 传入 sourceId 时只在该音源支持的平台里找（锁源穷尽平台）。
 */
export async function findNextCrossPlatformMatch({
  name,
  singer,
  artist,
  userId = null,
  excludePlatforms = [],
  sourceId = null,
} = {}) {
  const platforms = sourceId
    ? listPlatformsForSource(userId, sourceId, excludePlatforms)
    : listOnlinePlatforms(userId, excludePlatforms)
  for (const platform of platforms) {
    const hit = await findCrossPlatformMatch({ name, singer, artist, platform })
    if (hit) return hit
  }
  return null
}

/** 是否允许跨平台补源（默认开） */
export function isCrossPlatformSupplementEnabled(settings = {}) {
  return settings?.['download.isUseOtherSource'] !== 'false'
}
