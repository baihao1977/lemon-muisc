import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { extractKgShareUrl, kgShareQueryFromInput } from './kugouShare.js'
import { setCachedPlaylist, getCachedPlaylist } from './playlistCache.js'

// Synthetic fixture: all requests below are mocked; no real user's share link is needed.
const url = 'https://m.kugou.com/songlist/gcid_testplaylist0001/?src_cid=testplaylist0001&uid=9000000000000000&chl=link&iszlist=1'
const shareText = `分享测试用户的歌单《测试歌单》 ${url} （@酷狗音乐）`

function loadSdk(needle) {
  const source = readFileSync(new URL('../musicSdk.js', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '').replace(/^export /gm, '')
  const context = { crypto, needle, extractKgShareUrl, kgShareQueryFromInput,
    Buffer, URL, URLSearchParams, setTimeout, clearTimeout }
  vm.runInNewContext(`${source}\nthis.fetchPlaylist = fetchPlaylist`, context)
  return context
}

test('copied share text preserves the owner and share query', () => {
  assert.equal(extractKgShareUrl(shareText), url)
  assert.deepEqual(kgShareQueryFromInput(shareText), {
    srcCid: 'testplaylist0001', uid: '9000000000000000', iszlist: '1', chl: 'link',
  })
  assert.deepEqual(kgShareQueryFromInput(url), kgShareQueryFromInput(shareText))
  assert.equal(extractKgShareUrl(`分享（${url}）`), url)
  assert.equal(extractKgShareUrl('collection_3_9000000000000000_1_0'), 'collection_3_9000000000000000_1_0')
  assert.equal(kgShareQueryFromInput('gcid_example').uid, '')
})

test('encoded ID resolves to list 128 and retrieves all 503 songs', async () => {
  const songs = Array.from({ length: 503 }, (_, i) => ({ hash: `hash${i}`, filename: `Artist - Song ${i}` }))
  const calls = []
  const needle = async (method, requestUrl, body) => {
    const u = new URL(requestUrl)
    calls.push(u)
    if (u.pathname === '/v1/songlist/batch_decode') {
      assert.equal(method, 'post')
      const params = Object.fromEntries(u.searchParams)
      const signature = params.signature
      delete params.signature
      const salt = 'OIlwieks28dk2k092lksi2UIkp'
      assert.equal(signature, crypto.createHash('md5').update(salt
        + Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('') + body + salt).digest('hex'))
      assert.equal(JSON.parse(body).data[0].id, 'gcid_testplaylist0001')
      return { body: JSON.stringify({ status: 1, err_code: 0, data: { list: [
        { id: 'gcid_testplaylist0001', global_collection_id: 'collection_3_9000000000000000_128_0' },
      ] } }) }
    }
    if (u.pathname.startsWith('/songlist/')) {
      assert.equal(u.searchParams.get('uid'), '9000000000000000')
      return { body: `window.$output = ${JSON.stringify({ info: {
        listinfo: { name: 'Playlist', count: 503 }, songs: songs.slice(0, 10),
      } })};` }
    }
    assert.equal(u.pathname, '/pubsongs/v2/get_other_list_file_nofilt')
    const gid = u.searchParams.get('global_collection_id')
    const limit = Number(u.searchParams.get('pagesize'))
    const begin = Number(u.searchParams.get('begin_idx'))
    assert.equal(gid, 'collection_3_9000000000000000_128_0')
    return { body: JSON.stringify({ status: 1, data: {
      count: 503,
      list_info: { name: 'Playlist' },
      songs: songs.slice(begin, begin + limit),
    } }) }
  }
  // Evaluate the SDK with only its HTTP dependency replaced; no live services required.
  const context = loadSdk(needle)
  const preview = await context.fetchPlaylist('kg', shareText, { partial: true })
  assert.equal(preview.list.length, 100)
  assert.equal(preview.hasMore, true)
  const full = await context.fetchPlaylist('kg', shareText)
  assert.equal(full.list.length, 503)
  assert.equal(full.total, 503)
  assert.equal(full.hasMore, false)
  assert.equal(full.list[502].hash, 'hash502')
  assert.ok(calls.some(u => u.searchParams.get('begin_idx') === '300'))
})

test('512 raw rows normalize to 503 tracks, preserving different album audio IDs', async () => {
  const songs = Array.from({ length: 503 }, (_, i) => ({
    hash: i === 1 ? 'hash0' : `hash${i}`, album_audio_id: i + 1, filename: `Artist - Song ${i}`,
  }))
  const raw = [...songs.slice(0, 136), ...Array.from({ length: 8 }, () => ({})),
    songs[0], ...songs.slice(136)]
  const starts = []
  const sdk = loadSdk(async (_method, requestUrl) => {
    const q = new URL(requestUrl).searchParams
    const begin = Number(q.get('begin_idx'))
    starts.push(begin)
    return { body: JSON.stringify({ status: 1, data: { count: 512,
      songs: raw.slice(begin, begin + Number(q.get('pagesize'))) } }) }
  })
  const r = await sdk.fetchPlaylist('kg', 'collection_3_9000000000000000_128_0')
  assert.deepEqual(starts, [0, 300])
  assert.equal(r.list.length, 503)
  assert.equal(r.total, 503)
  assert.equal(r.hasMore, false)
  assert.equal(r.list.filter(s => s.hash === 'hash0').length, 2)
  assert.ok(r.list.every(s => s.id && s.name))
})

test('server page caps do not stop retrieval early', async () => {
  const songs = Array.from({ length: 25 }, (_, i) => ({ hash: `hash${i}`, filename: `Song ${i}` }))
  const sdk = loadSdk(async (_method, requestUrl) => {
    const begin = Number(new URL(requestUrl).searchParams.get('begin_idx'))
    return { body: JSON.stringify({ status: 1, data: { count: 25, songs: songs.slice(begin, begin + 10) } }) }
  })
  const r = await sdk.fetchPlaylist('kg', 'collection_3_1_128_0')
  assert.equal(r.list.length, 25)
  assert.equal(r.truncated, false)
})

test('a short preview with invalid rows reports its normalized total', async () => {
  const song = { hash: 'hash1', album_audio_id: 1, filename: 'Song' }
  const sdk = loadSdk(async () => ({ body: JSON.stringify({ status: 1,
    data: { count: 3, songs: [song, {}, song] } }) }))
  const r = await sdk.fetchPlaylist('kg', 'collection_3_1_128_0', { partial: true })
  assert.equal(r.list.length, 1)
  assert.equal(r.total, 1)
  assert.equal(r.hasMore, false)
})

test('a repeated page returns a marked incomplete result instead of looping', async () => {
  const songs = Array.from({ length: 10 }, (_, i) => ({ hash: `hash${i}`, filename: `Song ${i}` }))
  let calls = 0
  const sdk = loadSdk(async () => {
    calls++
    return { body: JSON.stringify({ status: 1, data: { count: 25, songs } }) }
  })
  const r = await sdk.fetchPlaylist('kg', 'collection_3_1_128_0')
  assert.equal(calls, 2)
  assert.equal(r.list.length, 10)
  assert.equal(r.total, 25)
  assert.equal(r.truncated, true)
  assert.equal(r.hasMore, true)
})

test('decode failure keeps an explicit ten-song preview without guessing other lists', async () => {
  const songs = Array.from({ length: 10 }, (_, i) => ({ hash: `hash${i}`, filename: `Song ${i}` }))
  const sdk = loadSdk(async (_method, requestUrl) => {
    const u = new URL(requestUrl)
    if (u.pathname === '/v1/songlist/batch_decode') return { body: '{"status":0,"err_code":1}' }
    assert.ok(u.pathname.startsWith('/songlist/'))
    return { body: `window.$output = ${JSON.stringify({ info: {
      listinfo: { count: 503, list_create_userid: 9000000000000000 }, songs,
    } })};` }
  })
  const r = await sdk.fetchPlaylist('kg', shareText)
  assert.equal(r.list.length, 10)
  assert.equal(r.total, 503)
  assert.equal(r.truncated, true)
})

test('status zero is a failure even if error_code is zero', async () => {
  const sdk = loadSdk(async () => ({ body: '{"status":0,"error_code":0,"data":{}}' }))
  await assert.rejects(sdk.fetchPlaylist('kg', 'collection_3_1_128_0'))
})

test('incomplete full responses are not cached, previews and complete results are', () => {
  setCachedPlaylist('test:truncated', { truncated: true, hasMore: true })
  assert.equal(getCachedPlaylist('test:truncated'), null)
  setCachedPlaylist('test:incomplete', { partial: false, hasMore: true })
  assert.equal(getCachedPlaylist('test:incomplete'), null)
  const preview = { partial: true, hasMore: true }
  setCachedPlaylist('test:preview', preview)
  assert.equal(getCachedPlaylist('test:preview'), preview)
  const complete = { partial: false, hasMore: false }
  setCachedPlaylist('test:complete', complete)
  assert.equal(getCachedPlaylist('test:complete'), complete)
})
