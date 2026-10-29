import { getDB } from './db.js'
import { unloadSource, getActiveSources } from './sourceManager.js'
import { removeActiveSourceIdFromAllUsers } from './utils/activeSources.js'
import { formatUserError } from './utils/userError.js'
import { logRuntime } from './utils/runtimeLog.js'

const FAULT_KEY = 'source.fault'

/** 临时网络错误：不应停用整个音源 */
export function isTransientNetworkError(error) {
  const message = error?.message || String(error)
  const code = error?.code || ''
  const text = `${message} ${code}`

  if (/socket hang up|ECONNRESET|ETIMEDOUT|EPIPE|ECONNABORTED|ERR_SOCKET/i.test(text)) {
    return true
  }
  // 含初始化超时：慢启动 / 偶发卡住不应永久停用可用音源
  if (/timeout|timed out|请求超时|初始化超时/i.test(text)) {
    return true
  }
  // 单曲取链失败（空链接 / 风控 / 版权）不应停用整个音源
  if (/未获取到URL|获取URL失败|获取播放链接失败|获取.*音质.*失败/i.test(text)) return true
  if (/HTTP\s*40[1349]|statusCode[:\s]*40[1349]|拒绝访问|请求过于频繁|链接已失效/i.test(text)) return true
  if (/HTTP\s*5\d{2}|statusCode[:\s]*5\d{2}/i.test(text)) return true
  return false
}

export function shouldRecordSourceFault(error) {
  return !isTransientNetworkError(error)
}

export function getSourceFault() {
  const row = getDB().prepare('SELECT value FROM settings WHERE key = ?').get(FAULT_KEY)
  if (!row?.value) return null
  try {
    return JSON.parse(row.value)
  } catch {
    return null
  }
}

export function clearSourceFault() {
  getDB().prepare('DELETE FROM settings WHERE key = ?').run(FAULT_KEY)
}

/**
 * 隔离故障音源：写运行日志供管理员排查，停用沙箱。
 * 不再向普通用户弹窗广播——服务仍在跑、其它音源可用时，用户解决不了也只会误会「源坏了」。
 */
export function recordSourceFault(sourceId, error) {
  if (!shouldRecordSourceFault(error)) {
    console.warn(`[音源] 临时/可恢复错误（不停用音源）: ${error?.message || error}`)
    try {
      logRuntime('warn', 'source', `可恢复错误（未停用）: ${error?.message || error}`, { sourceId })
    } catch {}
    return null
  }

  const message = formatUserError(error, error?.message || String(error) || '音源运行出错')
  const row = getDB().prepare('SELECT id, name, homepage FROM user_apis WHERE id = ?').get(sourceId)

  unloadSource(sourceId)
  removeActiveSourceIdFromAllUsers(sourceId)

  const fault = {
    id: sourceId,
    name: row?.name || sourceId,
    homepage: row?.homepage || '',
    message,
    at: new Date().toISOString(),
  }

  // 仅供管理员接口 / 诊断导出查看，不向前端推送弹窗
  getDB().prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(FAULT_KEY, JSON.stringify(fault))

  console.error(`[音源故障] ${fault.name}: ${message}（已停用该音源；详情见运行日志，不向用户弹窗）`)
  try {
    logRuntime('error', 'source-fault', `${fault.name}: ${message}`, {
      sourceId: fault.id,
      name: fault.name,
      homepage: fault.homepage,
    })
  } catch {}

  return fault
}

/** 音源运行时未捕获错误：隔离音源，避免拖垮主进程 */
export function handleRuntimeSourceFault(error) {
  const actives = getActiveSources()
  if (!actives.length) return false
  if (!shouldRecordSourceFault(error)) {
    console.warn(`[音源] 未捕获的临时/可恢复错误（不停用音源）: ${error?.message || error}`)
    return true
  }
  if (actives.length !== 1) {
    console.error(`[音源] 未捕获错误（多音源已激活，未自动停用）:`, error?.message || error)
    try {
      logRuntime('error', 'source', `未捕获错误（多音源未停用）: ${error?.message || error}`)
    } catch {}
    return true
  }
  const text = `${error?.message || error || ''}`
  if (!/音源脚本执行失败|SyntaxError|ReferenceError|TypeError|is not (a )?function|Cannot read/i.test(text)) {
    console.error(`[音源] 未捕获错误（单音源但未判定为脚本故障，不停用）:`, text)
    try {
      logRuntime('error', 'source', `未捕获错误（未停用）: ${text}`)
    } catch {}
    return true
  }
  recordSourceFault(actives[0].id, error)
  return true
}

export function installSourceFaultHandlers() {
  process.on('unhandledRejection', (reason) => {
    if (handleRuntimeSourceFault(reason)) return
    console.error('未处理的 Promise 拒绝:', reason)
  })

  process.on('uncaughtException', (err) => {
    if (handleRuntimeSourceFault(err)) return
    console.error('未捕获异常:', err)
  })
}
