/**
 * 检测到 GitHub 有新版本时，自动把音源 / 歌单等用户数据备份到下载目录。
 *
 * 触发条件（需同时：latest > current）：
 * 1) 尚未为该 latestVersion 备份过；或
 * 2) 已备份过，但用户数据指纹相对上次备份有变化（新增音源/歌单等）→ 再写一份完整快照
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import needle from 'needle'
import { getDB } from '../db.js'
import { listUsers } from './auth.js'
import { getLibraryUserData } from './libraryUserData.js'
import { getUserSettings, setGlobalSettings, USER_SETTING_KEYS } from './userSettings.js'
import { getSharedDownloadSavePath } from './filePaths.js'
import { compareVersion, getAppVersion } from './version.js'
import { ensurePodcastTables, listFeeds } from './podcastStore.js'

const REPO = 'jia070310/lemon-muisc'
const STAMP_KEY = 'backup.autoForLatestVersion'
const FINGERPRINT_KEY = 'backup.autoContentFingerprint'
const BACKUP_SUBDIR = 'lemon-backups'

/** 与设置页「导出备份」一致的用户设置键 */
export const EXPORTABLE_USER_KEYS = [
  'ui.theme',
  'ui.librarySongColumns',
  'ui.lyricColorPreset',
  'ui.lyricTextColor',
  'ui.lyricHighlightColor',
  'player.coverStyle',
  'player.visualizer',
  'playlist.remoteSyncDays',
  'download.usePersonalSavePath',
  'source.active',
  'source.enabledPlatforms',
  'source.autoClosedPlatforms',
  'source.previewAutoCloseSkip',
].filter((k) => USER_SETTING_KEYS.has(k))

function readSetting(key) {
  const db = getDB()
  if (!db) return ''
  try {
    return String(db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || '')
  } catch {
    return ''
  }
}

function readStamp() {
  return readSetting(STAMP_KEY)
}

function readSavedFingerprint() {
  return readSetting(FINGERPRINT_KEY)
}

function writeBackupMeta(latestVersion, fingerprint) {
  setGlobalSettings({
    [STAMP_KEY]: String(latestVersion || ''),
    [FINGERPRINT_KEY]: String(fingerprint || ''),
  })
}

function pickUserSettings(userId) {
  const all = getUserSettings(userId)
  const settings = {}
  for (const key of EXPORTABLE_USER_KEYS) {
    if (all[key] != null) settings[key] = all[key]
  }
  return settings
}

function listSourceScripts() {
  const db = getDB()
  if (!db) return []
  try {
    const rows = db.prepare(`
      SELECT id, name, description, author, version, homepage, script, sources, updated_at
      FROM user_apis ORDER BY created_at ASC
    `).all()
    return rows.map((row) => {
      let sources = {}
      try {
        sources = JSON.parse(row.sources || '{}') || {}
      } catch {
        sources = {}
      }
      return {
        id: row.id,
        name: row.name,
        description: row.description || '',
        author: row.author || '',
        version: row.version || '',
        homepage: row.homepage || '',
        script: row.script || '',
        sources,
        updatedAt: row.updated_at || 0,
      }
    })
  } catch {
    return []
  }
}

function listUserPodcastFeeds(userId) {
  try {
    ensurePodcastTables()
    return listFeeds(userId).map((f) => ({
      id: f.id,
      url: f.url,
      title: f.title,
      author: f.author,
      imageUrl: f.imageUrl,
      siteUrl: f.siteUrl,
    }))
  } catch {
    return []
  }
}

/**
 * 用户数据内容指纹：音源增删改、歌单/收藏/播客/相关设置变化都会变。
 * 不依赖完整 payload 序列化，避免 exportedAt 等噪声。
 */
export function computeUserDataFingerprint() {
  const sources = listSourceScripts().map((s) => ({
    id: s.id,
    name: s.name,
    version: s.version,
    updatedAt: s.updatedAt,
    scriptLen: (s.script || '').length,
    scriptHash: crypto.createHash('sha1').update(s.script || '').digest('hex').slice(0, 12),
  }))

  const users = listUsers().map((u) => {
    const userData = getLibraryUserData(u.id)
    const settings = pickUserSettings(u.id)
    const feeds = listUserPodcastFeeds(u.id)
    return {
      id: u.id,
      revision: userData.revision || 0,
      playlists: userData.playlists || [],
      favorites: userData.favorites || [],
      favoriteAlbums: userData.favoriteAlbums || [],
      favoriteArtists: userData.favoriteArtists || [],
      recentPlays: userData.recentPlays || [],
      playStats: userData.playStats || [],
      settings,
      podcastFeeds: feeds.map((f) => ({ id: f.id, url: f.url })),
    }
  })

  const raw = JSON.stringify({ sources, users })
  return crypto.createHash('sha1').update(raw).digest('hex')
}

/** 构建单用户导出（设置页手动备份） */
export function buildUserBackupPayload(user, { includeSources = false } = {}) {
  const userData = getLibraryUserData(user.id)
  const payload = {
    app: 'lemon-music',
    type: 'user-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    username: user.username,
    data: {
      playlists: userData.playlists || [],
      favorites: userData.favorites || [],
      favoriteAlbums: userData.favoriteAlbums || [],
      favoriteArtists: userData.favoriteArtists || [],
      recentPlays: userData.recentPlays || [],
      playStats: userData.playStats || [],
      settings: pickUserSettings(user.id),
    },
  }
  if (includeSources) {
    payload.data.sources = listSourceScripts().map(({ updatedAt, ...rest }) => rest)
  }
  return payload
}

/** 全站自动升级备份（含全部用户 + 音源脚本） */
export function buildAutoBackupPayload({ currentVersion, latestVersion, reason = 'version' } = {}) {
  const users = listUsers().map((u) => {
    const userData = getLibraryUserData(u.id)
    return {
      id: u.id,
      username: u.username,
      displayName: u.displayName || u.display_name || '',
      role: u.role,
      playlists: userData.playlists || [],
      favorites: userData.favorites || [],
      favoriteAlbums: userData.favoriteAlbums || [],
      favoriteArtists: userData.favoriteArtists || [],
      recentPlays: userData.recentPlays || [],
      playStats: userData.playStats || [],
      settings: pickUserSettings(u.id),
      podcastFeeds: listUserPodcastFeeds(u.id),
    }
  })

  return {
    app: 'lemon-music',
    type: 'auto-upgrade-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    currentVersion: String(currentVersion || getAppVersion()),
    latestVersion: String(latestVersion || ''),
    reason: reason === 'content-changed' ? 'content-changed' : 'version',
    data: {
      sources: listSourceScripts().map(({ updatedAt, ...rest }) => rest),
      users,
    },
  }
}

/**
 * @returns {{ should: boolean, reason: string }}
 * reason: no-update | already-backed-up | version | content-changed
 */
export function getAutoBackupDecision(currentVersion, latestVersion, fingerprint = null) {
  if (!latestVersion) return { should: false, reason: 'no-update' }
  if (compareVersion(latestVersion, currentVersion) <= 0) {
    return { should: false, reason: 'no-update' }
  }
  const fp = fingerprint ?? computeUserDataFingerprint()
  const stamped = readStamp() === String(latestVersion)
  if (!stamped) return { should: true, reason: 'version' }
  if (fp !== readSavedFingerprint()) return { should: true, reason: 'content-changed' }
  return { should: false, reason: 'already-backed-up' }
}

export function shouldAutoBackup(currentVersion, latestVersion) {
  return getAutoBackupDecision(currentVersion, latestVersion).should
}

function safeFilePart(v) {
  return String(v || 'unknown').replace(/[^\w.-]+/g, '_').slice(0, 32)
}

/**
 * 写入下载目录下 lemon-backups/
 * @returns {{ filePath: string, fileName: string, dir: string }}
 */
export function writeAutoBackupFile(payload, downloadRoot) {
  const root = String(downloadRoot || '').trim()
  if (!root) throw new Error('下载目录未配置')
  const dir = path.join(root, BACKUP_SUBDIR)
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const tag = payload.reason === 'content-changed' ? 'upd' : 'ver'
  const fileName = `lemon-music-backup-${safeFilePart(payload.currentVersion)}-to-${safeFilePart(payload.latestVersion)}-${tag}-${stamp}.json`
  const filePath = path.join(dir, fileName)
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return { filePath, fileName, dir }
}

/**
 * 若有新版本，且（未备份过该版本 或 用户数据相对上次备份有变化），则写入下载目录。
 */
export function maybeAutoBackupOnUpdate({ currentVersion, latestVersion, downloadRoot } = {}) {
  const current = String(currentVersion || getAppVersion())
  const latest = String(latestVersion || '')
  const fingerprint = computeUserDataFingerprint()
  const decision = getAutoBackupDecision(current, latest, fingerprint)
  if (!decision.should) {
    return { ok: false, skipped: true, reason: decision.reason }
  }
  const root = downloadRoot || getSharedDownloadSavePath()
  if (!root) {
    return { ok: false, skipped: true, reason: 'no-download-path' }
  }
  const payload = buildAutoBackupPayload({
    currentVersion: current,
    latestVersion: latest,
    reason: decision.reason,
  })
  const written = writeAutoBackupFile(payload, root)
  writeBackupMeta(latest, fingerprint)
  const tip = decision.reason === 'content-changed'
    ? `新版本窗口内用户数据有变更，已追加备份 → ${written.filePath}`
    : `检测到新版本 ${latest}（当前 ${current}），已备份 → ${written.filePath}`
  console.log(`[backup] ${tip}`)
  return {
    ok: true,
    skipped: false,
    reason: decision.reason,
    currentVersion: current,
    latestVersion: latest,
    fingerprint,
    ...written,
    sourceCount: payload.data.sources?.length || 0,
    userCount: payload.data.users?.length || 0,
  }
}

export async function fetchLatestVersionTag() {
  const resp = await needle('get', `https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'lemon-music-nas',
    },
    timeout: 12000,
    parse_response: true,
  })
  if (resp.statusCode === 200 && resp.body?.tag_name) {
    return String(resp.body.tag_name).replace(/^v/i, '')
  }
  const tags = await needle('get', `https://api.github.com/repos/${REPO}/tags?per_page=1`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'lemon-music-nas',
    },
    timeout: 12000,
    parse_response: true,
  })
  if (tags.statusCode === 200 && Array.isArray(tags.body) && tags.body[0]?.name) {
    return String(tags.body[0].name).replace(/^v/i, '')
  }
  return null
}

/** 启动 / 定时：拉 GitHub 最新版，有更新则备份 */
export async function runAutoBackupVersionCheck() {
  try {
    const currentVersion = getAppVersion()
    const latestVersion = await fetchLatestVersionTag()
    if (!latestVersion) {
      return { ok: false, skipped: true, reason: 'latest-unknown' }
    }
    return maybeAutoBackupOnUpdate({ currentVersion, latestVersion })
  } catch (e) {
    console.warn('[backup] 自动备份版本检查失败:', e?.message || e)
    return { ok: false, skipped: true, reason: e?.message || 'check-failed' }
  }
}

/**
 * 用户数据变更后调用：若此前已因「有新版本」备份过（stamp 仍高于当前版），
 * 且内容指纹变了，则再写一份快照（含新增音源/歌单）。
 * 防抖，避免批量导入连写多次。
 */
let _userDataBackupTimer = null
export function scheduleAutoBackupAfterUserDataChange(delayMs = 2500) {
  if (_userDataBackupTimer) clearTimeout(_userDataBackupTimer)
  _userDataBackupTimer = setTimeout(() => {
    _userDataBackupTimer = null
    try {
      maybeAutoBackupAfterUserDataChange()
    } catch (e) {
      console.warn('[backup] 用户数据变更后备份失败:', e?.message || e)
    }
  }, delayMs)
  _userDataBackupTimer.unref?.()
}

export function maybeAutoBackupAfterUserDataChange() {
  const latest = readStamp()
  if (!latest) {
    return { ok: false, skipped: true, reason: 'no-pending-update' }
  }
  const current = getAppVersion()
  if (compareVersion(latest, current) <= 0) {
    return { ok: false, skipped: true, reason: 'no-update' }
  }
  return maybeAutoBackupOnUpdate({ currentVersion: current, latestVersion: latest })
}

/** 供测试重置 stamp + fingerprint */
export function _resetAutoBackupStampForTests() {
  const db = getDB()
  if (!db) return
  try {
    db.prepare('DELETE FROM settings WHERE key = ?').run(STAMP_KEY)
    db.prepare('DELETE FROM settings WHERE key = ?').run(FINGERPRINT_KEY)
  } catch {}
}

export { STAMP_KEY, FINGERPRINT_KEY, BACKUP_SUBDIR }
