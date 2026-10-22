/**
 * MusicFree / BakaMusic 插件适配层
 * 协议参考：https://musicfree.catcat.work/plugin/introduction.html
 *           https://github.com/Zencok/BakaMusic/blob/main/docs/plugin-development.md
 * 落雪 / 澜音脚本仍走原运行时，本文件只识别 platform + getMediaSource/search 形态。
 */
import crypto from 'crypto'
import zlib from 'zlib'
import querystring from 'querystring'
import axios from 'axios'
import CryptoJS from 'crypto-js'
import * as cheerio from 'cheerio'
import { trackSourceAbort } from './sourceRequestScope.js'

const LEMON_QUALITYS = ['128k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'atmos_plus', 'master']

const QUALITY_TO_PLUGIN = {
  '128k': ['128k', 'standard', 'low', '192k', '96k'],
  '320k': ['320k', 'high', '192k', 'standard'],
  flac: ['flac', 'super', 'high', '320k'],
  flac24bit: ['flac24bit', 'hires', 'flac', 'super'],
  hires: ['hires', 'flac24bit', 'flac', 'super'],
  atmos: ['atmos', 'dolby', 'flac', 'super'],
  atmos_plus: ['atmos_plus', 'atmos', 'dolby', 'super'],
  master: ['master', 'vinyl', 'hires', 'super'],
}

const PLUGIN_QUALITY_TO_LEMON = {
  low: '128k',
  standard: '128k',
  high: '320k',
  super: 'flac',
  '96k': '128k',
  '192k': '320k',
  dolby: 'atmos',
  vinyl: 'master',
}

const pluginStores = new Map()

export function unwrapMusicFreePlugin(exported) {
  if (!exported || typeof exported !== 'object') return null
  if (isMusicFreePlugin(exported)) return exported
  const def = exported.default
  if (def && typeof def === 'object' && isMusicFreePlugin(def)) return def
  return null
}

export function isMusicFreePlugin(exported) {
  if (!exported || typeof exported !== 'object') return false
  const platform = String(exported.platform || '').trim()
  if (!platform) return false
  return typeof exported.getMediaSource === 'function' || typeof exported.search === 'function'
}

export function musicFreePlatformKey(platform) {
  const name = String(platform || 'plugin').trim() || 'plugin'
  const hash = crypto.createHash('md5').update(name).digest('hex').slice(0, 8)
  return `mf${hash}`
}

function quotedAssign(text, key) {
  const re = new RegExp(
    `(?:(?:const|let|var)\\s+)?${key}\\s*[:=]\\s*['"\`]([^'"\`]{1,160})['"\`]`,
    'i',
  )
  const m = String(text || '').match(re)
  return m?.[1]?.trim() || ''
}

export function peekPluginMeta(script) {
  const text = String(script || '')
  const platformNameConst = quotedAssign(text, 'PLATFORM_NAME')
  const platformQuoted = quotedAssign(text, 'platform')
  let name = platformQuoted || platformNameConst
  if (!name && /platform\s*:\s*PLATFORM_NAME\b/.test(text) && platformNameConst) {
    name = platformNameConst
  }
  if (!name) {
    const rawName = quotedAssign(text, 'name')
    if (rawName && rawName !== 'API Key' && !/^key$/i.test(rawName)) name = rawName
  }
  return {
    name,
    version: quotedAssign(text, 'version'),
    author: quotedAssign(text, 'author'),
    homepage: quotedAssign(text, 'srcUrl') || quotedAssign(text, 'homepage'),
    description: quotedAssign(text, 'description'),
  }
}

export function tryParsePluginManifest(text, baseUrl = '') {
  const raw = String(text || '').trim()
  if (!raw.startsWith('{') && !raw.startsWith('[')) return null
  let data
  try { data = JSON.parse(raw) } catch { return null }
  const list = Array.isArray(data) ? data : data.plugins
  if (!Array.isArray(list) || !list.length) return null
  const entries = []
  for (const item of list) {
    const u = typeof item === 'string' ? item : (item?.url || item?.href || item?.src || '')
    if (!u) continue
    let href = ''
    try {
      href = new URL(String(u), baseUrl || undefined).href
    } catch {
      continue
    }
    if (!/^https?:\/\//i.test(href)) continue
    entries.push({
      url: href,
      name: typeof item === 'object' ? String(item.name || item.platform || '').trim() : '',
      version: typeof item === 'object'
        ? String(item.version || item.currentVersion || '').trim()
        : '',
      author: typeof item === 'object' ? String(item.author || '').trim() : '',
    })
  }
  return entries.length ? entries : null
}

function toLemonQuality(key) {
  const k = String(key || '').trim()
  if (LEMON_QUALITYS.includes(k)) return k
  return PLUGIN_QUALITY_TO_LEMON[k] || ''
}

function qualitiesToTry(lemonQuality) {
  const q = String(lemonQuality || '128k')
  return [...new Set([q, ...(QUALITY_TO_PLUGIN[q] || []), 'super', 'high', 'standard', '320k', '128k'])]
}

export function normalizeMusicFreeSources(plugin) {
  const name = String(plugin?.platform || '插件').trim() || '插件'
  const key = musicFreePlatformKey(name)
  const declared = Array.isArray(plugin.supportedQualities)
    ? plugin.supportedQualities.map(toLemonQuality).filter((q) => LEMON_QUALITYS.includes(q))
    : []
  const qualitys = declared.length ? [...new Set(declared)] : ['128k', '320k', 'flac']
  const actions = ['musicUrl']
  if (typeof plugin.getLyric === 'function') actions.push('lyric')
  actions.push('pic')
  return {
    [key]: {
      name,
      type: 'music',
      actions,
      qualitys,
      searchable: typeof plugin.search === 'function',
    },
  }
}

function toMusicItem(info = {}, platformName = '') {
  if (info.mfItem && typeof info.mfItem === 'object') {
    return { platform: platformName, ...info.mfItem }
  }
  const music = info.musicInfo && typeof info.musicInfo === 'object' ? info.musicInfo : info
  if (music.mfItem && typeof music.mfItem === 'object') {
    return { platform: platformName, ...music.mfItem }
  }
  const id = String(music.id || music.songId || music.songmid || music.hash || music.copyrightId || '')
  return {
    id,
    platform: platformName || music.platform || '',
    title: music.title || music.name || '',
    artist: music.artist || music.singer || '',
    album: music.album || music.albumName || '',
    artwork: music.artwork || music.img || music.picUrl || '',
    duration: Number(music.duration) || 0,
    ...music,
  }
}

function typesFromItem(item) {
  const q = item?.qualities
  const keys = q && typeof q === 'object'
    ? Object.keys(q)
    : ['128k', '320k']
  const types = []
  const seen = new Set()
  for (const raw of keys) {
    const type = toLemonQuality(raw) || (LEMON_QUALITYS.includes(raw) ? raw : '')
    if (!type || seen.has(type)) continue
    seen.add(type)
    const size = q?.[raw]?.size
    types.push(size ? { type, size: String(size) } : { type })
  }
  if (!types.length) types.push({ type: '128k' }, { type: '320k' })
  return types
}

function formatInterval(sec) {
  const n = Number(sec)
  if (!Number.isFinite(n) || n <= 0) return ''
  const s = Math.round(n)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

export function mapMusicFreeSearchItem(item, sourceKey, platformName) {
  if (!item || typeof item !== 'object') return null
  const id = String(item.id || item.mid || item.songmid || '')
  if (!id) return null
  const types = typesFromItem(item)
  return {
    id,
    name: item.title || item.name || '',
    singer: item.artist || item.singer || '',
    album: item.album || '',
    albumName: item.album || '',
    interval: formatInterval(item.duration),
    duration: item.duration || 0,
    source: sourceKey,
    songId: id,
    songmid: id,
    hash: item.hash || id,
    img: item.artwork || item.picUrl || '',
    picUrl: item.artwork || item.picUrl || '',
    types,
    qualitys: types.map((t) => t.type),
    mfItem: { ...item, platform: item.platform || platformName },
  }
}

export function mapMusicFreeSearchResult(result, sourceKey, platformName, limit = 30) {
  const list = Array.isArray(result?.data) ? result.data : []
  const mapped = list.map((item) => mapMusicFreeSearchItem(item, sourceKey, platformName)).filter(Boolean)
  const isEnd = result?.isEnd !== false
  const pageSize = Math.max(1, Number(limit) || 30)
  return {
    list: mapped,
    allPage: isEnd ? 1 : 99,
    total: isEnd ? mapped.length : mapped.length + pageSize,
  }
}

async function lyricFromPlugin(plugin, musicItem) {
  if (typeof plugin.getLyric !== 'function') return null
  const lyric = await plugin.getLyric(musicItem)
  if (lyric == null) return null
  if (typeof lyric === 'string') return { lyric }
  const text = lyric.rawLrc || lyric.lyric || lyric.lrc || ''
  if (typeof text === 'string' && /^https?:\/\//i.test(text.trim())) {
    try {
      const resp = await axios.get(text.trim(), { timeout: 15000, responseType: 'text' })
      return { lyric: String(resp.data || '') }
    } catch {
      return { lyric: '' }
    }
  }
  return { lyric: String(text || '') }
}

export function createMusicFreeHandler(plugin) {
  const platformName = String(plugin.platform || '').trim()
  return async ({ action, info = {} }) => {
    const musicItem = toMusicItem(info, platformName)
    const quality = info.type || info.quality || '128k'

    if (action === 'musicUrl') {
      if (typeof plugin.getMediaSource !== 'function') throw new Error('该插件不支持获取播放链接')
      let lastErr = null
      for (const q of qualitiesToTry(quality)) {
        try {
          const result = await plugin.getMediaSource(musicItem, q)
          const url = result?.url || (typeof result === 'string' ? result : '')
          if (url) {
            if (result && typeof result === 'object') return result
            return url
          }
        } catch (e) {
          lastErr = e
        }
      }
      throw lastErr || new Error('未获取到URL')
    }
    if (action === 'lyric') {
      const lyric = await lyricFromPlugin(plugin, musicItem)
      if (!lyric?.lyric) throw new Error('该插件未返回歌词')
      return lyric
    }
    if (action === 'pic') {
      const art = musicItem.artwork || musicItem.img || musicItem.picUrl
      if (art) return art
      if (typeof plugin.getMusicInfo === 'function') {
        const extra = await plugin.getMusicInfo(musicItem)
        if (extra?.artwork) return extra.artwork
      }
      throw new Error('该插件不支持获取封面')
    }
    throw new Error(`不支持的操作: ${action}`)
  }
}

function decodeEntities(str) {
  return String(str ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
}

function createDayjsStub() {
  const wrap = (input) => {
    const d = input == null || input === '' ? new Date() : new Date(input)
    return {
      unix: () => Math.floor(d.getTime() / 1000),
      valueOf: () => d.getTime(),
      toDate: () => d,
      format: () => d.toISOString(),
    }
  }
  wrap.unix = (n) => wrap(Number(n) * 1000)
  return wrap
}

function createPakoStub() {
  return {
    inflate: (data) => zlib.inflateSync(Buffer.from(data)),
    deflate: (data) => zlib.deflateSync(Buffer.from(data)),
    ungzip: (data) => zlib.gunzipSync(Buffer.from(data)),
    gzip: (data) => zlib.gzipSync(Buffer.from(data)),
  }
}

function createStorage(pluginId) {
  const key = String(pluginId || 'default')
  if (!pluginStores.has(key)) pluginStores.set(key, new Map())
  const store = pluginStores.get(key)
  return {
    async getItem(k) {
      return store.has(k) ? store.get(k) : null
    },
    async setItem(k, v) {
      store.set(String(k), v)
    },
    async removeItem(k) {
      store.delete(k)
    },
  }
}

/** 把插件上游常见密钥/鉴权文案收成短提示 */
export function normalizePluginApiMessage(raw) {
  const msg = String(raw || '').trim()
  if (!msg) return ''
  if (/过期|expired/i.test(msg)) return '密钥已过期'
  if (/未填写|未配置|未提供|缺少|请.*填写|empty|missing|no\s*api\s*key|没有.*(密钥|key)/i.test(msg)) {
    return 'API无密钥'
  }
  if (/无效|非法|错误的?密钥|invalid.*key|wrong.*key|unauthorized|鉴权失败|授权失败/i.test(msg)) {
    return 'API 密钥无效'
  }
  return msg
}

function pluginResponseHasPayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  if (Array.isArray(data.data) && data.data.length > 0) return true
  if (Array.isArray(data.list) && data.list.length > 0) return true
  if (Array.isArray(data.musicList) && data.musicList.length > 0) return true
  if (typeof data.url === 'string' && data.url.trim()) return true
  if (typeof data.rawLrc === 'string' && data.rawLrc.trim()) return true
  if (typeof data.cek === 'string' && data.cek.trim()) return true
  return false
}

/**
 * 识别插件接口里「失败但仍 200」的响应（如 密钥已过期），转成可抛出的文案。
 * 有实际业务数据时不拦截，避免误伤。
 */
export function extractPluginApiError(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ''
  if (pluginResponseHasPayload(data)) return ''

  const msg = String(
    data.error || data.msg || data.message || data.errmsg || data.errMsg || '',
  ).trim()
  const errcode = Number(data.errcode ?? data.errCode ?? data.errno)
  const codeNum = Number(data.code)
  const failedByErrcode = Number.isFinite(errcode) && errcode !== 0
  const failedByCode = Number.isFinite(codeNum) && codeNum !== 0 && codeNum !== 200

  if (typeof data.error === 'string' && data.error.trim()) {
    return normalizePluginApiMessage(data.error.trim())
  }
  if ((failedByErrcode || failedByCode) && msg) {
    return normalizePluginApiMessage(msg)
  }
  if (msg && /密钥|API\s*Key|api.?key|未填写|未配置|过期|鉴权|授权|请.*填写/i.test(msg)) {
    return normalizePluginApiMessage(msg)
  }
  return ''
}

function createAxiosInstance() {
  const instance = axios.create({
    timeout: 15000,
    maxContentLength: 16 * 1024 * 1024,
    maxBodyLength: 16 * 1024 * 1024,
    validateStatus: () => true,
  })
  instance.interceptors.request.use((config) => {
    const ctrl = new AbortController()
    config.signal = config.signal || ctrl.signal
    trackSourceAbort(() => {
      try { ctrl.abort() } catch {}
    })
    return config
  })
  instance.interceptors.response.use((response) => {
    const errMsg = extractPluginApiError(response?.data)
    if (errMsg) {
      const err = new Error(errMsg)
      err.isPluginApiError = true
      return Promise.reject(err)
    }
    return response
  })
  return instance
}

export function createPluginEnv() {
  const userVariables = {}
  return {
    os: process.platform,
    appVersion: '1.2.17',
    lang: 'zh-CN',
    userVariables,
    getUserVariables() {
      return { ...userVariables }
    },
  }
}

/** 插件沙箱 require 白名单（对齐 BakaMusic / MusicFree 常用包） */
export function createMusicFreeModules({ pluginId } = {}) {
  const ax = createAxiosInstance()
  return {
    axios: ax,
    cheerio: { ...cheerio, default: cheerio, load: cheerio.load },
    'crypto-js': CryptoJS,
    cryptojs: CryptoJS,
    qs: querystring,
    querystring,
    he: { decode: decodeEntities, encode: (s) => String(s ?? '') },
    dayjs: createDayjsStub(),
    pako: createPakoStub(),
    buffer: { Buffer },
    'big-integer': (n) => BigInt(n),
    '@react-native-cookies/cookies': {
      get: async () => ({}),
      set: async () => {},
      clearAll: async () => {},
    },
    'musicfree/storage': createStorage(pluginId),
  }
}
