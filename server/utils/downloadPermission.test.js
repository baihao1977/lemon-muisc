import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initDB, getDB } from '../db.js'
import { createUser } from './auth.js'
import {
  getDownloadAllowed,
  setDownloadAllowed,
  isDownloadAllowedForUser,
  normalizeDownloadAllowed,
} from './downloadPermission.js'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-dl-perm-'))

test.before(() => {
  initDB(path.join(tmp, 'config'))
})

test.after(() => {
  try { getDB()?.close?.() } catch {}
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('normalizeDownloadAllowed defaults to allow', () => {
  assert.equal(normalizeDownloadAllowed(undefined), true)
  assert.equal(normalizeDownloadAllowed('true'), true)
  assert.equal(normalizeDownloadAllowed('false'), false)
  assert.equal(normalizeDownloadAllowed(false), false)
})

test('admin always allowed; user respects setting', () => {
  const admin = createUser({
    username: 'dl_admin',
    password: 'testpass1',
    role: 'admin',
  })
  const user = createUser({
    username: 'dl_user',
    password: 'testpass1',
    role: 'user',
  })

  assert.equal(isDownloadAllowedForUser({ id: admin.id, role: 'admin' }), true)
  assert.equal(getDownloadAllowed(user.id), true)

  setDownloadAllowed(user.id, false)
  assert.equal(getDownloadAllowed(user.id), false)
  assert.equal(isDownloadAllowedForUser({ id: user.id, role: 'user' }), false)

  setDownloadAllowed(user.id, true)
  assert.equal(isDownloadAllowedForUser({ id: user.id, role: 'user' }), true)

  setDownloadAllowed(admin.id, false)
  assert.equal(isDownloadAllowedForUser({ id: admin.id, role: 'admin' }), true)
})
