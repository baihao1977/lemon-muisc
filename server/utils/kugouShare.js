/** Extract the URL from Kugou's copied share text, preserving its query parameters. */
export function extractKgShareUrl(raw) {
  const input = String(raw || '').trim()
  return input.match(/https?:\/\/[^\s<>"'（）()]+/i)?.[0]
    .replace(/[，。；、！]+$/, '') || input
}

export function kgShareQueryFromInput(raw) {
  try {
    const q = new URL(extractKgShareUrl(raw)).searchParams
    return {
      srcCid: q.get('src_cid') || q.get('srcCid') || '',
      uid: q.get('uid') || q.get('u') || '',
      iszlist: q.get('iszlist') || '',
      chl: q.get('chl') || '',
    }
  } catch {
    return { srcCid: '', uid: '', iszlist: '', chl: '' }
  }
}
