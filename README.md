# Trading Performance Dashboard

A comprehensive Next.js application for analyzing trading performance from `trade_logs.txt` files. Built with modern web technologies for a beautiful, responsive trading journal experience.

## Table of Contents

- [Features](#features)
- [Architecture Overview](#architecture-overview)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Usage Guide](#usage-guide)
- [File Format](#file-format)
- [API Reference](#api-reference)
- [Technologies](#technologies)
- [Troubleshooting](#troubleshooting)

---

## Features

### Core Analytics
- **Multi-Period Analysis**: View performance breakdowns by Daily, Weekly, Monthly, and Yearly periods
- **Calendar Views**: Month, Week, and Day views with visual trade indicators
- **Comprehensive Charts**:
  - Equity Curve (cumulative P&L over time)
  - Win/Loss/BE Breakdown (pie chart)
  - Win Rate by Period
  - Average R:R Ratio by Period
  - P&L by Period
  - Average Risk by Period
  - Average Time in Trade
  - Entry Time Distribution (9:15 AM–12:00 PM ET, 15-minute Y-axis)
  - Win Rate by 5-Min Entry Window

### Performance Metrics
- Total Trades, Win Rate, Average R:R
- Avg Win R:R, Avg Loss R:R
- Win Rate (excluding breakeven trades)
- Profit Factor, Sharpe Ratio
- Max Drawdown, Current Streak
- Best and Worst Trades

### Journal & Media Attachments
- **Trade Journal**: Flat spreadsheet-like view of all trades with sorting and filtering
- **Image Attachments**: Attach screenshots to trades with:
  - Drawing tools (pen, highlighter, eraser)
  - Notes per image
  - Zoom and pan
  - Slideshow view
- **Video Clips**: Attach video recordings to trades with:
  - Local preview before upload
  - Trim/clip to exact timestamps (max 10 min)
  - Automatic MKV→MP4 conversion
  - Resolution downscaling to 1440p for faster processing
  - Thumbnail generation

### Organization
- **Tag System**: Categorize trades with customizable tags
- **Filter by Tags**: Filter journal by selected tags
- **Time Period Filters**: All Time, Since Nov 18, This Week, This Month, etc.
- **Custom Date Range**: Pick specific date ranges for analysis
- **Weekly Notes Timeline**: Add notes per week for reflection and rule tracking
- **Sortable Columns**: Sort by Date, Result, Direction, R:R, P&L

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLIENT (Browser)                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐     │
│  │   app/page.tsx  │    │   Components    │    │     Hooks       │     │
│  │   (Main Entry)  │───►│   (UI Layer)    │◄──►│  (State/Logic)  │     │
│  └────────┬────────┘    └────────┬────────┘    └─────────────────┘     │
│           │                      │                                       │
│           │    File Upload       │    Render Views                      │
│           │    (trade_logs.txt)  │                                       │
│           ▼                      ▼                                       │
│  ┌─────────────────┐    ┌─────────────────────────────────────────┐    │
│  │ utils/logParser │    │              Component Tree              │    │
│  │   (Parser)      │    │                                          │    │
│  │                 │    │  ┌─────────────┐  ┌─────────────────┐   │    │
│  │ - parseTradeLogs│    │  │CalendarView │  │  OverviewCards  │   │    │
│  │ - calculateStats│    │  │  WeekView   │  │     Charts      │   │    │
│  │ - aggregateBy   │    │  │  DayView    │  │PerformanceTable │   │    │
│  │   Period        │    │  └─────────────┘  └─────────────────┘   │    │
│  └─────────────────┘    │                                          │    │
│                         │  ┌─────────────┐  ┌─────────────────┐   │    │
│                         │  │JournalTable │  │WeeklyNotesTimeline│  │    │
│                         │  │(Trade List) │  │   (Reflection)   │  │    │
│                         │  └─────────────┘  └─────────────────┘   │    │
│                         └─────────────────────────────────────────┘    │
│                                      │                                   │
│                                      │ API Calls (media/tags/notes)     │
│                                      ▼                                   │
└─────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ HTTP
                                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          SERVER (Next.js API)                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      API Routes (app/api/)                       │   │
│  │                                                                   │   │
│  │  ┌───────────────────┐  ┌───────────────────┐  ┌─────────────┐  │   │
│  │  │  trade-images/    │  │  trade-videos/    │  │ trade-tags/ │  │   │
│  │  │  ├─ route.ts      │  │  ├─ route.ts      │  │ route.ts    │  │   │
│  │  │  ├─ upload/       │  │  ├─ upload/       │  └─────────────┘  │   │
│  │  │  └─ file/         │  │  ├─ clip/         │                   │   │
│  │  └───────────────────┘  │  └─ file/         │  ┌─────────────┐  │   │
│  │                         └───────────────────┘  │weekly-notes/│  │   │
│  │                                                 │ route.ts    │  │   │
│  │                                                 └─────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                       │                                  │
│                                       │ File I/O                        │
│                                       ▼                                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      Local Data Storage (data/)                  │   │
│  │                                                                   │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │   │
│  │  │ trade-images/   │  │ trade-videos/   │  │   JSON Files    │  │   │
│  │  │ (PNG, JPG)      │  │ (MP4, JPG)      │  │                 │  │   │
│  │  └─────────────────┘  └─────────────────┘  │ trade-images.json│ │   │
│  │                                             │ trade-videos.json│ │   │
│  │                                             │ trade-tags.json  │ │   │
│  │                                             │ weekly-notes.json│ │   │
│  │                                             └─────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      External Tools                              │   │
│  │                                                                   │   │
│  │  FFmpeg - Video conversion (MKV→MP4), trimming, thumbnails       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Trade Log Parsing**
   - User uploads `trade_logs.txt` file
   - `logParser.ts` parses the file client-side
   - Extracts trade data: timestamps, direction, entry/exit, R:R, P&L
   - Handles partial exits and position sizing

2. **Analytics Calculation**
   - `calculateStats()` computes all performance metrics
   - `aggregateByPeriod()` groups trades for time-series analysis
   - `calculateStreaks()` tracks winning/losing streaks
   - BE threshold: ±0.25R defines breakeven trades

3. **Media Attachments**
   - Images uploaded via `/api/trade-images/upload`
   - Videos processed via FFmpeg for trimming/conversion
   - Metadata stored in JSON files, media in subdirectories
   - Trade ID format: `{sourceFile}::{timestamp}`

4. **State Management**
   - React useState/useMemo for client-side state
   - No external state library (intentionally lightweight)
   - All data persists locally in `/data/` directory

---

## Project Structure

```
trading-dashboard/
├── app/                          # Next.js App Router
│   ├── api/                      # API Routes
│   │   ├── trade-images/         # Image management
│   │   │   ├── route.ts          # GET, DELETE, PATCH (list, delete, update note)
│   │   │   ├── upload/route.ts   # POST (upload images)
│   │   │   └── file/route.ts     # GET (serve image files)
│   │   ├── trade-videos/         # Video management
│   │   │   ├── route.ts          # GET, DELETE (list, delete)
│   │   │   ├── upload/route.ts   # POST (upload for preview)
│   │   │   ├── clip/route.ts     # POST (save trimmed clip)
│   │   │   └── file/route.ts     # GET (serve video/thumbnail)
│   │   ├── trade-tags/           # Tag management
│   │   │   └── route.ts          # GET, POST (manage tags per trade)
│   │   ├── trade-media/          # Batch media fetch
│   │   │   └── batch/route.ts    # POST (batch fetch media for multiple trades)
│   │   └── weekly-notes/         # Weekly notes
│   │       └── route.ts          # GET, POST (manage weekly reflections)
│   ├── globals.css               # Global styles + Tailwind
│   ├── layout.tsx                # Root layout
│   └── page.tsx                  # Main dashboard page
│
├── components/                   # React Components
│   ├── ui/                       # shadcn/ui base components
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── calendar.tsx
│   │   └── popover.tsx
│   ├── CalendarView.tsx          # Monthly calendar with trade stats
│   ├── WeekView.tsx              # Weekly breakdown view
│   ├── DayView.tsx               # Daily detail view
│   ├── OverviewCards.tsx         # Summary metric cards
│   ├── Charts.tsx                # All chart visualizations
│   ├── PerformanceTable.tsx      # Period performance table
│   ├── JournalTable.tsx          # Trade-by-trade journal
│   ├── TradeDetailTable.tsx      # Individual trade details
│   ├── DayOfWeekStats.tsx        # Day-of-week analysis
│   ├── WeeklyNoteModal.tsx       # Weekly note editor
│   ├── WeeklyNotesTimeline.tsx   # Timeline of weekly notes
│   ├── DateRangePicker.tsx       # Date range selector
│   ├── CustomDateRangePicker.tsx # Custom range picker
│   └── CustomCalendar.tsx        # Styled calendar component
│
├── utils/                        # Utility functions
│   ├── logParser.ts              # Trade log parser + stats calculations
│   ├── mediaCache.ts             # Media caching utilities
│   └── tradingDays.ts            # Trading day helpers
│
├── hooks/                        # Custom React hooks
│   ├── useLazyMedia.ts           # Lazy loading for media
│   └── useVirtualizedList.ts     # List virtualization
│
├── data/                         # Local data storage
│   ├── trade-images/             # Uploaded images (gitignored)
│   ├── trade-videos/             # Processed videos (gitignored)
│   ├── trade-images.json         # Image metadata & drawings
│   ├── trade-videos.json         # Video metadata
│   ├── trade-tags.json           # Trade tag assignments
│   └── weekly-notes.json         # Weekly reflections
│
├── lib/
│   └── utils.ts                  # cn() helper for class names
│
├── public/                       # Static assets
├── package.json                  # Dependencies
├── tsconfig.json                 # TypeScript config
├── tailwind.config.ts            # Tailwind CSS config
├── next.config.js                # Next.js config
└── postcss.config.js             # PostCSS config
```

---

## Getting Started

### Prerequisites

- **Node.js 18+** installed
- **npm** or **yarn** package manager
- **ffmpeg** (required for video features)

### Installing ffmpeg

#### Ubuntu/Debian (WSL):
```bash
sudo apt update
sudo apt install ffmpeg
```

#### macOS:
```bash
brew install ffmpeg
```

#### Windows:
Download from https://ffmpeg.org/download.html and add to PATH.

Verify installation:
```bash
ffmpeg -version
```

### Installation

1. Clone or navigate to the project directory:
```bash
cd trading-dashboard
```

2. Install dependencies:
```bash
npm install
```

3. Create data directories (if not present):
```bash
mkdir -p data/trade-images data/trade-videos
```

4. Start the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

### Available Scripts

```bash
npm run dev        # Start dev server with hot reload
npm run dev:turbo  # Start dev server with Turbopack (faster)
npm run dev:clean  # Clean .next cache and start fresh
npm run build      # Production build
npm start          # Start production server
npm run lint       # Run ESLint
npm run clean      # Clean caches
```

---

## Usage Guide

### 1. Loading Trade Data

1. Click the **"Upload trade_logs.txt"** button
2. Select your `trade_logs.txt` file
3. The dashboard automatically parses and displays your performance

### 2. Navigation Views

- **Month View**: Calendar with daily stats, click any day to drill down
- **Week View**: Weekly breakdown with daily columns
- **Day View**: Detailed view of all trades on a specific day
- **Overview**: Charts and aggregate statistics
- **Journal**: Spreadsheet view of all trades
- **Timeline**: Weekly notes and reflections

### 3. Attaching Media

**Images:**
1. Click the image icon (📷) on any trade row in Journal view
2. Select images to upload
3. Click thumbnails to view in modal
4. Use drawing tools (pen, highlighter, eraser) to annotate
5. Add notes below each image

**Videos:**
1. Click the video icon (🎬) on any trade row
2. Select a video file (MKV, MP4, MOV, etc.)
3. Preview plays locally (instant, no upload yet)
4. Set trim start/end times using scrubber or "Use Current" buttons
5. Click "Save Clip" to upload only the trimmed portion
6. Video is converted to MP4 at 1440p and saved

### 4. Tagging Trades

1. In Journal view, click the tag column for any trade
2. Select existing tags or type to create new ones
3. Filter journal by clicking tags in the filter bar

### 5. Weekly Notes

1. Navigate to Timeline view
2. Click on any week to add/edit notes
3. Record lessons learned, rule changes, market observations

---

## File Format

The application expects a `trade_logs.txt` file with the following format:

### Basic Trade (Full Exit)
```
2026-01-15 06:45:21,074 - === NEW TRADE ===
2026-01-15 06:45:21,074 - Trade timestamp: 2026-01-15 06:45:21.074255
2026-01-15 06:45:21,074 - Direction: long
2026-01-15 06:45:21,074 - Risk amount: $250
2026-01-15 06:45:21,074 - SL points: 18.0
2026-01-15 06:45:21,074 - TP points: 36.0
2026-01-15 06:45:21,074 - Order quantity: 7
2026-01-15 06:45:21,074 - Est dollar risked: $252.00
2026-01-15 06:46:25,500 - === TRADE CLOSED ===
2026-01-15 06:46:25,500 - Entry: 24895.0 | Exit: 24931.0
2026-01-15 06:46:25,500 - Risk: 18.0 pts | Reward: 36.0 pts
2026-01-15 06:46:25,500 - R:R Ratio: 2.00R
2026-01-15 06:46:25,500 - P&L: $504.00
```

### Trade with Partial Exits
```
2026-01-20 07:10:42,746 - === NEW TRADE ===
2026-01-20 07:10:42,746 - Trade timestamp: 2026-01-20 07:10:42.746134
2026-01-20 07:10:42,746 - Direction: short
2026-01-20 07:10:42,746 - Risk amount: $250
2026-01-20 07:10:42,746 - SL points: 15.0
2026-01-20 07:10:42,746 - TP points: 45.0
2026-01-20 07:10:42,746 - Order quantity: 8
2026-01-20 07:10:42,746 - Est dollar risked: $240.00
2026-01-20 07:12:30,500 - --- PARTIAL EXIT (4 contracts) ---
2026-01-20 07:12:30,500 - Exit Price: 21850.0 | Entry: 21880.0
2026-01-20 07:12:30,500 - Reward: 30.0 pts | R:R: 2.00R
2026-01-20 07:12:30,500 - Partial P&L: $240.00
2026-01-20 07:12:30,500 - Cumulative P&L: $240.00
2026-01-20 07:12:30,500 - ---
2026-01-20 07:15:45,200 - Flattening full position: 4 contracts at 21865.0
2026-01-20 07:15:45,200 - --- FINAL EXIT (4 contracts) ---
2026-01-20 07:15:45,200 - Final Exit P&L: $60.00
2026-01-20 07:15:45,200 - ---
2026-01-20 07:15:45,200 - Position fully closed
2026-01-20 07:15:45,200 - === TRADE CLOSED ===
2026-01-20 07:15:45,200 - Entry: 21880.0 | Exit: 21865.0
2026-01-20 07:15:45,200 - Risk: 15.0 pts | Reward: 15.0 pts
2026-01-20 07:15:45,200 - R:R Ratio: 1.00R
2026-01-20 07:15:45,200 - P&L: $300.00
```

### Key Fields
| Field | Description |
|-------|-------------|
| Trade timestamp | When the trade was entered |
| Direction | `long` or `short` |
| Risk amount | Intended risk in dollars |
| SL points | Stop loss distance in points |
| TP points | Take profit distance in points |
| Order quantity | Number of contracts |
| Est dollar risked | Actual calculated risk |
| Entry/Exit | Prices |
| R:R Ratio | Risk-to-Reward achieved |
| P&L | Profit/Loss in dollars |

---

## API Reference

### Trade Images

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/trade-images?tradeId=X` | GET | List images for a trade |
| `/api/trade-images/upload` | POST | Upload images |
| `/api/trade-images/file?name=X` | GET | Serve image file |
| `/api/trade-images?tradeId=X&name=Y` | DELETE | Delete image |
| `/api/trade-images` | PATCH | Update note/drawings |

### Trade Videos

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/trade-videos?tradeId=X` | GET | List videos for a trade |
| `/api/trade-videos/upload` | POST | Upload for preview |
| `/api/trade-videos/clip` | POST | Save trimmed clip |
| `/api/trade-videos/file?name=X` | GET | Serve video/thumbnail |
| `/api/trade-videos?tradeId=X&videoId=Y` | DELETE | Delete video |

### Trade Tags

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/trade-tags?tradeId=X` | GET | Get tags for trade |
| `/api/trade-tags` | POST | Update tags |

### Weekly Notes

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/weekly-notes` | GET | Get all weekly notes |
| `/api/weekly-notes` | POST | Save weekly note |

---

## Technologies

| Category | Technology |
|----------|------------|
| Framework | Next.js 15 (App Router) |
| UI Library | React 19 |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 3 |
| Charts | Recharts |
| Date Utils | date-fns |
| Calendar | react-day-picker |
| UI Components | shadcn/ui (Radix primitives) |
| Video Processing | FFmpeg |
| Icons | Lucide React |

---

## Troubleshooting

### Video upload stuck on "Converting..."
- Ensure ffmpeg is installed: `ffmpeg -version`
- Check that the video file is valid
- Try a shorter clip (under 10 minutes)
- Check terminal for ffmpeg error messages

### Images/Drawings not persisting
- Check that `data/` directory exists and is writable
- Verify `data/trade-images.json` is valid JSON
- Check browser console for API errors

### Trades not parsing correctly
- Verify log file format matches expected structure
- Check for encoding issues (should be UTF-8)
- Look at browser console for parsing errors

### Timezone issues in charts
- The app normalizes timestamps to Eastern Time
- Trades before Nov 17, 2025 are assumed ET
- Trades after Nov 17, 2025 are assumed PT (converted to ET)

### Hot reload not working
- Run `npm run dev:clean` to clear Next.js cache
- Delete `.next` folder manually if needed
- Check `HOT_RELOAD_TIPS.md` for more solutions

### Performance issues with large log files
- The app handles 1000+ trades well
- For very large files, charts may be slower
- Journal view uses virtualization for performance

---

## License

Private project for personal use.

---

## Contributing

This is a personal trading journal. Feel free to fork and customize for your own use.
