import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), 'data')
const NOTES_FILE = path.join(DATA_DIR, 'weekly-notes.json')

interface WeeklyNote {
  content: string
  updatedAt: string
}

type NotesMapping = Record<string, WeeklyNote>

// Ensure data directory exists
async function ensureDataDir(): Promise<void> {
  try {
    await fs.access(DATA_DIR)
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true })
  }
}

// Read notes mapping
async function readNotes(): Promise<NotesMapping> {
  try {
    const content = await fs.readFile(NOTES_FILE, 'utf-8')
    return JSON.parse(content) as NotesMapping
  } catch {
    return {}
  }
}

// Write notes mapping
async function writeNotes(notes: NotesMapping): Promise<void> {
  await ensureDataDir()
  await fs.writeFile(NOTES_FILE, JSON.stringify(notes, null, 2), 'utf-8')
  const { notifyDataChanged } = await import('@/lib/notify-data-changed')
  notifyDataChanged('weekly notes')
}

/**
 * GET /api/weekly-notes
 * Get all weekly notes or a specific week's note
 * Query params:
 *   - weekKey: optional, e.g., "2026-W03" to get a specific week's note
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const weekKey = searchParams.get('weekKey')
    
    const notes = await readNotes()
    
    if (weekKey) {
      // Return specific week's note
      const note = notes[weekKey]
      return NextResponse.json({
        weekKey,
        note: note || null
      })
    }
    
    // Return all notes sorted by week key (descending - most recent first)
    const sortedNotes = Object.entries(notes)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([weekKey, note]) => ({
        weekKey,
        ...note
      }))
    
    return NextResponse.json({ notes: sortedNotes })
  } catch (error) {
    console.error('Error reading weekly notes:', error)
    return NextResponse.json({ error: 'Failed to read notes' }, { status: 500 })
  }
}

/**
 * POST /api/weekly-notes
 * Create or update a weekly note
 * Body: { weekKey: string, content: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { weekKey, content } = body as { weekKey: string; content: string }
    
    if (!weekKey) {
      return NextResponse.json({ error: 'weekKey is required' }, { status: 400 })
    }
    
    // Validate week key format (YYYY-WXX)
    if (!/^\d{4}-W\d{2}$/.test(weekKey)) {
      return NextResponse.json({ error: 'Invalid weekKey format. Expected YYYY-WXX' }, { status: 400 })
    }
    
    const notes = await readNotes()
    
    if (content && content.trim()) {
      // Create or update note
      notes[weekKey] = {
        content: content.trim(),
        updatedAt: new Date().toISOString()
      }
    } else {
      // Delete note if content is empty
      delete notes[weekKey]
    }
    
    await writeNotes(notes)
    
    return NextResponse.json({
      success: true,
      weekKey,
      note: notes[weekKey] || null
    })
  } catch (error) {
    console.error('Error saving weekly note:', error)
    return NextResponse.json({ error: 'Failed to save note' }, { status: 500 })
  }
}

/**
 * DELETE /api/weekly-notes
 * Delete a weekly note
 * Query params: weekKey
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const weekKey = searchParams.get('weekKey')
    
    if (!weekKey) {
      return NextResponse.json({ error: 'weekKey is required' }, { status: 400 })
    }
    
    const notes = await readNotes()
    delete notes[weekKey]
    await writeNotes(notes)
    
    return NextResponse.json({ success: true, weekKey })
  } catch (error) {
    console.error('Error deleting weekly note:', error)
    return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 })
  }
}
