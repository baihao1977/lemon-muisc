/**
 * FPK 安装包落盘路径：下载目录下的「柠檬音乐更新」。
 * 飞牛应用中心「手动安装」通常读不到 @appdata 系统目录，放下载目录便于直接选取。
 *
 * 预留供：关于页「加速保存」、以及后续后台自动更新复用同一目录。
 */
import fs from 'fs'
import path from 'path'
import { getSharedDownloadSavePath } from './filePaths.js'

/** 下载目录内的更新文件夹名（飞牛文件选择器可见） */
export const FPK_UPDATE_SUBDIR = '柠檬音乐更新'

export function getConfigRoot() {
  return process.env.CONFIG_PATH || path.join(process.cwd(), 'config')
}

/** 旧版曾落在 CONFIG_PATH/fpk-updates，仅作兼容提示，不再写入 */
export function peekLegacyFpkUpdateDir() {
  return path.join(getConfigRoot(), 'fpk-updates')
}

function resolveDownloadRoot() {
  try {
    const shared = String(getSharedDownloadSavePath() || '').trim()
    if (shared) return shared
  } catch {}
  const fromEnv = String(
    process.env.DOWNLOADS_HOST_PATH
    || process.env.DOWNLOAD_PATH
    || '',
  ).trim()
  return fromEnv
}

/** 仅解析路径，不创建目录 */
export function peekFpkUpdateDir() {
  const root = resolveDownloadRoot()
  if (!root) return ''
  return path.join(root, FPK_UPDATE_SUBDIR)
}

/** 确保目录存在后返回（真正下载/落盘时再调用） */
export function getFpkUpdateDir() {
  const dir = peekFpkUpdateDir()
  if (!dir) {
    throw new Error('未配置下载目录，请先在设置 → 访问权限中指定下载路径')
  }
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
