/**
 * HeatmapHighlight.cpp
 *
 * Custom Sierra Chart ACSIL study for the SC_Heatmap_2026 chart.
 *
 * ── Trigger ──────────────────────────────────────────────────────────────────
 * Uses sc.p_VolumeLevelAtPriceForBars — the same data source that the built-in
 * "Large Volume Trade Indicator" reads — so the trigger fires at exactly the same
 * price ticks and bars as that indicator.  A tick qualifies when:
 *
 *     max(BidTradeVolume, AskTradeVolume)  >=  Volume Threshold
 *
 * BidTradeVolume / AskTradeVolume are the totals of all individual large trades
 * at that price tick for the bar, already filtered to the "above threshold" level
 * stored in the volume-level container.  This prevents false triggers on volume
 * bars where cumulative per-tick VAP can easily exceed the threshold from many
 * small trades — the exact bug seen on the 300-Volume heatmap chart.
 *
 * Fallback: if p_VolumeLevelAtPriceForBars is null (no large-volume-at-price
 * data yet recorded for this chart), the study logs a warning and skips the bar.
 *
 * ── Conditions (both must be met for a highlight to appear) ──────────────────
 *
 *   Condition 1 – "Recent DOM block":
 *     A resting limit order of >= MinBlockLots was visible in the Market Depth
 *     Historical data at that exact price tick within the last ShortLookback
 *     minutes before the trigger bar.
 *
 *   Condition 2 – "Long-lived DOM block" (two sub-conditions, both required):
 *     (a) EXISTS: the same price tick had a DOM block of >= ConsistentLots (default
 *         10, shared with C2b) at some point at least LongLookback (default 120)
 *         minutes before the trigger.
 *     (b) CONSISTENT: within ConsistentMaxLookback hours before the trigger (default
 *         36 h), there is a continuous stretch of at least ConsistentDuration
 *         (default 60 min) where the DOM block at that tick was >= ConsistentLots
 *         (default 10) without interruption.  Bars with no depth snapshot are
 *         gap-bridged (common on volume charts).  Bars with depth but Q < ConsistentLots
 *         are also bridged for up to C2bSubThresholdGapMin minutes (default 5) and/or
 *         C2bSubThresholdGapBars bars (default 0 = no bar limit); exceeding either limit
 *         resets the streak.  Set gap minutes to 0 for strict reset on any sub-threshold
 *         snapshot.  C2b duration and Active Window use trading time only — gaps between
 *         chart bars longer than ClosedMarketGapMin (default 180 min) are treated as
 *         market closed (Fri evening → Sun open, holidays with no bars) and excluded.
 *         The C2b scan does not look back beyond ConsistentMaxLookback trading hours.
 *
 * ── Visual output ────────────────────────────────────────────────────────────
 * Highlights are only drawn when the trigger occurred within the last ActiveHours
 * (default 18 trading hours, adjustable).  Older triggers are silently skipped.
 *
 * Each qualifying level is rendered as TWO adjoining rectangles:
 *
 *   LEFT  (C2StartBarIndex → TrigBarIndex-1):
 *     Covers the historical period where Condition 2 was met.
 *     Default: grey fill (opacity 90), no border.  Fully adjustable.
 *
 *   RIGHT (TrigBarIndex → live right edge):
 *     Covers from the trigger bar to the current bar.
 *     Default: red fill (opacity 70), dark-red border.  Fully adjustable.
 *
 * Band height: exactly 1 chart tick wide by default.
 * "Extra Ticks" expands by N ticks above and below.
 *
 * Performance: incremental scan — full active window only on recalc; on each new
 * bar scans ~50-bar recheck tail plus new bars; on intrabar ticks scans 1 bar only.
 * Draw/prune run only when a new bar forms or a highlight changes.
 */

#include "sierrachart.h"
#include "ACSILDepthBars.h"

SCDLLName("Heatmap Highlight")

// ── Internal types ────────────────────────────────────────────────────────────

namespace {

const int MAX_HIGHLIGHTS = 128;

struct s_HighlightEntry
{
	float  Price           = 0.0f;
	float  PriceTop        = 0.0f;
	float  PriceBot        = 0.0f;
	int    TrigBarIndex    = 0;     // bar where the large-volume trigger fired (right-zone start)
	int    C2StartBarIndex = 0;     // earliest bar of the C2b consistent stretch (left-zone start)
	double DomTradeVol     = 0.0;   // max(BidTradeVol, AskTradeVol) at trigger tick
	int    BlockQtyC1      = 0;     // DOM block qty found in short window (C1)
	int    BlockQtyC2exist = 0;     // DOM block qty found in long window (C2a)
	int    BlockQtyC2cons  = 0;     // DOM block qty at start of consistent streak (C2b)
};

struct s_StudyCache
{
	s_HighlightEntry Highlights[MAX_HIGHLIGHTS];
	int              HighlightCount  = 0;
	int              LastScannedBar  = -1;   // highest bar index scanned for triggers
	int              LastDrawnBar    = -1;   // last bar index used for right-edge draw
	int              ActiveScanStart = 0;    // cached oldest bar in active window
	int              LastBarCached   = -1;   // bar index used for ActiveScanStart cache
	bool             DrawDirty       = false;
	int              LastVisualSig   = 0;    // detects color/border input changes
};

// Bars to re-scan behind the last scanned bar on each new bar.  Covers late-arriving
// p_VolumeLevelAtPriceForBars data without rescanning the full active window.
const int RECHECK_BARS = 50;

// ── Helpers ───────────────────────────────────────────────────────────────────

static int64_t DTtoUs(const SCDateTime& DT)
{
	return static_cast<int64_t>(DT.GetAsDouble() * 86400.0 * 1000000.0 + 0.5);
}

static void DebugLogMsg(SCStudyInterfaceRef sc, bool Debug, const SCString& Msg)
{
	if (Debug)
		sc.AddMessageToLog(Msg, 0);
}

static int FindHighlightByPrice(s_HighlightEntry* Highlights, int Count,
                                float Price, float TickEps)
{
	for (int h = 0; h < Count; ++h)
	{
		if (fabsf(Highlights[h].Price - Price) <= TickEps)
			return h;
	}
	return -1;
}

static void UpsertHighlight(s_StudyCache* p, const s_HighlightEntry& H, float TickEps)
{
	const int ExistingIdx = FindHighlightByPrice(p->Highlights, p->HighlightCount,
	                                             H.Price, TickEps);
	if (ExistingIdx >= 0)
	{
		if (H.TrigBarIndex >= p->Highlights[ExistingIdx].TrigBarIndex)
		{
			p->Highlights[ExistingIdx] = H;
			p->DrawDirty = true;
		}
		return;
	}

	if (p->HighlightCount < MAX_HIGHLIGHTS)
	{
		p->Highlights[p->HighlightCount++] = H;
		p->DrawDirty = true;
	}
}

// Gaps between consecutive chart bars longer than this are treated as market closed
// (weekend Fri→Sun, holidays with no trade data) and excluded from trading-time totals.
static bool IsMarketClosedGap(int64_t NewerBarUs, int64_t OlderBarUs,
                              int64_t ClosedGapThresholdUs)
{
	if (ClosedGapThresholdUs <= 0)
		return false;
	return (NewerBarUs - OlderBarUs) > ClosedGapThresholdUs;
}

static int64_t TradingSpanUs(int64_t NewerBarUs, int64_t OlderBarUs,
                             int64_t ClosedGapThresholdUs)
{
	const int64_t GapUs = NewerBarUs - OlderBarUs;
	if (GapUs <= 0)
		return 0;
	if (IsMarketClosedGap(NewerBarUs, OlderBarUs, ClosedGapThresholdUs))
		return 0;
	return GapUs;
}

static int64_t TradingTimeBetweenBars(SCStudyInterfaceRef sc, int FromBar, int ToBar,
                                      int64_t ClosedGapThresholdUs)
{
	if (FromBar >= ToBar)
		return 0;

	int64_t Total = 0;
	for (int b = FromBar + 1; b <= ToBar; ++b)
	{
		Total += TradingSpanUs(DTtoUs(sc.BaseDateTimeIn[b]),
		                       DTtoUs(sc.BaseDateTimeIn[b - 1]),
		                       ClosedGapThresholdUs);
	}
	return Total;
}

// Oldest bar index still within MaxTradingUs of EndBar (trading time, not wall clock).
static int FindTradingLookbackStartBar(SCStudyInterfaceRef sc, int EndBar,
                                       int64_t MaxTradingUs,
                                       int64_t ClosedGapThresholdUs)
{
	if (MaxTradingUs <= 0)
		return 0;

	int64_t Accumulated = 0;
	for (int b = EndBar; b > 0; --b)
	{
		Accumulated += TradingSpanUs(DTtoUs(sc.BaseDateTimeIn[b]),
		                             DTtoUs(sc.BaseDateTimeIn[b - 1]),
		                             ClosedGapThresholdUs);
		if (Accumulated >= MaxTradingUs)
			return b;
	}
	return 0;
}

static void PruneHighlightsOutsideWindow(SCStudyInterfaceRef sc, s_StudyCache* p,
                                         int LastBar, int64_t MaxTradingUs,
                                         int64_t ClosedGapThresholdUs)
{
	int WriteIdx = 0;
	for (int i = 0; i < p->HighlightCount; ++i)
	{
		const int TrigBar = p->Highlights[i].TrigBarIndex;
		if (TradingTimeBetweenBars(sc, TrigBar, LastBar, ClosedGapThresholdUs) <= MaxTradingUs)
			p->Highlights[WriteIdx++] = p->Highlights[i];
	}
	p->HighlightCount = WriteIdx;
}

static int GetActiveScanStartBar(SCStudyInterfaceRef sc, s_StudyCache* p,
                                 int LastBar, int64_t MaxTradingUs,
                                 int64_t ClosedGapThresholdUs)
{
	if (p->LastBarCached == LastBar)
		return p->ActiveScanStart;

	p->ActiveScanStart = FindTradingLookbackStartBar(sc, LastBar, MaxTradingUs,
	                                                 ClosedGapThresholdUs);
	p->LastBarCached   = LastBar;
	return p->ActiveScanStart;
}

static int ScanDepthFirst(c_ACSILDepthBars* pDepth, int Tick,
                          int ScanFrom, int ScanEnd, int Step, int MinQty);

static int ScanC2Consistent(SCStudyInterfaceRef sc,
                             c_ACSILDepthBars* pDepth,
                             int Tick, int LongEndBar, int C2bMinBar,
                             int ConsistentLots, int64_t RequiredStreakUs,
                             int64_t MaxSubThresholdGapUs,
                             int MaxSubThresholdGapBars,
                             int64_t ClosedGapThresholdUs,
                             int& OutStreakStartBar);

// Evaluate one chart bar for qualifying large-volume triggers.
static void ProcessBarForTriggers(SCStudyInterfaceRef sc,
                                  s_StudyCache* p,
                                  const c_VolumeLevelAtPriceContainer* pVolLevel,
                                  c_ACSILDepthBars* pDepth,
                                  int BarIdx,
                                  double VolThreshold,
                                  int MinBlock, int ShortMin, int LongMin,
                                  int ConsistLots, int ConsistMin, int ConsistMaxHours,
                                  int64_t ShortUs, int64_t LongUs, int64_t ConsistUs,
                                  int64_t ConsistMaxUs,
                                  int64_t C2bSubGapUs, int C2bSubGapBars,
                                  int64_t ClosedGapThresholdUs,
                                  float HalfHt, float TickEps,
                                  bool Debug)
{
	if (pVolLevel->GetSizeAtBarIndex(static_cast<unsigned int>(BarIdx)) == 0)
		return;

	const int64_t BarUs = DTtoUs(sc.BaseDateTimeIn[BarIdx]);

	int PriceInTicks = INT_MIN;
	const s_VolumeLevelAtPrice* pEl = nullptr;

	while (pVolLevel->GetNextHigherVAPElement(
	           static_cast<unsigned int>(BarIdx), PriceInTicks, &pEl) && pEl)
	{
		const double DomVol = (pEl->AskTradeVolume >= pEl->BidTradeVolume)
		                    ? pEl->AskTradeVolume : pEl->BidTradeVolume;

		if (DomVol < VolThreshold)
			continue;

		const float LevelPrice = static_cast<float>(
			sc.TicksToPriceValue(static_cast<int64_t>(PriceInTicks)));

		if (!pDepth || pDepth->NumBars() <= 0)
		{
			if (Debug)
			{
				SCString Msg;
				Msg.Format(
					"HeatmapHighlight bar=%d price=%.2f: pDepth unavailable",
					BarIdx, static_cast<double>(LevelPrice));
				DebugLogMsg(sc, Debug, Msg);
			}
			continue;
		}

		const int DTickIdx = pDepth->PriceToTickIndex(LevelPrice);

		int ShortStartBar = BarIdx;
		while (ShortStartBar > 0
		       && DTtoUs(sc.BaseDateTimeIn[ShortStartBar - 1]) >= BarUs - ShortUs)
		{
			--ShortStartBar;
		}

		int LongEndBar = -1;
		for (int b = BarIdx - 1; b >= 0; --b)
		{
			if (DTtoUs(sc.BaseDateTimeIn[b]) <= BarUs - LongUs)
			{
				LongEndBar = b;
				break;
			}
		}

		if (LongEndBar < 0)
		{
			if (Debug)
			{
				SCString Msg;
				Msg.Format(
					"HeatmapHighlight bar=%d price=%.2f domVol=%.0f: "
					"SKIP — not enough history for LongLookback=%dmin",
					BarIdx, static_cast<double>(LevelPrice), DomVol, LongMin);
				DebugLogMsg(sc, Debug, Msg);
			}
			continue;
		}

		const int C1Qty = ScanDepthFirst(pDepth, DTickIdx,
		                                 BarIdx, ShortStartBar, -1, MinBlock);
		if (C1Qty == 0)
		{
			if (Debug)
			{
				SCString Msg;
				Msg.Format(
					"HeatmapHighlight bar=%d price=%.2f domVol=%.0f: "
					"SKIP C1 — no DOM block >= %d lots within %dmin",
					BarIdx, static_cast<double>(LevelPrice), DomVol,
					MinBlock, ShortMin);
				DebugLogMsg(sc, Debug, Msg);
			}
			continue;
		}

		const int C2aQty = ScanDepthFirst(pDepth, DTickIdx,
		                                  LongEndBar, 0, -1, ConsistLots);
		if (C2aQty == 0)
		{
			if (Debug)
			{
				SCString Msg;
				Msg.Format(
					"HeatmapHighlight bar=%d price=%.2f domVol=%.0f C1=%d: "
					"SKIP C2a — no DOM block >= %d lots before longEndBar=%d",
					BarIdx, static_cast<double>(LevelPrice), DomVol, C1Qty,
					ConsistLots, LongEndBar);
				DebugLogMsg(sc, Debug, Msg);
			}
			continue;
		}

		int C2StartBar = -1;
		const int C2bMinBar = FindTradingLookbackStartBar(sc, BarIdx, ConsistMaxUs,
		                                                   ClosedGapThresholdUs);
		const int C2bQty = ScanC2Consistent(sc, pDepth, DTickIdx, LongEndBar, C2bMinBar,
		                                    ConsistLots, ConsistUs,
		                                    C2bSubGapUs, C2bSubGapBars,
		                                    ClosedGapThresholdUs,
		                                    C2StartBar);
		if (C2bQty == 0 || C2StartBar < 0)
		{
			if (Debug)
			{
				SCString Msg;
				Msg.Format(
					"HeatmapHighlight bar=%d price=%.2f domVol=%.0f C1=%d C2a=%d: "
					"SKIP C2b — no continuous %dmin stretch >= %d lots within %dh trading hours before trigger",
					BarIdx, static_cast<double>(LevelPrice), DomVol, C1Qty, C2aQty,
					ConsistMin, ConsistLots, ConsistMaxHours);
				DebugLogMsg(sc, Debug, Msg);
			}
			continue;
		}

		s_HighlightEntry H;
		H.Price           = LevelPrice;
		H.PriceTop        = LevelPrice + HalfHt;
		H.PriceBot        = LevelPrice - HalfHt;
		H.TrigBarIndex    = BarIdx;
		H.C2StartBarIndex = C2StartBar;
		H.DomTradeVol     = DomVol;
		H.BlockQtyC1      = C1Qty;
		H.BlockQtyC2exist = C2aQty;
		H.BlockQtyC2cons  = C2bQty;

		UpsertHighlight(p, H, TickEps);

		if (Debug)
		{
			SCString Msg;
			Msg.Format(
				"HeatmapHighlight TRIGGER bar=%d price=%.2f "
				"domTradeVol=%.0f (bid=%.0f ask=%.0f) "
				"C1_qty=%d C2a_qty=%d C2b_peakQty=%d rect[bar%d..bar%d]",
				BarIdx, static_cast<double>(LevelPrice),
				DomVol, pEl->BidTradeVolume, pEl->AskTradeVolume,
				C1Qty, C2aQty, C2bQty, C2StartBar, BarIdx);
			DebugLogMsg(sc, Debug, Msg);
		}
	}
}

// 4 line-number slots per highlight: left-fill, left-border, right-fill, right-border
static void EraseDrawings(SCStudyInterfaceRef sc, int From, int To)
{
	const int Base = sc.StudyGraphInstanceID * 10000;
	for (int i = From; i < To; ++i)
	{
		sc.DeleteACSChartDrawing(sc.ChartNumber, TOOL_DELETE_CHARTDRAWING, Base + i * 4);
		sc.DeleteACSChartDrawing(sc.ChartNumber, TOOL_DELETE_CHARTDRAWING, Base + i * 4 + 1);
		sc.DeleteACSChartDrawing(sc.ChartNumber, TOOL_DELETE_CHARTDRAWING, Base + i * 4 + 2);
		sc.DeleteACSChartDrawing(sc.ChartNumber, TOOL_DELETE_CHARTDRAWING, Base + i * 4 + 3);
	}
}

// Draws two adjoining rectangles for one highlight entry.
//
// LEFT  rect  [C2StartBarIndex → TrigBarIndex-1]: the C2 historical zone (grey by default)
// RIGHT rect  [TrigBarIndex    → ArraySize-1   ]: post-trigger zone     (red  by default)
//
// Line-number layout (4 slots per entry, Base = StudyGraphInstanceID * 10000):
//   Base + SlotIndex*4 + 0  →  left  fill
//   Base + SlotIndex*4 + 1  →  left  border
//   Base + SlotIndex*4 + 2  →  right fill
//   Base + SlotIndex*4 + 3  →  right border
static void DrawOneHighlight(SCStudyInterfaceRef sc,
                             const s_HighlightEntry& H,
                             int SlotIndex,
                             COLORREF LFillCol,   int LFillTrans,
                             COLORREF LBorderCol, int LBorderTrans,
                             bool LShowBorder,
                             COLORREF RFillCol,   int RFillTrans,
                             COLORREF RBorderCol, int RBorderTrans,
                             bool RShowBorder)
{
	const int Base     = sc.StudyGraphInstanceID * 10000;
	const int LFillLn  = Base + SlotIndex * 4;
	const int LBordLn  = Base + SlotIndex * 4 + 1;
	const int RFillLn  = Base + SlotIndex * 4 + 2;
	const int RBordLn  = Base + SlotIndex * 4 + 3;

	const int LeftStart  = H.C2StartBarIndex;    // left  edge of grey zone
	const int LeftEnd    = H.TrigBarIndex - 1;   // right edge of grey zone (exclusive of trigger)
	const int RightStart = H.TrigBarIndex;       // left  edge of red zone
	const int RightEnd   = sc.ArraySize - 1;     // live  right edge

	auto DrawRect = [&](int LineNum, int BeginIdx, int EndIdx,
	                    COLORREF Col, int Trans, int LineWidth, int OutlineOnly)
	{
		s_UseTool T;
		T.Clear();
		T.ChartNumber             = sc.ChartNumber;
		T.Region                  = 0;
		T.AddMethod               = UTAM_ADD_OR_ADJUST;
		T.DrawUnderneathMainGraph = 0;
		T.DrawingType             = DRAWING_RECTANGLEHIGHLIGHT;
		T.LineNumber              = LineNum;
		T.BeginIndex              = BeginIdx;
		T.EndIndex                = EndIdx;
		T.BeginValue              = H.PriceBot;
		T.EndValue                = H.PriceTop;
		T.Color                   = Col;
		T.SecondaryColor          = Col;
		T.TransparencyLevel       = max(0, min(Trans, 100));
		T.LineWidth               = LineWidth;
		T.DrawOutlineOnly         = OutlineOnly;
		sc.UseTool(T);
	};

	// ── LEFT zone (C2 history, grey) ─────────────────────────────────────────
	if (LeftEnd >= LeftStart)
	{
		DrawRect(LFillLn, LeftStart, LeftEnd, LFillCol, LFillTrans, 0, 0);

		if (LShowBorder && LBorderTrans < 100)
			DrawRect(LBordLn, LeftStart, LeftEnd, LBorderCol, LBorderTrans, 1, 1);
		else
			sc.DeleteACSChartDrawing(sc.ChartNumber, TOOL_DELETE_CHARTDRAWING, LBordLn);
	}
	else
	{
		// C2StartBarIndex == TrigBarIndex — no separate left zone
		sc.DeleteACSChartDrawing(sc.ChartNumber, TOOL_DELETE_CHARTDRAWING, LFillLn);
		sc.DeleteACSChartDrawing(sc.ChartNumber, TOOL_DELETE_CHARTDRAWING, LBordLn);
	}

	// ── RIGHT zone (post-trigger, red) ───────────────────────────────────────
	DrawRect(RFillLn, RightStart, RightEnd, RFillCol, RFillTrans, 0, 0);

	if (RShowBorder && RBorderTrans < 100)
		DrawRect(RBordLn, RightStart, RightEnd, RBorderCol, RBorderTrans, 1, 1);
	else
		sc.DeleteACSChartDrawing(sc.ChartNumber, TOOL_DELETE_CHARTDRAWING, RBordLn);
}

// Scan depth bars [ScanFrom .. ScanEnd] (step = ±1).
// Returns first qualifying max(Bid, Ask) qty >= MinQty, or 0 if none.
static int ScanDepthFirst(c_ACSILDepthBars* pDepth, int Tick,
                          int ScanFrom, int ScanEnd, int Step, int MinQty)
{
	for (int b = ScanFrom; b != ScanEnd + Step; b += Step)
	{
		if (b < 0 || b >= pDepth->NumBars()) break;
		if (!pDepth->DepthDataExistsAt(b)) continue;
		const int Q = max(pDepth->GetMaxBidQuantity(b, Tick),
		                  pDepth->GetMaxAskQuantity(b, Tick));
		if (Q >= MinQty) return Q;
	}
	return 0;
}

// ── Condition-2b consistency scan ────────────────────────────────────────────
// Searches depth bars from LongEndBar back to C2bMinBar for a stretch of at least
// RequiredStreakUs trading time (market-closed gaps excluded) where
// max(GetMaxBid, GetMaxAsk) >= ConsistentLots, with optional bridging across
// no-depth bars and brief sub-threshold dips.
// Scans backward from LongEndBar (most-recent qualifying bars first).
// Returns peak qty of the first such run found, or 0 if none.
// OutStreakStartBar: set to the EARLIEST (leftmost) bar of the qualifying streak
// — this becomes the left anchor for the highlight rectangle.
static int ScanC2Consistent(SCStudyInterfaceRef sc,
                             c_ACSILDepthBars* pDepth,
                             int Tick, int LongEndBar, int C2bMinBar,
                             int ConsistentLots, int64_t RequiredStreakUs,
                             int64_t MaxSubThresholdGapUs,
                             int MaxSubThresholdGapBars,
                             int64_t ClosedGapThresholdUs,
                             int& OutStreakStartBar)
{
	OutStreakStartBar = -1;

	const bool StrictSubThreshold = (MaxSubThresholdGapUs == 0 && MaxSubThresholdGapBars == 0);

	int64_t StreakLatestUs    = 0;
	int64_t StreakEarliestUs  = 0;
	int64_t StreakTradingUs   = 0;
	int     StreakPeakQty     = 0;
	int     StreakStartBar    = -1;
	int64_t SubGapTradingUs   = 0;
	int     SubGapBarCount    = 0;
	int     PrevBarIndex      = -1;

	auto ResetStreak = [&]() {
		StreakLatestUs   = 0;
		StreakEarliestUs = 0;
		StreakTradingUs  = 0;
		StreakPeakQty    = 0;
		StreakStartBar   = -1;
		SubGapTradingUs  = 0;
		SubGapBarCount   = 0;
	};

	auto SpanFromPrevBar = [&](int b, int64_t BarUs) -> int64_t {
		if (PrevBarIndex < 0)
			return 0;
		return TradingSpanUs(DTtoUs(sc.BaseDateTimeIn[PrevBarIndex]), BarUs,
		                   ClosedGapThresholdUs);
	};

	auto TryCompleteStreak = [&]() -> int {
		if (StreakLatestUs != 0 && StreakTradingUs >= RequiredStreakUs)
		{
			OutStreakStartBar = StreakStartBar;
			return StreakPeakQty;
		}
		return 0;
	};

	for (int b = LongEndBar; b >= C2bMinBar; --b)
	{
		const int64_t BarUs = DTtoUs(sc.BaseDateTimeIn[b]);
		const int64_t SpanFromPrev = SpanFromPrevBar(b, BarUs);

		if (StreakLatestUs != 0)
			StreakTradingUs += SpanFromPrev;

		if (!pDepth->DepthDataExistsAt(b))
		{
			// No depth snapshot — bar closed too fast for one to be recorded
			// (common on volume bar charts).  Treat as neutral: extend the
			// current streak's time span without resetting it.
			if (StreakLatestUs != 0)
			{
				StreakEarliestUs = BarUs;
				StreakStartBar   = b;
				if (const int Done = TryCompleteStreak())
					return Done;
			}
			continue;
		}

		const int Q = max(pDepth->GetMaxBidQuantity(b, Tick),
		                  pDepth->GetMaxAskQuantity(b, Tick));

		if (Q >= ConsistentLots)
		{
			SubGapTradingUs = 0;
			SubGapBarCount  = 0;

			if (StreakLatestUs == 0)
			{
				StreakLatestUs   = BarUs;
				StreakEarliestUs = BarUs;
				StreakPeakQty    = Q;
				StreakStartBar   = b;
			}
			else
			{
				StreakEarliestUs = BarUs;
				StreakStartBar   = b;
				if (Q > StreakPeakQty) StreakPeakQty = Q;
			}

			if (const int Done = TryCompleteStreak())
				return Done;
		}
		else if (StreakLatestUs == 0)
		{
			// Below threshold with no active streak — nothing to bridge.
		}
		else if (StrictSubThreshold)
		{
			ResetStreak();
		}
		else
		{
			// Confirmed below-threshold snapshot — bridge if the dip is brief.
			if (SubGapBarCount == 0)
			{
				SubGapTradingUs = 0;
				SubGapBarCount  = 1;
			}
			else
			{
				SubGapTradingUs += SpanFromPrev;
				++SubGapBarCount;
			}

			const bool GapTooLong = (MaxSubThresholdGapUs > 0
			                         && SubGapTradingUs > MaxSubThresholdGapUs)
			                     || (MaxSubThresholdGapBars > 0
			                         && SubGapBarCount > MaxSubThresholdGapBars);
			if (GapTooLong)
			{
				ResetStreak();
			}
			else
			{
				StreakEarliestUs = BarUs;
				StreakStartBar   = b;
				if (const int Done = TryCompleteStreak())
					return Done;
			}
		}

		PrevBarIndex = b;
	}
	return 0;
}

} // namespace

// ── Main study function ───────────────────────────────────────────────────────

SCSFExport scsf_HeatmapHighlight(SCStudyInterfaceRef sc)
{
	// Input indices — grouped for study settings GUI
	const int INP_VOL_THRESHOLD     = 0;   // Trigger
	const int INP_MIN_BLOCK         = 1;   // C1
	const int INP_SHORT_MIN         = 2;   // C1
	const int INP_LONG_MIN          = 3;   // C2a
	const int INP_CONSIST_LOTS      = 4;   // C2a / C2b
	const int INP_CONSIST_MIN       = 5;   // C2b
	const int INP_CONSIST_MAX_H     = 6;   // C2b
	const int INP_C2B_SUB_GAP_MIN   = 7;   // C2b
	const int INP_C2B_SUB_GAP_BARS  = 8;   // C2b
	const int INP_CLOSED_GAP_MIN    = 9;   // Session (C2b + Active Window)
	const int INP_ACTIVE_HOURS      = 10;  // Display filter
	const int INP_EXTRA_TICKS       = 11;  // Band geometry
	const int INP_L_FILL_COL        = 12;  // Left zone
	const int INP_L_FILL_TRANS      = 13;
	const int INP_L_BORDER_COL      = 14;
	const int INP_L_BORDER_TRANS    = 15;
	const int INP_L_SHOW_BORDER     = 16;
	const int INP_R_FILL_COL        = 17;  // Right zone
	const int INP_R_FILL_TRANS      = 18;
	const int INP_R_BORDER_COL      = 19;
	const int INP_R_BORDER_TRANS    = 20;
	const int INP_R_SHOW_BORDER     = 21;
	const int INP_DEBUG             = 22;

	// ── SetDefaults ───────────────────────────────────────────────────────────
	if (sc.SetDefaults)
	{
		sc.GraphName = "Heatmap Highlight";
		sc.StudyDescription =
			"Triggers at the same price ticks as the Large Volume Trade Indicator by reading "
			"sc.p_VolumeLevelAtPriceForBars. Requires: (C1) a limit block >= MinBlockLots "
			"within ShortLookback min; (C2) the same tick had a block >= ConsistentLots at least "
			"LongLookback min prior AND was consistently >= ConsistentLots for at least "
			"ConsistentDuration min (trading time) within ConsistentMaxLookback trading hours. "
			"Market-closed gaps (weekends/holidays) are excluded from C2b duration and Active Window. "
			"Only draws highlights where the trigger occurred within ActiveHours trading time. "
			"Two-zone rectangle: grey (C2 history) + red (post-trigger).";

		sc.AutoLoop                          = 0;
		sc.FreeDLL                           = 1;
		sc.GraphRegion                       = 0;
		sc.UpdateAlways                      = 1;
		sc.DrawStudyUnderneathMainPriceGraph = 0;
		sc.MaintainHistoricalMarketDepthData = 1;

		// ── Trigger ───────────────────────────────────────────────────────────
		sc.Input[INP_VOL_THRESHOLD].Name =
			"Volume Threshold (lots): triggers when max(BidTradeVol, AskTradeVol) at a price tick >= this";
		sc.Input[INP_VOL_THRESHOLD].SetInt(20);
		sc.Input[INP_VOL_THRESHOLD].SetIntLimits(1, 100000);

		// ── Condition 1 ───────────────────────────────────────────────────────
		sc.Input[INP_MIN_BLOCK].Name = "C1 — Min DOM Limit Block Qty (lots)";
		sc.Input[INP_MIN_BLOCK].SetInt(20);
		sc.Input[INP_MIN_BLOCK].SetIntLimits(1, 100000);

		sc.Input[INP_SHORT_MIN].Name =
			"C1 — Short Lookback (minutes): DOM block must appear within this window before trigger";
		sc.Input[INP_SHORT_MIN].SetInt(5);
		sc.Input[INP_SHORT_MIN].SetIntLimits(1, 60);

		// ── Condition 2 ───────────────────────────────────────────────────────
		sc.Input[INP_LONG_MIN].Name =
			"C2a — Long Lookback Minimum (minutes): DOM block must have existed AT LEAST this long before trigger";
		sc.Input[INP_LONG_MIN].SetInt(120);
		sc.Input[INP_LONG_MIN].SetIntLimits(10, 480);

		sc.Input[INP_CONSIST_LOTS].Name =
			"C2a & C2b — Min DOM Limit Block Qty (lots): C2a existence and C2b consistent stretch both require >= this qty";
		sc.Input[INP_CONSIST_LOTS].SetInt(10);
		sc.Input[INP_CONSIST_LOTS].SetIntLimits(1, 100000);

		sc.Input[INP_CONSIST_MIN].Name =
			"C2b — Consistent Duration (trading minutes): block must be continuously >= ConsistentLots for at least this long";
		sc.Input[INP_CONSIST_MIN].SetInt(60);
		sc.Input[INP_CONSIST_MIN].SetIntLimits(5, 480);

		sc.Input[INP_CONSIST_MAX_H].Name =
			"C2b — Max Lookback (trading hours): consistent block must occur within this many trading hours before trigger";
		sc.Input[INP_CONSIST_MAX_H].SetInt(36);
		sc.Input[INP_CONSIST_MAX_H].SetIntLimits(1, 168);

		sc.Input[INP_C2B_SUB_GAP_MIN].Name =
			"C2b — Max Sub-Threshold Gap (minutes): bridge depth bars with Q < ConsistentLots for up to this long (0 = strict reset)";
		sc.Input[INP_C2B_SUB_GAP_MIN].SetInt(5);
		sc.Input[INP_C2B_SUB_GAP_MIN].SetIntLimits(0, 480);

		sc.Input[INP_C2B_SUB_GAP_BARS].Name =
			"C2b — Max Sub-Threshold Gap (bars): max depth bars with Q < ConsistentLots to bridge (0 = no bar limit)";
		sc.Input[INP_C2B_SUB_GAP_BARS].SetInt(0);
		sc.Input[INP_C2B_SUB_GAP_BARS].SetIntLimits(0, 10000);

		sc.Input[INP_CLOSED_GAP_MIN].Name =
			"Session — Closed Market Gap (minutes): bar gaps longer than this are excluded from C2b duration and Active Window (weekends/holidays; 0 = count all time)";
		sc.Input[INP_CLOSED_GAP_MIN].SetInt(180);
		sc.Input[INP_CLOSED_GAP_MIN].SetIntLimits(0, 10080);

		// ── Display filter ────────────────────────────────────────────────────
		sc.Input[INP_ACTIVE_HOURS].Name =
			"Active Window (trading hours): only draw highlights where the trigger occurred within this many trading hours of the current bar";
		sc.Input[INP_ACTIVE_HOURS].SetInt(18);
		sc.Input[INP_ACTIVE_HOURS].SetIntLimits(1, 168);

		// ── Band geometry ─────────────────────────────────────────────────────
		sc.Input[INP_EXTRA_TICKS].Name =
			"Extra Ticks Above/Below Price Level (0 = exactly 1 tick wide, 1 = 3 ticks wide, ...)";
		sc.Input[INP_EXTRA_TICKS].SetInt(0);
		sc.Input[INP_EXTRA_TICKS].SetIntLimits(0, 50);

		// ── LEFT zone: C2 history (grey) ──────────────────────────────────────
		sc.Input[INP_L_FILL_COL].Name = "Left Zone Fill Color (C2 history, before trigger)";
		sc.Input[INP_L_FILL_COL].SetColor(RGB(160, 160, 160));

		sc.Input[INP_L_FILL_TRANS].Name = "Left Zone Fill Transparency (0=solid, 100=invisible)";
		sc.Input[INP_L_FILL_TRANS].SetInt(90);
		sc.Input[INP_L_FILL_TRANS].SetIntLimits(0, 100);

		sc.Input[INP_L_BORDER_COL].Name = "Left Zone Border Color (C2 history, before trigger)";
		sc.Input[INP_L_BORDER_COL].SetColor(RGB(110, 110, 110));

		sc.Input[INP_L_BORDER_TRANS].Name = "Left Zone Border Transparency (0=solid, 100=invisible)";
		sc.Input[INP_L_BORDER_TRANS].SetInt(100);
		sc.Input[INP_L_BORDER_TRANS].SetIntLimits(0, 100);

		sc.Input[INP_L_SHOW_BORDER].Name = "Left Zone Show Border";
		sc.Input[INP_L_SHOW_BORDER].SetYesNo(0);

		// ── RIGHT zone: post-trigger (red) ────────────────────────────────────
		sc.Input[INP_R_FILL_COL].Name = "Right Zone Fill Color (post-trigger)";
		sc.Input[INP_R_FILL_COL].SetColor(RGB(220, 30, 30));

		sc.Input[INP_R_FILL_TRANS].Name = "Right Zone Fill Transparency (0=solid, 100=invisible)";
		sc.Input[INP_R_FILL_TRANS].SetInt(70);
		sc.Input[INP_R_FILL_TRANS].SetIntLimits(0, 100);

		sc.Input[INP_R_BORDER_COL].Name = "Right Zone Border Color (post-trigger)";
		sc.Input[INP_R_BORDER_COL].SetColor(RGB(200, 0, 0));

		sc.Input[INP_R_BORDER_TRANS].Name = "Right Zone Border Transparency (0=solid, 100=invisible)";
		sc.Input[INP_R_BORDER_TRANS].SetInt(10);
		sc.Input[INP_R_BORDER_TRANS].SetIntLimits(0, 100);

		sc.Input[INP_R_SHOW_BORDER].Name = "Right Zone Show Border";
		sc.Input[INP_R_SHOW_BORDER].SetYesNo(1);

		sc.Input[INP_DEBUG].Name = "Enable Debug Logging";
		sc.Input[INP_DEBUG].SetYesNo(0);

		return;
	}

	// ── Cleanup ───────────────────────────────────────────────────────────────
	if (sc.LastCallToFunction)
	{
		EraseDrawings(sc, 0, MAX_HIGHLIGHTS);
		s_StudyCache* p = reinterpret_cast<s_StudyCache*>(sc.GetPersistentPointer(1));
		if (p) { sc.FreeMemory(p); sc.SetPersistentPointer(1, nullptr); }
		return;
	}

	if (sc.HideStudy)
	{
		EraseDrawings(sc, 0, MAX_HIGHLIGHTS);
		return;
	}

	if (sc.ArraySize <= 0) return;

	// ── Get / allocate persistent cache ──────────────────────────────────────
	s_StudyCache* p = reinterpret_cast<s_StudyCache*>(sc.GetPersistentPointer(1));
	if (!p)
	{
		p = static_cast<s_StudyCache*>(sc.AllocateMemory(sizeof(s_StudyCache)));
		if (!p) return;
		memset(p, 0, sizeof(s_StudyCache));
		sc.SetPersistentPointer(1, p);
	}

	if (sc.IsFullRecalculation)
	{
		EraseDrawings(sc, 0, MAX_HIGHLIGHTS);
		memset(p, 0, sizeof(s_StudyCache));
	}

	// ── Read inputs ───────────────────────────────────────────────────────────
	const double   VolThreshold = static_cast<double>(sc.Input[INP_VOL_THRESHOLD].GetInt());
	const int      MinBlock     = sc.Input[INP_MIN_BLOCK].GetInt();
	const int      ShortMin     = sc.Input[INP_SHORT_MIN].GetInt();
	const int      LongMin      = sc.Input[INP_LONG_MIN].GetInt();
	const int      ConsistLots  = sc.Input[INP_CONSIST_LOTS].GetInt();
	const int      ConsistMin   = sc.Input[INP_CONSIST_MIN].GetInt();
	const int      ConsistMaxH  = sc.Input[INP_CONSIST_MAX_H].GetInt();
	const int      ExtraTicks   = sc.Input[INP_EXTRA_TICKS].GetInt();
	const int      ActiveHours  = sc.Input[INP_ACTIVE_HOURS].GetInt();
	const COLORREF RFillCol     = sc.Input[INP_R_FILL_COL].GetColor();
	const int      RFillTrans   = sc.Input[INP_R_FILL_TRANS].GetInt();
	const COLORREF RBorderCol   = sc.Input[INP_R_BORDER_COL].GetColor();
	const int      RBorderTrans = sc.Input[INP_R_BORDER_TRANS].GetInt();
	const COLORREF LFillCol     = sc.Input[INP_L_FILL_COL].GetColor();
	const int      LFillTrans   = sc.Input[INP_L_FILL_TRANS].GetInt();
	const COLORREF LBorderCol   = sc.Input[INP_L_BORDER_COL].GetColor();
	const int      LBorderTrans = sc.Input[INP_L_BORDER_TRANS].GetInt();
	const bool     LShowBorder  = sc.Input[INP_L_SHOW_BORDER].GetYesNo() != 0;
	const bool     RShowBorder  = sc.Input[INP_R_SHOW_BORDER].GetYesNo() != 0;
	const bool     Debug           = sc.Input[INP_DEBUG].GetYesNo() != 0;
	const int      C2bSubGapMin    = sc.Input[INP_C2B_SUB_GAP_MIN].GetInt();
	const int      C2bSubGapBars   = sc.Input[INP_C2B_SUB_GAP_BARS].GetInt();
	const int      ClosedGapMin    = sc.Input[INP_CLOSED_GAP_MIN].GetInt();

	const int64_t ShortUs            = static_cast<int64_t>(ShortMin)     * 60LL   * 1000000LL;
	const int64_t LongUs             = static_cast<int64_t>(LongMin)      * 60LL   * 1000000LL;
	const int64_t ConsistUs          = static_cast<int64_t>(ConsistMin)   * 60LL   * 1000000LL;
	const int64_t ConsistMaxUs       = static_cast<int64_t>(ConsistMaxH)  * 3600LL * 1000000LL;
	const int64_t C2bSubGapUs        = static_cast<int64_t>(C2bSubGapMin) * 60LL   * 1000000LL;
	const int64_t ActiveUs           = static_cast<int64_t>(ActiveHours)  * 3600LL * 1000000LL;
	const int64_t ClosedGapThresholdUs = static_cast<int64_t>(ClosedGapMin) * 60LL * 1000000LL;
	const float   TickSz    = static_cast<float>(sc.TickSize);
	const float   HalfHt    = TickSz * (0.5f + static_cast<float>(ExtraTicks));
	const float   TickEps   = TickSz * 0.5f;

	const int LastBar = sc.ArraySize - 1;

	if (LastBar < p->LastScannedBar)
	{
		p->LastScannedBar  = -1;
		p->LastDrawnBar    = -1;
		p->LastBarCached   = -1;
		p->DrawDirty       = true;
	}

	// ── Data containers ───────────────────────────────────────────────────────
	const c_VolumeLevelAtPriceContainer* pVolLevel = sc.p_VolumeLevelAtPriceForBars;
	c_ACSILDepthBars* pDepth = sc.GetMarketDepthBars();

	if (!pVolLevel && Debug)
	{
		sc.AddMessageToLog(
			"HeatmapHighlight: sc.p_VolumeLevelAtPriceForBars is null. "
			"Ensure the 'Large Volume Trade Indicator' study is also on this chart.", 1);
	}

	const int64_t NowUs         = DTtoUs(sc.BaseDateTimeIn[LastBar]);
	(void)NowUs;
	const int ActiveScanStart   = GetActiveScanStartBar(sc, p, LastBar, ActiveUs,
	                                                    ClosedGapThresholdUs);
	const bool NewBar           = (LastBar > p->LastScannedBar);
	const bool FullRescan       = sc.IsFullRecalculation || p->LastScannedBar < 0;

	// Prune stale cache entries once per new bar (not every tick).
	if (NewBar || FullRescan)
		PruneHighlightsOutsideWindow(sc, p, LastBar, ActiveUs, ClosedGapThresholdUs);

	// ── Incremental trigger scan ──────────────────────────────────────────────
	// Full recalc  → scan entire active window once.
	// New bar      → scan new bar(s) plus a small recheck tail for late vol data.
	// Same-bar tick → scan only the forming bar (cheapest path).
	if (pVolLevel)
	{
		int ScanStart = ActiveScanStart;
		int ScanEnd   = LastBar;

		if (FullRescan)
		{
			ScanStart = ActiveScanStart;
		}
		else if (NewBar)
		{
			ScanStart = max(ActiveScanStart, p->LastScannedBar + 1 - RECHECK_BARS);
		}
		else
		{
			// Intrabar tick update — only re-evaluate the current forming bar.
			ScanStart = LastBar;
		}

		for (int BarIdx = ScanStart; BarIdx <= ScanEnd; ++BarIdx)
		{
			ProcessBarForTriggers(sc, p, pVolLevel, pDepth, BarIdx,
			                      VolThreshold, MinBlock, ShortMin, LongMin,
			                      ConsistLots, ConsistMin, ConsistMaxH,
			                      ShortUs, LongUs, ConsistUs, ConsistMaxUs,
			                      C2bSubGapUs, C2bSubGapBars,
			                      ClosedGapThresholdUs,
			                      HalfHt, TickEps, Debug);
		}

		if (NewBar || FullRescan)
			p->LastScannedBar = LastBar;
	}

	// ── Draw only when needed ─────────────────────────────────────────────────
	// Redraw when: new bar (extend right edge), highlight added/updated, visual
	// input change, or full recalc.
	int VisualSig = static_cast<int>(LFillCol) ^ (LFillTrans << 8) ^ static_cast<int>(LBorderCol)
		^ (LBorderTrans << 16) ^ (LShowBorder ? 1 : 0)
		^ static_cast<int>(RFillCol) ^ (RFillTrans << 8) ^ static_cast<int>(RBorderCol)
		^ (RBorderTrans << 16) ^ (RShowBorder ? 2 : 0);
	const bool VisualChanged = (VisualSig != p->LastVisualSig);
	const bool NeedDraw = FullRescan || NewBar || p->DrawDirty || VisualChanged;
	if (NeedDraw)
	{
		for (int i = 0; i < p->HighlightCount; ++i)
		{
			DrawOneHighlight(sc, p->Highlights[i], i,
			                 LFillCol, LFillTrans, LBorderCol, LBorderTrans, LShowBorder,
			                 RFillCol, RFillTrans,  RBorderCol, RBorderTrans, RShowBorder);
		}
		EraseDrawings(sc, p->HighlightCount, MAX_HIGHLIGHTS);
		p->LastDrawnBar  = LastBar;
		p->DrawDirty     = false;
		p->LastVisualSig = VisualSig;
	}
}
