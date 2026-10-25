import test from 'node:test'
import assert from 'node:assert/strict'
import { pickFeiniuCertificate } from './httpsConfig.js'

function cert(name, extra = {}) {
  return {
    name,
    certPath: `/tmp/${name}.crt`,
    keyPath: `/tmp/${name}.key`,
    source: 'feiniu',
    used: false,
    fromGateway: false,
    ...extra,
  }
}

test('prefer used cert over sticky https.json name (#48)', () => {
  const list = [
    cert('old.fnos.net'),
    cert('music.example.cn', { used: true }),
    cert('other.example.com'),
  ]
  const picked = pickFeiniuCertificate(list, { certName: 'old.fnos.net', lockToName: false })
  assert.equal(picked?.name, 'music.example.cn')
})

test('prefer gateway cert when none marked used', () => {
  const list = [
    cert('old.fnos.net'),
    cert('music.example.cn', { fromGateway: true }),
  ]
  const picked = pickFeiniuCertificate(list, { certName: 'old.fnos.net', lockToName: false })
  assert.equal(picked?.name, 'music.example.cn')
})

test('lockToName keeps sticky cert even if another is used', () => {
  const list = [
    cert('old.fnos.net'),
    cert('music.example.cn', { used: true }),
  ]
  const picked = pickFeiniuCertificate(list, { certName: 'old.fnos.net', lockToName: true })
  assert.equal(picked?.name, 'old.fnos.net')
})

test('without used/gateway, keep sticky name if still present', () => {
  const list = [
    cert('old.fnos.net'),
    cert('music.example.cn'),
  ]
  const picked = pickFeiniuCertificate(list, { certName: 'old.fnos.net', lockToName: false })
  assert.equal(picked?.name, 'old.fnos.net')
})

test('empty sticky falls back to first scored entry', () => {
  const list = [
    cert('fnOS'),
    cert('music.example.cn', { fromGateway: true, used: true }),
  ]
  // list order as listFeiniuCertificates would return (already scored); pick used first
  const picked = pickFeiniuCertificate(list, { certName: '', lockToName: false })
  assert.equal(picked?.name, 'music.example.cn')
})
