/**
 * 投屏用 MP3：小爱 / 多数音箱只认 audio/mpeg，直出 FLAC/AAC 会报「无法读取媒体音频」。
 */
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { assertFfmpegFeatureReady } from './apePlay.js'
import { getAppCacheSubdir } from './appPaths.js'

function cacheDir() {
  return getAppCacheSubdir('dlna-mp3', {
    legacyPaths: [path.join(os.tmpdir(), 'lemon-dlna-mp3-cache')],
  })
}

function cacheKey(filePath, stat) {
  return crypto
    .createHash('sha1')
    .update(`${filePath}|${stat.size}|${stat.mtimeMs}|mp3-192`)
    .digest('hex')
}

function runFfmpeg(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    let err = ''
    child.stderr?.on('data', (d) => {
      err += d.toString()
      if (err.length > 4000) err = err.slice(-4000)
    })
    child.on('error', (e) => reject(e))
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg 转码失败${err ? `：${err.split('\n').filter(Boolean).slice(-2).join(' ')}` : ''}`))
    })
  })
}

export async function ensureDlnaPlayMp3(filePath) {
  const ffmpeg = await assertFfmpegFeatureReady('DLNA 投屏转 MP3')
  const resolved = path.resolve(filePath)
  const stat = fs.statSync(resolved)
  const out = path.join(cacheDir(), `${cacheKey(resolved, stat)}.mp3`)
  if (fs.existsSync(out)) {
    try {
      const ost = fs.statSync(out)
      if (ost.size > 1024) return out
    } catch {}
  }
  const tmp = `${out}.partial`
  try {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
  } catch {}
  const common = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-fflags', '+genpts', '-err_detect', 'ignore_err',
    '-i', resolved, '-vn', '-ac', '2', '-ar', '44100', '-b:a', '192k',
  ]
  try {
    await runFfmpeg(ffmpeg, [...common, '-c:a', 'libmp3lame', '-f', 'mp3', tmp])
  } catch {
    await runFfmpeg(ffmpeg, [...common, '-c:a', 'mp3', '-f', 'mp3', tmp])
  }
  fs.renameSync(tmp, out)
  return out
}
