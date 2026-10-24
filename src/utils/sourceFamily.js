/**
 * MusicFree 分平台插件（如万象 plugins.json 展开的「卍-酷狗 / 卍-QQ」）在列表里合成一个「源」。
 */
import { shortenPlatformDisplayName } from './platforms.js'

function cleanPrefix(raw) {
  return String(raw || '')
    .replace(/^[卍★☆※◆◇●○\s]+/, '')
    .trim()
}

/** 是否像「一个脚本只包一个平台」的 MusicFree 分片插件 */
export function looksLikeSplitMusicFreePlugin(source) {
  const name = String(source?.name || '')
  const author = String(source?.author || '')
  if (/万象/i.test(author) || /万象/i.test(name)) return true
  if (/^[卍★☆※].*[-_—－]/.test(name)) return true
  if (/(?:音乐源|音源|插件)[-_—－]/.test(name)) return true
  return false
}

/**
 * 家族键：同作者 + 名称前缀（或万象）可合并；否则各自独立。
 */
export function sourceFamilyKey(source) {
  const author = String(source?.author || '').trim()
  const name = String(source?.name || '').trim()
  const desc = String(source?.description || '').trim()
  if (/万象/i.test(author) || /万象/i.test(name) || /万象/i.test(desc)) {
    return 'family:wanxiang'
  }
  const branded = name.match(/^(.+?)[-_—－\/](.+)$/)
  if (author && branded?.[1] && branded?.[2]) {
    const prefix = cleanPrefix(branded[1]) || branded[1].trim()
    if (prefix) return `family:${author}::${prefix}`
  }
  return `solo:${source?.id || name || Math.random()}`
}

export function sourceFamilyDisplayName(key, members = []) {
  if (key === 'family:wanxiang') return '万象源'
  if (String(key || '').startsWith('family:')) {
    const rest = key.slice('family:'.length)
    const [author, prefix] = rest.split('::')
    const clean = cleanPrefix(prefix || '')
    if (clean) return /源$/.test(clean) ? clean : `${clean}源`
    const a = String(author || members[0]?.author || '').trim()
    if (/API$/i.test(a)) return a.replace(/API$/i, '源')
    if (a) return /源$/.test(a) ? a : `${a}源`
  }
  return members[0]?.name || '音源'
}

/** 分片插件在合集里显示的平台短名：卍-网易 → 网易 */
export function memberPlatformLabel(member) {
  const raw = String(member?.name || '').trim()
  const short = shortenPlatformDisplayName(raw)
  return short || raw || '平台'
}

function versionRank(v) {
  return String(v || '')
    .replace(/^v/i, '')
    .split(/[^\d]+/)
    .filter(Boolean)
    .map((n) => Number(n) || 0)
}

function pickNewestVersion(members) {
  let best = ''
  let bestRank = []
  for (const m of members || []) {
    const v = String(m?.version || '').trim()
    if (!v) continue
    const rank = versionRank(v)
    const better = !best || rank.some((n, i) => n !== (bestRank[i] || 0) && n > (bestRank[i] || 0))
      || (rank.length > bestRank.length && rank.slice(0, bestRank.length).every((n, i) => n === (bestRank[i] || 0)))
    if (better) {
      best = v
      bestRank = rank
    }
  }
  return best
}

/**
 * @returns {Array<{
 *   type: 'solo'|'group',
 *   id: string,
 *   name: string,
 *   author: string,
 *   version: string,
 *   members: object[],
 *   primary: object,
 * }>}
 */
export function buildSourceDisplayRows(list = []) {
  const buckets = new Map()
  for (const s of list) {
    if (!s?.id) continue
    const key = sourceFamilyKey(s)
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(s)
  }

  const rows = []
  for (const [key, members] of buckets) {
    if (!key.startsWith('family:') || members.length < 2) {
      for (const m of members) {
        rows.push({
          type: 'solo',
          id: m.id,
          name: m.name,
          author: m.author || '',
          version: m.version || '',
          members: [m],
          primary: m,
        })
      }
      continue
    }
    rows.push({
      type: 'group',
      id: key,
      name: sourceFamilyDisplayName(key, members),
      author: members[0]?.author || '',
      version: pickNewestVersion(members),
      members,
      primary: members[0],
    })
  }
  return rows
}

export function rowMemberIds(row) {
  return (row?.members || []).map((m) => m.id).filter(Boolean)
}

export function isRowFullyActive(row, activeIds = []) {
  const ids = rowMemberIds(row)
  if (!ids.length) return false
  const set = new Set(activeIds)
  return ids.every((id) => set.has(id))
}

export function isRowPartiallyActive(row, activeIds = []) {
  const ids = rowMemberIds(row)
  if (!ids.length) return false
  const set = new Set(activeIds)
  const n = ids.filter((id) => set.has(id)).length
  return n > 0 && n < ids.length
}

export function isRowAnyActive(row, activeIds = []) {
  const set = new Set(activeIds)
  return rowMemberIds(row).some((id) => set.has(id))
}
