/**
 * dsh-video-coursemap · Windows 前台窗口观察
 *
 * 保留原 dsh-video-coursemap 2.0.0 的 PowerShell 前台窗口逻辑：
 * 通过 user32.dll 的 GetForegroundWindow / GetWindowText / GetWindowThreadProcessId
 * 读取前台窗口标题与进程名，结果写入 UTF-8 文件以规避控制台编码问题。
 */

import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

// 与原插件 2.0.0 一致的 POLL_PS1：结果写文件，避免 stdout 中文 GBK/UTF-8 差异。
const POLL_PS1 = [
  'param([string]$OutFile)',
  'Add-Type -ErrorAction SilentlyContinue @"',
  'using System;',
  'using System.Runtime.InteropServices;',
  'using System.Text;',
  'public static class FGWin {',
  '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);',
  '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
  '}',
  '"@',
  '$h = [FGWin]::GetForegroundWindow()',
  '$sb = New-Object System.Text.StringBuilder 512',
  '[void][FGWin]::GetWindowText($h, $sb, 512)',
  '$procId = 0',
  '[void][FGWin]::GetWindowThreadProcessId($h, [ref]$procId)',
  '$pname = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName',
  '$text = "TITLE=" + $sb.ToString() + "`nPROC=" + $pname',
  '[System.IO.File]::WriteAllText($OutFile, $text, (New-Object System.Text.UTF8Encoding($false)))',
  '',
].join('\n')

let scriptFiles = null

function ensureScriptFiles() {
  if (scriptFiles) return scriptFiles
  const dir = join(tmpdir(), 'dsh-video-coursemap')
  mkdirSync(dir, { recursive: true })
  const ps1Path = join(dir, 'poll-' + process.pid + '.ps1')
  const outPath = join(dir, 'poll-out-' + process.pid + '.txt')
  writeFileSync(ps1Path, POLL_PS1, 'utf8')
  scriptFiles = { ps1Path, outPath }
  return scriptFiles
}

function parsePollOutput(text) {
  const content = String(text || '').replace(/^\uFEFF/, '')
  const title = (content.match(/^TITLE=(.*)$/m) || [])[1]
  const proc = (content.match(/^PROC=(.*)$/m) || [])[1]
  return {
    title: String(title === undefined ? '' : title).trim(),
    app: String(proc === undefined ? '' : proc).trim(),
  }
}

/** 观察 Windows 前台窗口；失败返回带 error 的结果，不抛错 */
export async function observeWin32(config = {}) {
  void config
  try {
    const { ps1Path, outPath } = ensureScriptFiles()
    await execFileP('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', ps1Path, '-OutFile', outPath,
    ], { timeout: 8000, windowsHide: true })
    const text = readFileSync(outPath, 'utf8')
    const parsed = parsePollOutput(text)
    return {
      platform: 'win32',
      app: parsed.app,
      title: parsed.title,
      url: '',
      source: 'powershell',
    }
  } catch (error) {
    return {
      platform: 'win32',
      app: '',
      title: '',
      url: '',
      source: 'none',
      error: String((error && error.message) || error || '无法读取前台窗口'),
      permission: 'unknown',
    }
  }
}
