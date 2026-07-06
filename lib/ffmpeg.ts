import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

let cachedFfmpeg: string | null | undefined
let cachedFfprobe: string | null | undefined

function fileExists(filePath: string | null | undefined): filePath is string {
  return Boolean(filePath && fs.existsSync(filePath))
}

function bundledFfmpegPath(): string | null {
  const name = os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const candidate = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', name)
  return fileExists(candidate) ? candidate : null
}

function bundledFfprobePath(): string | null {
  const platform = os.platform()
  const arch = os.arch()
  const name = platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  const candidate = path.join(
    process.cwd(),
    'node_modules',
    'ffprobe-static',
    'bin',
    platform,
    arch,
    name
  )
  return fileExists(candidate) ? candidate : null
}

async function systemBinaryAvailable(command: string): Promise<boolean> {
  return new Promise(resolve => {
    const child = spawn(command, ['-version'], { windowsHide: true })
    child.on('error', () => resolve(false))
    child.on('close', code => resolve(code === 0))
  })
}

export async function getFfmpegPath(): Promise<string | null> {
  if (cachedFfmpeg !== undefined) return cachedFfmpeg

  const fromNodeModules = bundledFfmpegPath()
  if (fromNodeModules) {
    cachedFfmpeg = fromNodeModules
    return cachedFfmpeg
  }

  if (await systemBinaryAvailable('ffmpeg')) {
    cachedFfmpeg = 'ffmpeg'
    return cachedFfmpeg
  }

  try {
    const mod = await import('ffmpeg-static')
    const bundled = (mod.default ?? mod) as string
    if (fileExists(bundled)) {
      cachedFfmpeg = bundled
      return cachedFfmpeg
    }
  } catch {
    // fall through
  }

  cachedFfmpeg = null
  return null
}

export async function getFfprobePath(): Promise<string | null> {
  if (cachedFfprobe !== undefined) return cachedFfprobe

  const fromNodeModules = bundledFfprobePath()
  if (fromNodeModules) {
    cachedFfprobe = fromNodeModules
    return cachedFfprobe
  }

  if (await systemBinaryAvailable('ffprobe')) {
    cachedFfprobe = 'ffprobe'
    return cachedFfprobe
  }

  try {
    const mod = await import('ffprobe-static')
    const bundled = (mod.path ?? mod.default?.path ?? mod.default) as string
    if (fileExists(bundled)) {
      cachedFfprobe = bundled
      return cachedFfprobe
    }
  } catch {
    // fall through
  }

  cachedFfprobe = null
  return null
}

function runProcess(
  executable: string,
  args: string[],
  timeout?: number
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })

    const timer =
      timeout != null
        ? setTimeout(() => {
            child.kill()
            reject(new Error(`Process timed out after ${timeout}ms`))
          }, timeout)
        : null

    child.on('error', err => {
      if (timer) clearTimeout(timer)
      reject(err)
    })

    child.on('close', code => {
      if (timer) clearTimeout(timer)
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        const message = stderr.trim() || stdout.trim() || `Process exited with code ${code}`
        reject(new Error(message))
      }
    })
  })
}

export async function runFfmpeg(args: string[], timeout?: number): Promise<void> {
  const ffmpeg = await getFfmpegPath()
  if (!ffmpeg) {
    throw new Error('FFMPEG_NOT_INSTALLED')
  }
  await runProcess(ffmpeg, args, timeout)
}

export async function runFfprobe(args: string[], timeout?: number): Promise<string> {
  const ffprobe = await getFfprobePath()
  if (!ffprobe) {
    throw new Error('FFPROBE_NOT_INSTALLED')
  }
  const { stdout } = await runProcess(ffprobe, args, timeout)
  return stdout
}

export async function ensureFfmpegAvailable(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const ffmpeg = await getFfmpegPath()
  if (!ffmpeg) {
    return {
      ok: false,
      error:
        'Video processing is unavailable. Run npm install in the project folder, restart the dev server, or install ffmpeg and add it to PATH.',
    }
  }
  return { ok: true }
}

export function formatFfmpegError(err: unknown): string {
  if (!(err instanceof Error)) return 'Unknown ffmpeg error'
  const message = err.message.trim()
  if (!message) return 'Unknown ffmpeg error'
  const lines = message.split(/\r?\n/).filter(Boolean)
  return lines.slice(-4).join(' ')
}
