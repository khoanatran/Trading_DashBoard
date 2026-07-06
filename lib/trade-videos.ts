import fs from 'fs/promises'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), 'data')
export const VIDEOS_DIR = path.join(DATA_DIR, 'trade-videos')
const MAPPING_FILE = path.join(DATA_DIR, 'trade-videos.json')

export interface TradeVideo {
  id: string
  originalName: string
  mp4FileName: string
  thumbFileName?: string
  durationSec?: number
  clipStartSec?: number
  clipEndSec?: number
  createdAt: string
}

export type VideoMappingType = Record<string, TradeVideo[]>

export async function readVideoMapping(): Promise<VideoMappingType> {
  try {
    const content = await fs.readFile(MAPPING_FILE, 'utf-8')
    return JSON.parse(content)
  } catch {
    return {}
  }
}

export async function writeVideoMapping(mapping: VideoMappingType): Promise<void> {
  await fs.writeFile(MAPPING_FILE, JSON.stringify(mapping, null, 2), 'utf-8')
  const { notifyDataChanged } = await import('@/lib/notify-data-changed')
  notifyDataChanged('trade videos')
}
