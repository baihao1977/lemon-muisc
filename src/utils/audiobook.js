import { isMusicFreePlatformKey } from './platforms.js'

/**
 * 听书/小说搜索常返回「整本书」容器（封面有、不可直接播），
 * 需打开后再拉章节列表播放。
 */
export function getAudiobookAlbumId(item) {
  if (!item || typeof item !== 'object') return ''
  const mf = item.mfItem && typeof item.mfItem === 'object' ? item.mfItem : null
  return String(
    item.albumId
    || mf?.albumId
    || item.extra?.bookId
    || mf?.extra?.bookId
    || '',
  ).trim()
}

export function isAudiobookContainer(item) {
  if (!item || typeof item !== 'object') return false
  const id = String(item.id || item.songId || item.songmid || '').trim()
  if (!id) return false

  const mf = item.mfItem && typeof item.mfItem === 'object' ? item.mfItem : null
  if (
    item.extra?.isAudio === false
    || item.extra?.bookContainer
    || mf?.extra?.isAudio === false
    || mf?.extra?.bookContainer
    || mf?.isAudio === false
  ) {
    return true
  }

  const albumId = getAudiobookAlbumId(item)
  if (albumId && albumId === id) return true

  // MusicFree 听书源：搜到的书容器通常无时长，且 albumId 与 id 同书
  const source = String(item.source || mf?.platform || '').trim()
  if (isMusicFreePlatformKey(source) && albumId && albumId === id) return true

  // 喜马拉雅等：专辑结果带 worksNum、无单曲时长
  const works = Number(item.worksNum || mf?.worksNum || item.count || 0)
  if (isMusicFreePlatformKey(source) && works > 0 && !(Number(item.duration || mf?.duration || 0) > 0)) {
    return true
  }

  return false
}

export function splitAudiobookSearchResults(list = []) {
  const books = []
  const songs = []
  for (const item of list || []) {
    if (isAudiobookContainer(item)) books.push(item)
    else songs.push(item)
  }
  return { books, songs }
}
