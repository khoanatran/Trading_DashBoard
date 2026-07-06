import path from 'path'
import { formatFfmpegError, runFfmpeg, runFfprobe } from '@/lib/ffmpeg'

export function formatVideoTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toFixed(3).padStart(6, '0')}`
}

export async function getVideoDuration(filePath: string): Promise<number> {
  try {
    const stdout = await runFfprobe([
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ])
    return parseFloat(stdout.trim())
  } catch (err) {
    console.error('Failed to get video duration:', err)
    return 0
  }
}

function appendTrimArgs(
  args: string[],
  trimStart?: number,
  trimEnd?: number
): string | undefined {
  if (trimStart !== undefined && trimStart > 0) {
    args.push('-ss', formatVideoTime(trimStart))
  }

  if (trimStart !== undefined && trimEnd !== undefined) {
    const duration = trimEnd - trimStart
    args.push('-t', formatVideoTime(duration))
    return formatVideoTime(duration)
  }

  return undefined
}

export async function copyOrTrimMp4(
  inputPath: string,
  outputPath: string,
  trimStart?: number,
  trimEnd?: number
): Promise<void> {
  const args = ['-y']
  appendTrimArgs(args, trimStart, trimEnd)
  args.push('-i', inputPath, '-c', 'copy', '-movflags', '+faststart', outputPath)

  console.log('Running ffmpeg stream copy:', args.join(' '))
  await runFfmpeg(args, 60_000)
}

export async function convertToMp4(
  inputPath: string,
  outputPath: string,
  trimStart?: number,
  trimEnd?: number
): Promise<void> {
  const args = ['-y']
  appendTrimArgs(args, trimStart, trimEnd)
  args.push(
    '-i',
    inputPath,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-vf',
    "scale=-2:'min(1440,ih)'",
    '-c:v',
    'libx264',
    '-crf',
    '23',
    '-preset',
    'fast',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    '-max_muxing_queue_size',
    '1024',
    outputPath
  )

  console.log('Running ffmpeg convert:', args.join(' '))

  const timeout =
    trimStart !== undefined && trimEnd !== undefined ? 120_000 : 1_800_000

  await runFfmpeg(args, timeout)
}

export async function processUploadedVideo(
  inputPath: string,
  outputPath: string,
  originalName: string,
  trimStart?: number,
  trimEnd?: number
): Promise<void> {
  const isMp4 = originalName.toLowerCase().endsWith('.mp4')

  if (isMp4) {
    try {
      await copyOrTrimMp4(inputPath, outputPath, trimStart, trimEnd)
      return
    } catch (copyError) {
      console.warn('MP4 stream copy failed, falling back to re-encode:', copyError)
    }
  } else {
    console.log('Converting non-MP4 file to MP4')
  }

  await convertToMp4(inputPath, outputPath, trimStart, trimEnd)
}

export async function generateVideoThumbnail(
  videoPath: string,
  thumbPath: string
): Promise<void> {
  const args = [
    '-y',
    '-ss',
    '0.5',
    '-i',
    videoPath,
    '-vframes',
    '1',
    '-q:v',
    '2',
    '-vf',
    'scale=320:-1',
    thumbPath,
  ]

  try {
    await runFfmpeg(args, 30_000)
  } catch (err) {
    console.error('Failed to generate thumbnail:', err)
  }
}

export function videoProcessingErrorMessage(err: unknown): string {
  const detail = formatFfmpegError(err)
  return `Failed to process video. ${detail}`
}
