import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @returns {number} positive if a > b */
export function compareVersion(a, b) {
  const parse = (v) => String(v || '0').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0)
  const pa = parse(a)
  const pb = parse(b)
  const len = Math.max(pa.length, pb.length, 3)
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** 当前应用版本（package.json） */
export function getAppVersion() {
  try {
    const pkgPath = path.join(__dirname, '..', '..', 'package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    return String(pkg.version || '1.0.0')
  } catch {
    return '1.0.0'
  }
}
