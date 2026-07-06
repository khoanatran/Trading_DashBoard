import path from 'path'
import {
  TRADE_EXPORT_DIR_NAME,
  TRADE_EXPORT_FILENAME,
  TRADE_EXPORT_ROOT_DIR,
} from '@/lib/trade-export-constants'

export { TRADE_EXPORT_DIR_NAME, TRADE_EXPORT_FILENAME, TRADE_EXPORT_ROOT_DIR }

export function getTradeExportDir(): string {
  return path.join(TRADE_EXPORT_ROOT_DIR, TRADE_EXPORT_DIR_NAME)
}

export function getTradeExportFilePath(): string {
  return path.join(getTradeExportDir(), TRADE_EXPORT_FILENAME)
}
