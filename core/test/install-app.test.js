import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const SCRIPT = fileURLToPath(new URL('../../menubar/install-app.sh', import.meta.url))

function makeApp(dir, marker) {
  const macos = join(dir, 'Contents', 'MacOS')
  mkdirSync(macos, { recursive: true })
  const executable = join(macos, 'Seen')
  writeFileSync(executable, marker)
  chmodSync(executable, 0o755)
  return dir
}

function sandbox() {
  return mkdtempSync(join(tmpdir(), 'seen-install-'))
}

function runInstall(source, target, backupDir, env = {}) {
  return spawnSync('/bin/bash', [SCRIPT, source, target], {
    encoding: 'utf8',
    env: { ...process.env, SEEN_INSTALL_BACKUP_DIR: backupDir, ...env },
  })
}

function fakeCommand(dir, name, body) {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name)
  writeFileSync(file, '#!/bin/bash\n' + body + '\n')
  chmodSync(file, 0o755)
  return file
}

function stagingLeftovers(targetDir) {
  return readdirSync(targetDir).filter((name) => name.startsWith('.seen-install.'))
}

function markerOf(app) {
  return readFileSync(join(app, 'Contents', 'MacOS', 'Seen'), 'utf8').trim()
}

test('安装脚本把新版本放到目标路径，不产生嵌套 Seen.app', () => {
  const root = sandbox()
  const source = makeApp(join(root, 'source', 'Seen.app'), 'new-version')
  const target = join(root, 'Applications', 'Seen.app')
  const backup = join(root, 'backups')
  const result = runInstall(source, target, backup)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(markerOf(target), 'new-version')
  assert.equal(existsSync(join(target, 'Seen.app')), false)
  assert.deepEqual(stagingLeftovers(dirname(target)), [])
})

test('安装脚本保留旧版本备份，并替换目标', () => {
  const root = sandbox()
  const source = makeApp(join(root, 'source', 'Seen.app'), 'new-version')
  const target = makeApp(join(root, 'Applications', 'Seen.app'), 'old-version')
  const backup = join(root, 'backups')
  const result = runInstall(source, target, backup)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(markerOf(target), 'new-version')
  const entries = readdirSync(backup)
  assert.equal(entries.length, 1)
  assert.match(entries[0], /^Seen\.app\./)
  assert.equal(markerOf(join(backup, entries[0])), 'old-version')
  assert.deepEqual(stagingLeftovers(dirname(target)), [])
})

test('复制失败时旧版本保持原样，临时目录被清理', () => {
  const root = sandbox()
  const source = makeApp(join(root, 'source', 'Seen.app'), 'new-version')
  const target = makeApp(join(root, 'Applications', 'Seen.app'), 'old-version')
  const backup = join(root, 'backups')
  const bin = join(root, 'fake-bin')
  fakeCommand(bin, 'cp', 'exit 1')
  const result = runInstall(source, target, backup, {
    PATH: [bin, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /复制新版本失败/)
  assert.equal(markerOf(target), 'old-version')
  assert.deepEqual(stagingLeftovers(dirname(target)), [])
  assert.deepEqual(readdirSync(backup), [])
})

test('移动新版本失败时回滚旧版本，临时目录被清理', () => {
  const root = sandbox()
  const source = makeApp(join(root, 'source', 'Seen.app'), 'new-version')
  const target = makeApp(join(root, 'Applications', 'Seen.app'), 'old-version')
  const backup = join(root, 'backups')
  const bin = join(root, 'fake-bin')
  const failureMarker = join(root, 'mv-failed-once')
  fakeCommand(bin, 'mv', [
    'if [ "$2" = "$FAIL_TARGET" ] && [ ! -f "$FAIL_MARKER" ]; then',
    '  : > "$FAIL_MARKER"',
    '  exit 1',
    'fi',
    'exec /bin/mv "$@"',
  ].join('\n'))
  const result = runInstall(source, target, backup, {
    PATH: [bin, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
    FAIL_TARGET: target,
    FAIL_MARKER: failureMarker,
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /无法把新版本移动到/)
  assert.equal(markerOf(target), 'old-version')
  assert.deepEqual(stagingLeftovers(dirname(target)), [])
})

test('安装中断时恢复旧版本，临时目录被清理', () => {
  const root = sandbox()
  const source = makeApp(join(root, 'source', 'Seen.app'), 'new-version')
  const target = makeApp(join(root, 'Applications', 'Seen.app'), 'old-version')
  const backup = join(root, 'backups')
  const bin = join(root, 'fake-bin')
  const marker = join(root, 'mv-interrupted-once')
  fakeCommand(bin, 'mv', [
    'if [ "$2" = "$TERM_TARGET" ] && [ ! -f "$TERM_MARKER" ]; then',
    '  : > "$TERM_MARKER"',
    '  kill -TERM "$PPID"',
    '  sleep 0.2',
    '  exit 0',
    'fi',
    'exec /bin/mv "$@"',
  ].join('\n'))
  const result = runInstall(source, target, backup, {
    PATH: [bin, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
    TERM_TARGET: target,
    TERM_MARKER: marker,
  })

  assert.notEqual(result.status, 0)
  assert.equal(markerOf(target), 'old-version')
  assert.deepEqual(stagingLeftovers(dirname(target)), [])
  assert.deepEqual(readdirSync(backup), [])
})

test('备份目录与安装目录不在同一磁盘时拒绝安装', () => {
  const root = sandbox()
  const source = makeApp(join(root, 'source', 'Seen.app'), 'new-version')
  const target = makeApp(join(root, 'Applications', 'Seen.app'), 'old-version')
  const backup = join(root, 'backups')
  const bin = join(root, 'fake-bin')
  fakeCommand(bin, 'stat', [
    'if [ "$1" = "-f" ] && [ "$2" = "%d" ]; then',
    '  case "$3" in',
    '    *backups*) echo 2 ;;',
    '    *) echo 1 ;;',
    '  esac',
    '  exit 0',
    'fi',
    'exec /usr/bin/stat "$@"',
  ].join('\n'))
  const result = runInstall(source, target, backup, {
    PATH: [bin, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /不在同一磁盘/)
  assert.equal(markerOf(target), 'old-version')
  assert.deepEqual(stagingLeftovers(dirname(target)), [])
})
