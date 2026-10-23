import { getUserSettings, setUserSettings } from './userSettings.js'

/** 用户设置键：普通用户是否允许下载（管理员始终允许） */
export const DOWNLOAD_ALLOWED_KEY = 'download.allowed'

export function normalizeDownloadAllowed(value) {
  if (value === false || value === 0 || value === '0' || value === 'false') return false
  return true
}

/** 读某用户是否允许下载（缺省 true，兼容旧数据） */
export function getDownloadAllowed(userId) {
  if (!userId) return false
  const settings = getUserSettings(userId)
  return normalizeDownloadAllowed(settings[DOWNLOAD_ALLOWED_KEY])
}

export function setDownloadAllowed(userId, allowed) {
  if (!userId) return
  setUserSettings(userId, {
    [DOWNLOAD_ALLOWED_KEY]: normalizeDownloadAllowed(allowed) ? 'true' : 'false',
  })
}

/** @param {{ id?: string, role?: string } | null} user */
export function isDownloadAllowedForUser(user) {
  if (!user?.id) return false
  if (user.role === 'admin') return true
  return getDownloadAllowed(user.id)
}

export function downloadForbiddenPayload() {
  return {
    error: '当前账号未开放下载功能，请联系管理员',
    code: 'DOWNLOAD_FORBIDDEN',
  }
}
