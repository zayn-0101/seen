import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const swiftAvailable = process.platform === 'darwin' && spawnSync('swiftc', ['--version'], { stdio: 'ignore', timeout: 5000 }).status === 0

test('菜单栏服务进程退出后可重启，特殊字符路径不会被 shell 展开', { skip: !swiftAvailable }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'seen-process-test-'))
  try {
    const repo = join(dir, 'repo $(printf wrong)')
    mkdirSync(join(repo, 'server'), { recursive: true })
    writeFileSync(join(repo, 'server', 'index.js'), "console.log('fixture-launched'); setTimeout(() => process.exit(0), 100)\n")
    const swift = join(dir, 'fixture.swift')
    writeFileSync(swift, `
import Foundation
@main struct Fixture {
    static func main() {
        let repo = URL(fileURLWithPath: CommandLine.arguments[1])
        setenv("SEEN_REPO_PATH", repo.path, 1)
        let service = ServiceProcess(logDirectory: repo.appendingPathComponent("logs"))
        for _ in 0..<2 {
            guard service.startIfNeeded() else { exit(2) }
            let deadline = Date().addingTimeInterval(5)
            while service.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.05) }
            guard !service.isRunning else { exit(3) }
        }
        let log = (try? String(contentsOf: repo.appendingPathComponent("logs/server.log"), encoding: .utf8)) ?? ""
        guard log.components(separatedBy: "fixture-launched").count - 1 == 2 else { exit(4) }
    }
}
`)
    const binary = join(dir, 'fixture')
    const compiled = spawnSync('swiftc', ['-parse-as-library', join(root, 'menubar/Sources/ServiceClient.swift'), swift, '-o', binary], { encoding: 'utf8', timeout: 30000 })
    assert.equal(compiled.status, 0, compiled.stderr)
    const ran = spawnSync(binary, [repo], { encoding: 'utf8', timeout: 15000 })
    assert.equal(ran.status, 0, ran.stderr)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
