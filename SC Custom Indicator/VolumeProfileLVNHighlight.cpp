#include "sierrachart.h"

SCDLLName("Volume Profile LVN Highlight")

namespace
{
	const int MAX_HIGHLIGHTS = 128;
	const int REFERENCE_BAR_SECONDS = 1;
	const int MIN_PROFILE_BAR_WIDTH_PIXELS = 4;

	const int INPUT_PROFILE_STUDY = 0;
	const int INPUT_PROFILE_INDEX = 1;
	const int INPUT_MIN_NEIGHBOR_VOLUME = 2;
	const int INPUT_PROFILE_WIDTH_PIXELS = 3;
	const int INPUT_MIN_PEAK_VOLUME_PCT = 4;
	const int INPUT_SHOW_CHART_RECTANGLES = 5;
	const int INPUT_SHOW_PAST_RECTANGLES = 6;
	const int INPUT_SHOW_PRICE_LABEL = 7;
	const int INPUT_LABEL_COLOR = 8;
	const int INPUT_DEBUG_LOGGING = 9;
	const int INPUT_VOL_BAR_FILL_COLOR = 10;
	const int INPUT_VOL_BAR_FILL_TRANSPARENCY = 11;
	const int INPUT_VOL_BAR_BORDER_COLOR = 12;
	const int INPUT_VOL_BAR_BORDER_TRANSPARENCY = 13;
	const int INPUT_ACTIVE_RECT_FILL_COLOR = 14;
	const int INPUT_ACTIVE_RECT_FILL_TRANSPARENCY = 15;
	const int INPUT_ACTIVE_RECT_BORDER_COLOR = 16;
	const int INPUT_ACTIVE_RECT_BORDER_TRANSPARENCY = 17;
	const int INPUT_INACTIVE_RECT_FILL_COLOR = 18;
	const int INPUT_INACTIVE_RECT_FILL_TRANSPARENCY = 19;
	const int INPUT_INACTIVE_RECT_BORDER_COLOR = 20;
	const int INPUT_INACTIVE_RECT_BORDER_TRANSPARENCY = 21;

	// Subgraph 0: hidden; LineWidth = horizontal pixel offset from profile column right edge.
	const int SG_PRICE_LABEL = 0;

	// Pattern type identifiers
	const int PATTERN_FIVE_BAR  = 0;  // classic V[i-2]<V[i-1]>V[i]<V[i+1]>V[i+2]
	const int PATTERN_RIGHT_ASC = 1;  // ascending valley: V[k-2]>V[k-1]>V[k]<V[k+1]<V[k+2]

	struct OneSecondPriceLookup
	{
		int ReferenceChartNumber = 0;
		bool UsesLocalArrays = false;
		SCGraphData BaseData;
	};

	struct LVNHighlightEntry
	{
		float PriceTop = 0.0f;
		float PriceBottom = 0.0f;
		float MidPrice = 0.0f;     // representative (middle) price of the LVN level
		double Volume = 0.0;
		SCDateTime RectangleStartDateTime;
		SCDateTime RectangleEndDateTime;
		bool HasRectangle = false;
		bool IsActive = true;     // true = pattern still qualifies; false = invalidated
		bool StartConfirmed = false; // true = start time came from a real eligibility scan
		int  PatternType = PATTERN_FIVE_BAR;
	};

	const int MAX_PROFILE_LEVELS = 2048;  // per-level timing cache (forward pass)

	struct LVNHighlightCache
	{
		int HighlightCount = 0;        // # currently active patterns
		int InactiveCount  = 0;        // # historically inactive (persists across calls)
		double MaxVolume = 0.0;
		int ProfileRightX = 0;
		int ProfileWidthPixels = 0;
		int ProfileEndBarIndex = -1;
		int LastScanArraySize = -1;    // gates the expensive per-bar forward pass
		int TimingLevelCount  = 0;     // # levels in RunStartBar / EligAtEndLvl
		int RunStartBar[MAX_PROFILE_LEVELS];   // start of final eligible run per level
		bool EligAtEndLvl[MAX_PROFILE_LEVELS]; // still eligible on cumulative profile at EndBar
		LVNHighlightEntry Highlights[MAX_HIGHLIGHTS];         // active entries
		LVNHighlightEntry InactiveHighlights[MAX_HIGHLIGHTS]; // historical (grey) entries
	};

	// ── pattern helpers ─────────────────────────────────────────────────────

	static bool IsPeakFlankedLVNPattern(const double* Volumes, const int Count, const int Index)
	{
		if (Index < 2 || Index > Count - 3)
			return false;

		return Volumes[Index - 2] < Volumes[Index - 1]
			&& Volumes[Index - 1] > Volumes[Index]
			&& Volumes[Index]     < Volumes[Index + 1]
			&& Volumes[Index + 1] > Volumes[Index + 2];
	}

	static bool IsPeakFlankedFive(const double V[5])
	{
		return V[0] < V[1] && V[1] > V[2] && V[2] < V[3] && V[3] > V[4];
	}

	// Condition 1 — ascending valley: V[k] is a strict local minimum with volume
	// rising monotonically for two bars on BOTH sides (index increases with price):
	//   V[k-2] > V[k-1] > V[k] < V[k+1] < V[k+2]
	static bool IsAscendingValleyLVN(const double* Volumes, const int Count, const int Index)
	{
		if (Index < 2 || Index + 2 >= Count) return false;
		return Volumes[Index]     < Volumes[Index + 1]
			&& Volumes[Index + 1] < Volumes[Index + 2]
			&& Volumes[Index]     < Volumes[Index - 1]
			&& Volumes[Index - 1] < Volumes[Index - 2];
	}

	// Cumulative-volume versions used by the eligibility-timing scan.
	// Band order is [k-2, k-1, k, k+1, k+2].
	static bool IsAscendingValleyFive(const double V[5])
	{
		return V[2] < V[3] && V[3] < V[4]   // k < k+1 < k+2
			&& V[2] < V[1] && V[1] < V[0];  // k < k-1 < k-2
	}

	// ── price-band helpers ───────────────────────────────────────────────────

	static float LevelTop(const SCStudyInterfaceRef sc, const float* Prices, const int Count, const int i)
	{
		return (i < Count - 1)
			? (Prices[i] + Prices[i + 1]) * 0.5f
			: Prices[i] + static_cast<float>(sc.TickSize * 0.5);
	}

	static float LevelBottom(const SCStudyInterfaceRef sc, const float* Prices, const int Count, const int i)
	{
		return (i > 0)
			? (Prices[i] + Prices[i - 1]) * 0.5f
			: Prices[i] - static_cast<float>(sc.TickSize * 0.5);
	}

	// ── 1-second chart helpers ───────────────────────────────────────────────

	static bool Is1sChart(SCStudyInterfaceRef sc, const int ChartNumber)
	{
		n_ACSIL::s_BarPeriod BP;
		if (ChartNumber == sc.ChartNumber)
			sc.GetBarPeriodParameters(BP);
		else
			sc.GetBarPeriodParametersForChart(ChartNumber, BP);

		return BP.ChartDataType == INTRADAY_DATA
			&& BP.IntradayChartBarPeriodType == IBPT_DAYS_MINS_SECS
			&& BP.IntradayChartBarPeriodParameter1 == REFERENCE_BAR_SECONDS;
	}

	static int Find1sChart(SCStudyInterfaceRef sc)
	{
		if (Is1sChart(sc, sc.ChartNumber))
			return sc.ChartNumber;

		const SCString Symbol = sc.Symbol;
		const int MaxChart = sc.GetHighestChartNumberUsedInChartBook();
		int Fallback = 0;

		for (int N = 1; N <= MaxChart; ++N)
		{
			if (!Is1sChart(sc, N))
				continue;
			if (sc.GetChartSymbol(N) == Symbol)
				return N;
			if (Fallback == 0)
				Fallback = N;
		}
		return Fallback;
	}

	static bool Prepare1sLookup(SCStudyInterfaceRef sc, OneSecondPriceLookup& Out)
	{
		Out.ReferenceChartNumber = Find1sChart(sc);
		if (Out.ReferenceChartNumber == 0)
			return false;

		Out.UsesLocalArrays = (Out.ReferenceChartNumber == sc.ChartNumber);
		if (!Out.UsesLocalArrays)
			sc.GetChartBaseData(Out.ReferenceChartNumber, Out.BaseData);

		return true;
	}

	static int NearestBar(SCStudyInterfaceRef sc, const int ChartNum, const SCDateTime& DT)
	{
		int i = sc.GetNearestMatchForSCDateTimeExtended(ChartNum, DT);
		if (i < 0) i = sc.GetNearestMatchForSCDateTime(ChartNum, DT);
		return i;
	}

	static int RefArraySize(SCStudyInterfaceRef sc, const OneSecondPriceLookup& L)
	{
		return L.UsesLocalArrays ? sc.ArraySize : L.BaseData[SC_HIGH].GetArraySize();
	}

	static SCDateTime BarDT(SCStudyInterfaceRef sc, const OneSecondPriceLookup& L, const int i)
	{
		if (i < 0) return SCDateTime(0, 0);

		if (L.UsesLocalArrays)
		{
			if (i >= sc.ArraySize) return SCDateTime(0, 0);
			return sc.BaseDateTimeIn[i];
		}

		SCDateTimeArray DTs;
		sc.GetChartDateTimeArray(L.ReferenceChartNumber, DTs);
		if (i >= DTs.GetArraySize()) return SCDateTime(0, 0);
		return DTs[i];
	}

	// ── profile timing helpers ───────────────────────────────────────────────

	static SCDateTime ProfileEndDT(SCStudyInterfaceRef sc, const n_ACSIL::s_StudyProfileInformation& PI)
	{
		if (PI.m_EndDateTime.IsDateSet())
			return PI.m_EndDateTime;
		if (PI.m_EndIndex < static_cast<uint32_t>(sc.ArraySize))
			return sc.BaseDateTimeIn[PI.m_EndIndex];
		if (sc.ArraySize > 0)
			return sc.BaseDateTimeIn[sc.ArraySize - 1];
		return SCDateTime(0, 0);
	}

	static int ProfileRightX(SCStudyInterfaceRef sc, const n_ACSIL::s_StudyProfileInformation& PI)
	{
		// Use the left edge of the price scale as the right boundary of the profile.
		if (sc.RightValuesScaleLeftCoordinate > static_cast<uint32_t>(sc.ChartRegion1LeftCoordinate))
			return static_cast<int>(sc.RightValuesScaleLeftCoordinate) - 1;

		if (PI.m_EndIndex < static_cast<uint32_t>(sc.ArraySize))
		{
			const int X = sc.BarIndexToXPixelCoordinate(static_cast<int>(PI.m_EndIndex));
			if (X > sc.ChartRegion1LeftCoordinate)
				return X;
		}

		return sc.ChartRegion1RightCoordinate - 5;
	}

	// ── cumulative-pattern bar finder ────────────────────────────────────────

	static double VolumeInBand(c_VAPContainer* p_VAP, const unsigned int BarIdx,
		const float Bottom, const float Top, SCStudyInterfaceRef sc)
	{
		const int64_t Lo = sc.PriceValueToTicks(Bottom);
		const int64_t Hi = sc.PriceValueToTicks(Top);
		if (Hi < Lo) return 0.0;

		double Vol = 0.0;
		for (int64_t T = Lo; T <= Hi; ++T)
			Vol += p_VAP->GetVolumeAtPrice(BarIdx, static_cast<int>(T));
		return Vol;
	}

	// Evaluate whether level k is an LVN on the DEVELOPING (cumulative) profile
	// at the current bar. Uses the same shape + significance rules as the final
	// profile scan, but all volumes are cumulative-at-bar (not final pVol).
	static bool IsLevelCumulativelyEligible(
		const double* Cum, const int Count, const int Index,
		const double MinNeighborVol, const double MinPeakVolAtBar)
	{
		if (Index < 2 || Index > Count - 3)
			return false;

		const bool Is5Bar      = IsPeakFlankedLVNPattern(Cum, Count, Index);
		const bool IsAscValley = IsAscendingValleyLVN(Cum, Count, Index);
		if (!Is5Bar && !IsAscValley)
			return false;

		if (MinNeighborVol > 0.0 &&
		    (Cum[Index - 1] < MinNeighborVol || Cum[Index + 1] < MinNeighborVol))
			return false;

		if (MinPeakVolAtBar > 0.0 &&
		    (Cum[Index - 1] < MinPeakVolAtBar || Cum[Index + 1] < MinPeakVolAtBar))
			return false;

		return true;
	}

	static double MaxCumVolume(const double* Cum, const int Count)
	{
		double m = 0.0;
		for (int i = 0; i < Count; ++i)
			if (Cum[i] > m) m = Cum[i];
		return m;
	}

	// Start bar of the final contiguous eligible run for this level (-1 if none).
	static int FindEligibilityBarFromCumHistory(const int* RunStartBar, const int Index)
	{
		if (RunStartBar == nullptr || Index < 0) return -1;
		return RunStartBar[Index];
	}

	// Single-pass qualify + disqualify finder for both pattern types.
	//   BandCount = 5 for PATTERN_FIVE_BAR, 3 for PATTERN_RIGHT_ASC
	//   OutQualifyDT   : first 1s bar where the pattern is met
	//   OutDisqualifyDT: first 1s bar after qualify where it is broken
	//                    (= session-end bar when IsActive is true)
	//   OutIsActive    : true when pattern was still met at session end
	// Returns false if the pattern was never met in the session.
	static bool FindPatternTiming(
		SCStudyInterfaceRef sc,
		const OneSecondPriceLookup& L,
		const SCDateTime& SessionStart,
		const SCDateTime& SessionEnd,
		const float* BotB, const float* TopB,
		const int BandCount,
		const int PatternType,
		SCDateTime& OutQualifyDT,
		SCDateTime& OutDisqualifyDT,
		bool& OutIsActive)
	{
		OutIsActive      = false;
		OutQualifyDT     = SCDateTime(0, 0);
		OutDisqualifyDT  = SCDateTime(0, 0);

		c_VAPContainer* p_VAP = sc.GetVolumeAtPriceForBarsForChart(L.ReferenceChartNumber);
		if (p_VAP == nullptr) return false;

		const int ArrSize = RefArraySize(sc, L);
		if (ArrSize <= 0 || static_cast<int>(p_VAP->GetNumberOfBars()) < ArrSize)
			return false;

		int S = NearestBar(sc, L.ReferenceChartNumber, SessionStart);
		int E = NearestBar(sc, L.ReferenceChartNumber, SessionEnd);
		S = max(0, S);
		E = min(ArrSize - 1, E);
		if (S > E) return false;

		double Cum[5] = {};   // max 5 bands; zero-init
		bool PatternWasMet = false;

		for (int B = S; B <= E; ++B)
		{
			for (int k = 0; k < BandCount; ++k)
				Cum[k] += VolumeInBand(p_VAP, static_cast<unsigned int>(B), BotB[k], TopB[k], sc);

			const bool PatternNow = (PatternType == PATTERN_FIVE_BAR)
				? IsPeakFlankedFive(Cum)
				: IsAscendingValleyFive(Cum);

			if (PatternNow && !PatternWasMet)
			{
				const SCDateTime DT = BarDT(sc, L, B);
				if (!DT.IsDateSet()) continue;
				OutQualifyDT  = DT;
				PatternWasMet = true;
			}
			else if (!PatternNow && PatternWasMet)
			{
				const SCDateTime DT = BarDT(sc, L, B);
				if (!DT.IsDateSet()) continue;
				OutDisqualifyDT = DT;
				OutIsActive     = false;
				return true;   // qualified then invalidated — done
			}
		}

		if (PatternWasMet)
		{
			// Pattern qualified and was never invalidated → still active
			OutIsActive     = true;
			OutDisqualifyDT = BarDT(sc, L, E);
			if (!OutDisqualifyDT.IsDateSet())
				OutDisqualifyDT = SessionEnd;
			return true;
		}
		return false;
	}

	// ── drawing helpers ──────────────────────────────────────────────────────

	// Fade border RGB toward black (SC rectangle outlines have no true alpha).
	static COLORREF FadeBorderColor(const COLORREF BorderCol, const int Transparency)
	{
		if (Transparency <= 0) return BorderCol;
		if (Transparency >= 100) return RGB(0, 0, 0);
		const int Keep = 100 - Transparency;
		return RGB(
			GetRValue(BorderCol) * Keep / 100,
			GetGValue(BorderCol) * Keep / 100,
			GetBValue(BorderCol) * Keep / 100);
	}

	// Erase a range of active-slot drawings (slots 0..MAX_HIGHLIGHTS-1)
	// and/or inactive-slot drawings (slots MAX_HIGHLIGHTS..2*MAX_HIGHLIGHTS-1).
	static void EraseRectangles(SCStudyInterfaceRef sc, const int From, const int To)
	{
		const int Base = sc.StudyGraphInstanceID * 10000;
		for (int i = From; i < To; ++i)
			sc.DeleteACSChartDrawing(sc.ChartNumber, TOOL_DELETE_CHARTDRAWING, Base + i);
	}

	// Draw fill + optional outline as two RECTANGLEHIGHLIGHT tools (separate line numbers).
	// SC mapping: Color=border, SecondaryColor=fill, TransparencyLevel=fill only.
	static void DrawOneRect(SCStudyInterfaceRef sc,
	                        const LVNHighlightEntry& E,
	                        const int FillLineNumber,
	                        const int BorderLineNumber,
	                        const COLORREF FillCol,
	                        const COLORREF BorderCol,
	                        const int FillTrans,
	                        const int BorderTrans,
	                        const bool ForceEndToCurrent,
	                        const bool Debug)
	{
		int StartIdx = sc.GetContainingIndexForSCDateTime(sc.ChartNumber, E.RectangleStartDateTime);
		int EndIdx   = sc.GetContainingIndexForSCDateTime(sc.ChartNumber, E.RectangleEndDateTime);
		if (StartIdx < 0) StartIdx = 0;
		if (EndIdx   < 0 || EndIdx >= sc.ArraySize) EndIdx = sc.ArraySize - 1;

		if (ForceEndToCurrent)
			EndIdx = sc.ArraySize - 1;

		if (StartIdx >= EndIdx) StartIdx = max(0, EndIdx - 1);

		// ── fill ──────────────────────────────────────────────────────────────
		s_UseTool T;
		T.Clear();
		T.ChartNumber             = sc.ChartNumber;
		T.Region                  = 0;
		T.AddMethod               = UTAM_ADD_OR_ADJUST;
		T.DrawUnderneathMainGraph = 0;
		T.DrawingType             = DRAWING_RECTANGLEHIGHLIGHT;
		T.LineNumber              = FillLineNumber;
		T.BeginIndex              = StartIdx;
		T.EndIndex                = EndIdx;
		T.BeginValue              = E.PriceBottom;
		T.EndValue                = E.PriceTop;
		T.Color                   = FillCol;
		T.SecondaryColor          = FillCol;
		T.TransparencyLevel       = max(0, min(FillTrans, 100));
		T.LineWidth               = 0;
		T.DrawOutlineOnly         = 0;
		sc.UseTool(T);

		// ── border (outline-only layer) ───────────────────────────────────────
		if (BorderTrans >= 100)
		{
			sc.DeleteACSChartDrawing(sc.ChartNumber, TOOL_DELETE_CHARTDRAWING, BorderLineNumber);
		}
		else
		{
			const int BorderWidth = max(1, (100 - BorderTrans) * 2 / 100);

			s_UseTool B;
			B.Clear();
			B.ChartNumber             = sc.ChartNumber;
			B.Region                  = 0;
			B.AddMethod               = UTAM_ADD_OR_ADJUST;
			B.DrawUnderneathMainGraph = 0;
			B.DrawingType             = DRAWING_RECTANGLEHIGHLIGHT;
			B.LineNumber              = BorderLineNumber;
			B.BeginIndex              = StartIdx;
			B.EndIndex                = EndIdx;
			B.BeginValue              = E.PriceBottom;
			B.EndValue                = E.PriceTop;
			B.Color                   = FadeBorderColor(BorderCol, BorderTrans);
			B.SecondaryColor          = FillCol;
			B.TransparencyLevel       = 0;
			B.LineWidth               = static_cast<uint16_t>(BorderWidth);
			B.DrawOutlineOnly         = 1;
			sc.UseTool(B);
		}

		if (Debug)
		{
			SCString Msg;
			Msg.Format(
				"LVN Rect FillLine=%d BorderLine=%d %s %s: StartBar=%d EndBar=%d Bot=%.4f Top=%.4f FillTrans=%d BorderTrans=%d",
				FillLineNumber, BorderLineNumber,
				E.PatternType == PATTERN_FIVE_BAR ? "5bar" : "AscValley",
				E.IsActive ? "ACTIVE" : "INACTIVE",
				StartIdx, EndIdx, E.PriceBottom, E.PriceTop, FillTrans, BorderTrans);
			sc.AddMessageToLog(Msg, 0);
		}
	}

	// Draw the LVN's middle price as a text label anchored at the latest bar
	// (right edge), placing it right next to the highlighted profile bar.
	static void DrawRectangles(SCStudyInterfaceRef sc, const LVNHighlightCache* p_Cache)
	{
		if (p_Cache == nullptr) return;

		const int  Base        = sc.StudyGraphInstanceID * 10000;
		const bool Show        = sc.Input[INPUT_SHOW_CHART_RECTANGLES].GetYesNo() != 0;
		const COLORREF ActiveFillCol     = sc.Input[INPUT_ACTIVE_RECT_FILL_COLOR].GetColor();
		const COLORREF InactiveFillCol   = sc.Input[INPUT_INACTIVE_RECT_FILL_COLOR].GetColor();
		const COLORREF ActiveBorderCol   = sc.Input[INPUT_ACTIVE_RECT_BORDER_COLOR].GetColor();
		const COLORREF InactiveBorderCol = sc.Input[INPUT_INACTIVE_RECT_BORDER_COLOR].GetColor();
		const int ActiveFillTrans        = sc.Input[INPUT_ACTIVE_RECT_FILL_TRANSPARENCY].GetInt();
		const int ActiveBorderTrans      = sc.Input[INPUT_ACTIVE_RECT_BORDER_TRANSPARENCY].GetInt();
		const int InactiveFillTrans      = sc.Input[INPUT_INACTIVE_RECT_FILL_TRANSPARENCY].GetInt();
		const int InactiveBorderTrans    = sc.Input[INPUT_INACTIVE_RECT_BORDER_TRANSPARENCY].GetInt();
		const bool Debug       = sc.Input[INPUT_DEBUG_LOGGING].GetYesNo() != 0;
		const bool ShowPast    = sc.Input[INPUT_SHOW_PAST_RECTANGLES].GetYesNo() != 0;

		// Line-number ranges (each MAX_HIGHLIGHTS wide):
		//   Active fill    : Base              .. Base + MAX-1
		//   Inactive fill  : Base + MAX        .. Base + 2*MAX-1
		//   Price labels   : Base + 2*MAX      .. Base + 3*MAX-1
		//   Active border  : Base + 3*MAX      .. Base + 4*MAX-1
		//   Inactive border: Base + 4*MAX      .. Base + 5*MAX-1
		const int InactiveBase       = Base + MAX_HIGHLIGHTS;
		const int LabelBase          = Base + 2 * MAX_HIGHLIGHTS;
		const int ActiveBorderBase   = Base + 3 * MAX_HIGHLIGHTS;
		const int InactiveBorderBase = Base + 4 * MAX_HIGHLIGHTS;

		// When rectangles are hidden, clear everything (rects + labels) and stop.
		if (!Show)
		{
			EraseRectangles(sc, 0, 5 * MAX_HIGHLIGHTS);
			return;
		}

		// ── active entries (orange, extend to current bar) ────────────────────
		for (int i = 0; i < p_Cache->HighlightCount; ++i)
		{
			const LVNHighlightEntry& E = p_Cache->Highlights[i];
			if (!E.HasRectangle)
			{
				sc.DeleteACSChartDrawing(sc.ChartNumber, TOOL_DELETE_CHARTDRAWING, Base + i);
				sc.DeleteACSChartDrawing(sc.ChartNumber, TOOL_DELETE_CHARTDRAWING, ActiveBorderBase + i);
				sc.DeleteACSChartDrawing(sc.ChartNumber, TOOL_DELETE_CHARTDRAWING, LabelBase + i);
				continue;
			}
			DrawOneRect(sc, E, Base + i, ActiveBorderBase + i,
			            ActiveFillCol, ActiveBorderCol,
			            ActiveFillTrans, ActiveBorderTrans,
			            /*ForceEndToCurrent=*/true, Debug);

			// Labels are drawn in DrawProfileOverlay (GDI) beside the profile column.
			sc.DeleteACSChartDrawing(sc.ChartNumber, TOOL_DELETE_CHARTDRAWING, LabelBase + i);
		}
		// Erase leftover active + label slots beyond current count.
		EraseRectangles(sc, p_Cache->HighlightCount, MAX_HIGHLIGHTS);
		for (int i = p_Cache->HighlightCount; i < MAX_HIGHLIGHTS; ++i)
		{
			sc.DeleteACSChartDrawing(sc.ChartNumber, TOOL_DELETE_CHARTDRAWING, LabelBase + i);
			sc.DeleteACSChartDrawing(sc.ChartNumber, TOOL_DELETE_CHARTDRAWING, ActiveBorderBase + i);
		}

		// ── inactive entries (grey, fixed end time) ───────────────────────────
		// When "Show Past (Grey) Rectangles" is off, erase them all and skip.
		if (!ShowPast)
		{
			for (int i = 0; i < MAX_HIGHLIGHTS; ++i)
			{
				sc.DeleteACSChartDrawing(sc.ChartNumber, TOOL_DELETE_CHARTDRAWING, InactiveBase + i);
				sc.DeleteACSChartDrawing(sc.ChartNumber, TOOL_DELETE_CHARTDRAWING, InactiveBorderBase + i);
			}
			return;
		}

		for (int i = 0; i < p_Cache->InactiveCount; ++i)
		{
			const LVNHighlightEntry& E = p_Cache->InactiveHighlights[i];
			if (!E.HasRectangle)
			{
				sc.DeleteACSChartDrawing(sc.ChartNumber, TOOL_DELETE_CHARTDRAWING, InactiveBase + i);
				sc.DeleteACSChartDrawing(sc.ChartNumber, TOOL_DELETE_CHARTDRAWING, InactiveBorderBase + i);
				continue;
			}
			DrawOneRect(sc, E, InactiveBase + i, InactiveBorderBase + i,
			            InactiveFillCol, InactiveBorderCol,
			            InactiveFillTrans, InactiveBorderTrans,
			            /*ForceEndToCurrent=*/false, Debug);
		}
		// Erase leftover inactive slots beyond current count.
		for (int i = p_Cache->InactiveCount; i < MAX_HIGHLIGHTS; ++i)
		{
			sc.DeleteACSChartDrawing(sc.ChartNumber, TOOL_DELETE_CHARTDRAWING, InactiveBase + i);
			sc.DeleteACSChartDrawing(sc.ChartNumber, TOOL_DELETE_CHARTDRAWING, InactiveBorderBase + i);
		}
	}

	// ── GDI profile-column overlay ───────────────────────────────────────────

	static void DrawProfileBar(SCStudyInterfaceRef sc,
	                           const COLORREF FillCol,
	                           const COLORREF BorderCol,
	                           const int FillTrans,
	                           const int BorderTrans,
	                           const int Left,
	                           const int Top,
	                           const int Right,
	                           const int Bottom)
	{
		n_ACSIL::s_GraphicsRectangle R;
		R.Left   = Left;
		R.Top    = Top;
		R.Right  = Right;
		R.Bottom = Bottom;

		n_ACSIL::s_GraphicsColor FillGC;
		FillGC.SetRGB(GetRValue(FillCol), GetGValue(FillCol), GetBValue(FillCol));
		const uint8_t TL = static_cast<uint8_t>(max(0, min(FillTrans, 100)));
		sc.Graphics.FillRectangleWithColorTransparent(R, FillGC, TL);

		if (BorderTrans >= 100)
			return;

		const COLORREF BorderDrawCol = FadeBorderColor(BorderCol, BorderTrans);

		n_ACSIL::s_GraphicsPen P;
		P.m_PenStyle = n_ACSIL::s_GraphicsPen::e_PenStyle::PEN_STYLE_SOLID;
		P.m_Width = 1;
		P.m_PenColor.SetRGB(GetRValue(BorderDrawCol), GetGValue(BorderDrawCol), GetBValue(BorderDrawCol));
		sc.Graphics.SetPen(P);

		n_ACSIL::s_GraphicsBrush Hollow;
		Hollow.m_BrushType = n_ACSIL::s_GraphicsBrush::BRUSH_TYPE_STOCK;
		Hollow.m_BrushStockType = NULL_BRUSH;
		sc.Graphics.SetBrush(Hollow);

		sc.Graphics.DrawRectangle(Left, Top, Right, Bottom);
	}

	void DrawProfileOverlay(HWND, HDC, SCStudyInterfaceRef sc)
	{
		const LVNHighlightCache* p = reinterpret_cast<const LVNHighlightCache*>(sc.GetPersistentPointer(1));
		if (p == nullptr || p->HighlightCount <= 0 || p->MaxVolume <= 0.0)
			return;

		const bool ShowLabel = sc.Input[INPUT_SHOW_PRICE_LABEL].GetYesNo() != 0;
		const COLORREF LabelCol = sc.Input[INPUT_LABEL_COLOR].GetColor();
		const int LabelOffsetX = max(sc.Subgraph[SG_PRICE_LABEL].LineWidth, 0);

		int FontSize = 0, FontBold = 0, FontUnderline = 0, FontItalic = 0;
		SCString FontName;
		sc.GetChartFontProperties(FontName, FontSize, FontBold, FontUnderline, FontItalic);

		n_ACSIL::s_GraphicsFont LabelFont;
		LabelFont.m_Height = FontSize > 0 ? FontSize : 12;
		LabelFont.m_Weight = FontBold ? FW_BOLD : FW_NORMAL;
		sc.Graphics.SetTextFont(LabelFont);

		n_ACSIL::s_GraphicsColor LabelTextColor;
		LabelTextColor.SetRGB(GetRValue(LabelCol), GetGValue(LabelCol), GetBValue(LabelCol));
		sc.Graphics.SetTextColor(LabelTextColor);

		const COLORREF ActiveFillCol     = sc.Input[INPUT_VOL_BAR_FILL_COLOR].GetColor();
		const int ActiveFillTrans        = sc.Input[INPUT_VOL_BAR_FILL_TRANSPARENCY].GetInt();
		const COLORREF ActiveBorderCol   = sc.Input[INPUT_VOL_BAR_BORDER_COLOR].GetColor();
		const int ActiveBorderTrans      = sc.Input[INPUT_VOL_BAR_BORDER_TRANSPARENCY].GetInt();

		const COLORREF InactiveFillCol   = sc.Input[INPUT_INACTIVE_RECT_FILL_COLOR].GetColor();
		const int InactiveFillTrans        = sc.Input[INPUT_INACTIVE_RECT_FILL_TRANSPARENCY].GetInt();
		const COLORREF InactiveBorderCol = sc.Input[INPUT_INACTIVE_RECT_BORDER_COLOR].GetColor();
		const int InactiveBorderTrans    = sc.Input[INPUT_INACTIVE_RECT_BORDER_TRANSPARENCY].GetInt();

		const int ProfileWidth = max(p->ProfileWidthPixels, 1);

		for (int i = 0; i < p->HighlightCount; ++i)
		{
			const LVNHighlightEntry& E = p->Highlights[i];

			const COLORREF FillCol   = E.IsActive ? ActiveFillCol : InactiveFillCol;
			const COLORREF BorderCol = E.IsActive ? ActiveBorderCol : InactiveBorderCol;
			const int FillTrans      = E.IsActive ? ActiveFillTrans : InactiveFillTrans;
			const int BorderTrans    = E.IsActive ? ActiveBorderTrans : InactiveBorderTrans;

			int Top    = sc.RegionValueToYPixelCoordinate(E.PriceTop,    0);
			int Bottom = sc.RegionValueToYPixelCoordinate(E.PriceBottom, 0);
			if (Top > Bottom) { int Tmp = Top; Top = Bottom; Bottom = Tmp; }
			if (Bottom - Top < 1) Bottom = Top + 1;

			const int BW = max(
				static_cast<int>((E.Volume / p->MaxVolume) * ProfileWidth),
				MIN_PROFILE_BAR_WIDTH_PIXELS);

			DrawProfileBar(sc, FillCol, BorderCol, FillTrans, BorderTrans,
			               p->ProfileRightX - BW, Top, p->ProfileRightX, Bottom);

			// Mid price label on the price axis, aligned to the MidPrice tick level.
			if (ShowLabel && E.IsActive)
			{
				const SCString LabelText = sc.FormatGraphValue(E.MidPrice, 2);
				const int LabelX = p->ProfileRightX + LabelOffsetX;
				const int PriceY = sc.RegionValueToYPixelCoordinate(E.MidPrice, 0);
				const int LabelY = PriceY + LabelFont.m_Height / 2;

				sc.Graphics.SetTextAlign(TA_LEFT | TA_BASELINE);
				sc.Graphics.DrawTextAt(LabelText, LabelX, LabelY);
			}
		}
	}

	// ── main cache update ────────────────────────────────────────────────────

	static void UpdateCache(SCStudyInterfaceRef sc)
	{
		LVNHighlightCache* p = reinterpret_cast<LVNHighlightCache*>(sc.GetPersistentPointer(1));
		if (p == nullptr)
		{
			p = static_cast<LVNHighlightCache*>(sc.AllocateMemory(sizeof(LVNHighlightCache)));
			if (p == nullptr) return;
			// Zero-initialize all fields since AllocateMemory doesn't call constructors.
			memset(p, 0, sizeof(LVNHighlightCache));
			sc.SetPersistentPointer(1, p);
		}

		// Geometry / scale fields refresh every call (cheap, needed for GDI).
		// HighlightCount is rebuilt every call from the live final profile.
		// InactiveCount / per-level timing are rebuilt on each new chart bar.
		p->MaxVolume         = 0.0;
		p->ProfileRightX     = sc.ChartRegion1RightCoordinate - 5;
		p->ProfileWidthPixels = max(sc.Input[INPUT_PROFILE_WIDTH_PIXELS].GetInt(), 1);
		p->ProfileEndBarIndex = -1;

		const bool DebugLog = sc.Input[INPUT_DEBUG_LOGGING].GetYesNo() != 0;

		// ── resolve study ID (from the Study Reference input only) ───────────
		const int StudyID = sc.Input[INPUT_PROFILE_STUDY].GetStudyID();
		const int ProfileIndex = sc.Input[INPUT_PROFILE_INDEX].GetInt();

		if (StudyID <= 0)
		{
			if (DebugLog)
				sc.AddMessageToLog("LVN Highlight: Study Reference is not set. Select a Volume by Price study in the 'Volume Profile Study Reference' input.", 1);
			return;
		}

		const int PriceLevelCount = sc.GetNumPriceLevelsForStudyProfile(StudyID, ProfileIndex);
		if (PriceLevelCount < 5)
		{
			if (DebugLog)
			{
				SCString Msg;
				Msg.Format("LVN Highlight: StudyID=%d ProfileIndex=%d only has %d price levels.", StudyID, ProfileIndex, PriceLevelCount);
				sc.AddMessageToLog(Msg, 1);
			}
			return;
		}

		// ── load volume and price arrays ────────────────────────────────────
		const int BytesV = PriceLevelCount * static_cast<int>(sizeof(double));
		const int BytesP = PriceLevelCount * static_cast<int>(sizeof(float));
		double* pVol = static_cast<double*>(sc.AllocateMemory(BytesV));
		float*  pPrc = static_cast<float* >(sc.AllocateMemory(BytesP));
		if (pVol == nullptr || pPrc == nullptr)
		{
			if (pVol) sc.FreeMemory(pVol);
			if (pPrc) sc.FreeMemory(pPrc);
			return;
		}

		for (int k = 0; k < PriceLevelCount; ++k)
		{
			s_VolumeAtPriceV2 VAP;
			if (!sc.GetVolumeAtPriceDataForStudyProfile(StudyID, ProfileIndex, k, VAP))
			{
				sc.FreeMemory(pVol); sc.FreeMemory(pPrc);
				return;
			}
			pVol[k] = VAP.GetVolume();
			pPrc[k] = static_cast<float>(sc.TicksToPriceValue(VAP.PriceInTicks));
			if (pVol[k] > p->MaxVolume) p->MaxVolume = pVol[k];
		}

		// ── auto-detect VBP tick-grouping scale ──────────────────────────────
		// When a VBP study uses N "Ticks Per Volume Bar" > 1, PriceInTicks is
		// stored as a bar-group index (native_tick / N), so sc.TicksToPriceValue
		// returns a price N× too small.  Detect this by comparing the average
		// VBP price to the chart's most recent close and apply an integer scale.
		{
			const float ChartClose = (sc.ArraySize > 0)
				? static_cast<float>(sc.Close[sc.ArraySize - 1]) : 0.0f;
			if (PriceLevelCount >= 2 && ChartClose > 0.0f)
			{
				const float RawMid = (pPrc[0] + pPrc[PriceLevelCount - 1]) * 0.5f;
				if (RawMid > 0.0f && ChartClose > RawMid * 1.5f)
				{
					const int TicksPerBar =
						max(1, static_cast<int>(round(static_cast<double>(ChartClose) / RawMid)));
					for (int k = 0; k < PriceLevelCount; ++k)
						pPrc[k] *= static_cast<float>(TicksPerBar);

					if (DebugLog)
					{
						SCString Msg;
						Msg.Format(
							"LVN Highlight: VBP tick-grouping ScaleFactor=%d "
							"(RawMid=%.2f ChartClose=%.2f)",
							TicksPerBar, RawMid, ChartClose);
						sc.AddMessageToLog(Msg, 0);
					}
				}
			}
		}

		// ── profile geometry ────────────────────────────────────────────────
		n_ACSIL::s_StudyProfileInformation PI;
		const bool HasPI = sc.GetStudyProfileInformation(StudyID, ProfileIndex, PI) != 0;
		if (HasPI)
		{
			p->ProfileRightX     = ProfileRightX(sc, PI);
			p->ProfileEndBarIndex = static_cast<int>(PI.m_EndIndex);
		}

		// ── profile session times ───────────────────────────────────────────
		SCDateTime SessionEnd   = HasPI ? ProfileEndDT(sc, PI)
			: (sc.ArraySize > 0 ? sc.BaseDateTimeIn[sc.ArraySize - 1] : SCDateTime(0, 0));
		SCDateTime SessionStart = (HasPI && PI.m_StartDateTime.IsDateSet())
			? PI.m_StartDateTime
			: (sc.ArraySize > 0 ? sc.BaseDateTimeIn[0] : SCDateTime(0, 0));

	// ── scan for LVN patterns ───────────────────────────────────────────
	const double MinNeighborVol = sc.Input[INPUT_MIN_NEIGHBOR_VOLUME].GetInt();

	// Significance floor: flanking peaks must be at least this fraction of the
	// profile's peak (POC) volume. This rejects the noisy low-volume tails of
	// the profile where tiny one-tick dips trivially satisfy the valley shape
	// (the source of spurious LVN highlights at empty price extremes).
	const double MinPeakPct = sc.Input[INPUT_MIN_PEAK_VOLUME_PCT].GetInt() / 100.0;
	const double MinPeakVol = MinPeakPct * p->MaxVolume;

		// Map session start to a bar index on this chart.
		int SessionStartBar = SessionStart.IsDateSet()
			? sc.GetContainingIndexForSCDateTime(sc.ChartNumber, SessionStart) : 0;
		if (SessionStartBar < 0) SessionStartBar = 0;

		// Tick-size epsilon for price-band overlap check.
		const float TickEps = static_cast<float>(sc.TickSize) * 0.5f;

		// Per-bar volume-at-price for this chart (eligibility timing + past runs).
		c_VAPContainer* pVAP = sc.GetVolumeAtPriceForBarsForChart(sc.ChartNumber);

		// ── deterministic historical LVN reconstruction ─────────────────────
		// ACTIVE (orange) LVNs: final profile scan every call (live VBP updates).
		// Forward pass (past grey runs + start timing): once per new bar on THIS chart.
		const int EndBar = sc.ArraySize - 1;
		const bool NeedScan = (p->LastScanArraySize != sc.ArraySize);

		if (NeedScan)
		{
			p->InactiveCount    = 0;
			p->TimingLevelCount = 0;

			// ---- Forward pass: cumulative developing profile + past runs ------
			if (pVAP != nullptr && EndBar >= SessionStartBar
			    && PriceLevelCount >= 5 && PriceLevelCount <= MAX_PROFILE_LEVELS)
			{
				const int N = PriceLevelCount;
				p->TimingLevelCount = N;
				for (int k = 0; k < N; ++k)
				{
					p->RunStartBar[k]  = -1;
					p->EligAtEndLvl[k] = false;
				}

				double*  Cum        = static_cast<double* >(sc.AllocateMemory(N * (int)sizeof(double)));
				float*   BotA       = static_cast<float*  >(sc.AllocateMemory(N * (int)sizeof(float)));
				float*   TopA       = static_cast<float*  >(sc.AllocateMemory(N * (int)sizeof(float)));
				int64_t* LevTick    = static_cast<int64_t*>(sc.AllocateMemory(N * (int)sizeof(int64_t)));
				bool*    Elig       = static_cast<bool*   >(sc.AllocateMemory(N * (int)sizeof(bool)));
				int*     EligPat    = static_cast<int*    >(sc.AllocateMemory(N * (int)sizeof(int)));
				bool*    PrevLvlElig = static_cast<bool*  >(sc.AllocateMemory(N * (int)sizeof(bool)));

				struct RunState { float Bot, Top, Mid; double Vol; int StartBar, LastBar, Pattern; };
				RunState* Open    = static_cast<RunState*>(sc.AllocateMemory(MAX_HIGHLIGHTS * (int)sizeof(RunState)));
				bool*     Matched = static_cast<bool*    >(sc.AllocateMemory(MAX_HIGHLIGHTS * (int)sizeof(bool)));
				int OpenCount = 0;

				if (Cum && BotA && TopA && LevTick && Elig && EligPat && PrevLvlElig && Open && Matched)
				{
					for (int k = 0; k < N; ++k)
					{
						Cum[k]         = 0.0;
						BotA[k]        = LevelBottom(sc, pPrc, N, k);
						TopA[k]        = LevelTop   (sc, pPrc, N, k);
						LevTick[k]     = sc.PriceValueToTicks(pPrc[k]);
						PrevLvlElig[k] = false;
					}

					int64_t G = (N >= 2) ? (LevTick[1] - LevTick[0]) : 1;
					if (G == 0) G = 1;

					for (int B = SessionStartBar; B <= EndBar; ++B)
					{
						const unsigned int Sz = pVAP->GetSizeAtBarIndex(static_cast<unsigned int>(B));
						for (unsigned int e = 0; e < Sz; ++e)
						{
							const s_VolumeAtPriceV2* el = nullptr;
							if (!pVAP->GetVAPElementAtIndex(static_cast<unsigned int>(B),
							        static_cast<int>(e), &el) || el == nullptr)
								continue;
							const int64_t T = el->PriceInTicks;
							const int lvl = static_cast<int>(
								floor(static_cast<double>(T - LevTick[0]) / static_cast<double>(G) + 0.5));
							if (lvl >= 0 && lvl < N)
							{
								int64_t d = T - LevTick[lvl];
								if (d < 0) d = -d;
								const int64_t halfG = G < 0 ? -G : G;
								if (d * 2 <= halfG + 1)
									Cum[lvl] += el->Volume;
							}
						}

						const double maxCum     = MaxCumVolume(Cum, N);
						const double minPeakCum = MinPeakPct * maxCum;

						for (int k = 0; k < N; ++k) Elig[k] = false;
						for (int k = 2; k <= N - 3; ++k)
						{
							const bool ok = IsLevelCumulativelyEligible(
								Cum, N, k, MinNeighborVol, minPeakCum);
							Elig[k] = ok;
							if (ok)
							{
								const bool Is5 = IsPeakFlankedLVNPattern(Cum, N, k);
								EligPat[k] = Is5 ? PATTERN_FIVE_BAR : PATTERN_RIGHT_ASC;
							}
						}

						for (int k = 0; k < N; ++k)
						{
							if (Elig[k] && !PrevLvlElig[k])
								p->RunStartBar[k] = B;
							PrevLvlElig[k] = Elig[k];
						}

						for (int i = 0; i < OpenCount; ++i) Matched[i] = false;

						int k = 2;
						while (k <= N - 3)
						{
							if (!Elig[k]) { ++k; continue; }
							int e0 = k, e1 = k;
							while (e1 + 1 <= N - 3 && Elig[e1 + 1]) ++e1;
							int rep = e0;
							for (int j = e0 + 1; j <= e1; ++j)
								if (Cum[j] < Cum[rep]) rep = j;

							const float  CBot = BotA[rep], CTop = TopA[rep], CMid = pPrc[rep];
							const double CVol = pVol[rep];
							const int    CPat = EligPat[rep];

							int mIdx = -1;
							for (int i = 0; i < OpenCount; ++i)
							{
								if (Matched[i]) continue;
								if (Open[i].Bot < CTop && Open[i].Top > CBot) { mIdx = i; break; }
							}
							if (mIdx >= 0)
							{
								Matched[mIdx] = true;
								Open[mIdx].Bot = CBot; Open[mIdx].Top = CTop; Open[mIdx].Mid = CMid;
								Open[mIdx].Vol = CVol; Open[mIdx].Pattern = CPat; Open[mIdx].LastBar = B;
							}
							else if (OpenCount < MAX_HIGHLIGHTS)
							{
								Matched[OpenCount] = true;
								Open[OpenCount].Bot = CBot; Open[OpenCount].Top = CTop;
								Open[OpenCount].Mid = CMid; Open[OpenCount].Vol = CVol;
								Open[OpenCount].Pattern = CPat;
								Open[OpenCount].StartBar = B; Open[OpenCount].LastBar = B;
								++OpenCount;
							}
							k = e1 + 1;
						}

						for (int i = 0; i < OpenCount; )
						{
							if (Matched[i]) { ++i; continue; }
							if (p->InactiveCount < MAX_HIGHLIGHTS)
							{
								LVNHighlightEntry& E = p->InactiveHighlights[p->InactiveCount++];
								E.PriceBottom = Open[i].Bot; E.PriceTop = Open[i].Top;
								E.MidPrice = Open[i].Mid; E.Volume = Open[i].Vol;
								E.PatternType = Open[i].Pattern;
								E.IsActive = false; E.HasRectangle = true; E.StartConfirmed = true;
								E.RectangleStartDateTime = sc.BaseDateTimeIn[Open[i].StartBar];
								E.RectangleEndDateTime   = sc.BaseDateTimeIn[Open[i].LastBar];
							}
							--OpenCount;
							Open[i]    = Open[OpenCount];
							Matched[i] = Matched[OpenCount];
						}
					}

					for (int k = 0; k < N; ++k)
						p->EligAtEndLvl[k] = PrevLvlElig[k];

					p->LastScanArraySize = sc.ArraySize;
				}

				if (Cum)         sc.FreeMemory(Cum);
				if (BotA)        sc.FreeMemory(BotA);
				if (TopA)        sc.FreeMemory(TopA);
				if (LevTick)     sc.FreeMemory(LevTick);
				if (Elig)        sc.FreeMemory(Elig);
				if (EligPat)     sc.FreeMemory(EligPat);
				if (PrevLvlElig) sc.FreeMemory(PrevLvlElig);
				if (Open)        sc.FreeMemory(Open);
				if (Matched)     sc.FreeMemory(Matched);
			}
		}

		// ---- ACTIVE set: rescan final profile EVERY call (live VBP updates) ----
		p->HighlightCount = 0;
		for (int k = 0; k <= PriceLevelCount - 3; ++k)
		{
			const bool Is5Bar      = IsPeakFlankedLVNPattern(pVol, PriceLevelCount, k);
			const bool IsAscValley = IsAscendingValleyLVN(pVol, PriceLevelCount, k);
			if (!Is5Bar && !IsAscValley) continue;
			if (MinNeighborVol > 0.0 &&
			    (pVol[k - 1] < MinNeighborVol || pVol[k + 1] < MinNeighborVol)) continue;
			if (MinPeakVol > 0.0 &&
			    (pVol[k - 1] < MinPeakVol || pVol[k + 1] < MinPeakVol)) continue;
			if (p->HighlightCount >= MAX_HIGHLIGHTS) break;

			LVNHighlightEntry& E = p->Highlights[p->HighlightCount];
			E.PriceTop     = LevelTop   (sc, pPrc, PriceLevelCount, k);
			E.PriceBottom  = LevelBottom(sc, pPrc, PriceLevelCount, k);
			E.MidPrice     = pPrc[k];
			E.Volume       = pVol[k];
			E.PatternType  = Is5Bar ? PATTERN_FIVE_BAR : PATTERN_RIGHT_ASC;
			E.IsActive     = true;
			E.HasRectangle = true;

			const bool HasTiming = (k < p->TimingLevelCount && p->EligAtEndLvl[k]);
			const int EligBar = HasTiming
				? FindEligibilityBarFromCumHistory(p->RunStartBar, k) : -1;
			if (EligBar >= 0 && EligBar < sc.ArraySize)
			{
				E.RectangleStartDateTime = sc.BaseDateTimeIn[EligBar];
				E.StartConfirmed         = true;
			}
			else
			{
				E.RectangleStartDateTime = sc.BaseDateTimeIn[EndBar];
				E.StartConfirmed         = false;
			}
			E.RectangleEndDateTime = sc.BaseDateTimeIn[EndBar];
			++p->HighlightCount;
		}

		// ── de-duplicate active: keep lowest-volume per adjacent price cluster ─
		if (p->HighlightCount > 1)
		{
			bool Keep[MAX_HIGHLIGHTS];
			for (int i = 0; i < p->HighlightCount; ++i) Keep[i] = true;

			int ci = 0;
			while (ci < p->HighlightCount)
			{
				int ClusterEnd = ci;
				while (ClusterEnd + 1 < p->HighlightCount &&
				       p->Highlights[ClusterEnd + 1].PriceBottom
				           <= p->Highlights[ClusterEnd].PriceTop + TickEps)
					++ClusterEnd;

				if (ClusterEnd > ci)
				{
					int MinIdx = ci;
					for (int j = ci + 1; j <= ClusterEnd; ++j)
						if (p->Highlights[j].Volume < p->Highlights[MinIdx].Volume)
							MinIdx = j;
					for (int j = ci; j <= ClusterEnd; ++j)
						if (j != MinIdx) Keep[j] = false;
				}
				ci = ClusterEnd + 1;
			}

			int NewCount = 0;
			for (int i = 0; i < p->HighlightCount; ++i)
				if (Keep[i]) p->Highlights[NewCount++] = p->Highlights[i];
			p->HighlightCount = NewCount;
		}

		// Drop any past (grey) entry that price-overlaps a live active entry so a
		// reactivated zone is not drawn grey beneath the orange active rectangle.
		{
			int w = 0;
			for (int i = 0; i < p->InactiveCount; ++i)
			{
				const LVNHighlightEntry& In = p->InactiveHighlights[i];
				bool overlapsActive = false;
				for (int a = 0; a < p->HighlightCount; ++a)
				{
					const LVNHighlightEntry& Ac = p->Highlights[a];
					if (Ac.PriceBottom < In.PriceTop && Ac.PriceTop > In.PriceBottom)
					{ overlapsActive = true; break; }
				}
				if (!overlapsActive)
					p->InactiveHighlights[w++] = p->InactiveHighlights[i];
			}
			p->InactiveCount = w;
		}

	if (DebugLog)
		{
			int RectCount = 0;
			for (int i = 0; i < p->HighlightCount; ++i)
				if (p->Highlights[i].HasRectangle) ++RectCount;

			SCString Msg;
			Msg.Format(
				"LVN Highlight: StudyID=%d Levels=%d MaxVol=%.0f Patterns=%d Rects=%d",
				StudyID, PriceLevelCount, p->MaxVolume,
				p->HighlightCount, RectCount);
			sc.AddMessageToLog(Msg, 0);
		}

		sc.FreeMemory(pVol);
		sc.FreeMemory(pPrc);
	}

} // namespace

SCSFExport scsf_VolumeProfileLVNHighlight(SCStudyInterfaceRef sc)
{
	if (sc.SetDefaults)
	{
		sc.GraphName = "Volume Profile LVN Highlight";
		sc.StudyDescription =
			"Highlights low-volume nodes (5-bar valley pattern) in a Volume by Price profile. "
			"Orange GDI highlight on profile column (requires OpenGL off). "
			"Orange chart rectangle from pattern-first-met time to session end. "
			"Set the Study Reference input to the Volume by Price study to use. "
			"For identical LVNs across multiple chart timeframes, point every chart's "
			"Study Reference at the same VBP study (preferably on the finest timeframe chart).";

		sc.AutoLoop = 0;
		sc.FreeDLL = 1;
		sc.GraphRegion = 0;
		sc.UpdateAlways = 1;
		sc.DrawStudyUnderneathMainPriceGraph = 0;

		sc.Input[INPUT_PROFILE_STUDY].Name = "Volume Profile Study Reference";
		sc.Input[INPUT_PROFILE_STUDY].SetStudyID(0);

		sc.Input[INPUT_PROFILE_INDEX].Name = "Profile Index (0 = most recent)";
		sc.Input[INPUT_PROFILE_INDEX].SetInt(0);
		sc.Input[INPUT_PROFILE_INDEX].SetIntLimits(0, 100);

		sc.Input[INPUT_MIN_NEIGHBOR_VOLUME].Name = "Minimum Adjacent Peak Volume";
		sc.Input[INPUT_MIN_NEIGHBOR_VOLUME].SetInt(0);
		sc.Input[INPUT_MIN_NEIGHBOR_VOLUME].SetIntLimits(0, 1000000000);

		sc.Input[INPUT_PROFILE_WIDTH_PIXELS].Name = "Profile Column Width In Pixels (for GDI overlay)";
		sc.Input[INPUT_PROFILE_WIDTH_PIXELS].SetInt(120);
		sc.Input[INPUT_PROFILE_WIDTH_PIXELS].SetIntLimits(10, 2000);

		sc.Input[INPUT_MIN_PEAK_VOLUME_PCT].Name = "Min Flanking Peak Volume (% of POC)";
		sc.Input[INPUT_MIN_PEAK_VOLUME_PCT].SetInt(10);
		sc.Input[INPUT_MIN_PEAK_VOLUME_PCT].SetIntLimits(0, 100);

		sc.Input[INPUT_SHOW_CHART_RECTANGLES].Name = "Show Chart Rectangles";
		sc.Input[INPUT_SHOW_CHART_RECTANGLES].SetYesNo(1);

		sc.Input[INPUT_SHOW_PAST_RECTANGLES].Name = "Show Past (Grey) Rectangles";
		sc.Input[INPUT_SHOW_PAST_RECTANGLES].SetYesNo(1);

		sc.Input[INPUT_SHOW_PRICE_LABEL].Name = "Show Middle Price Label";
		sc.Input[INPUT_SHOW_PRICE_LABEL].SetYesNo(1);

		sc.Input[INPUT_LABEL_COLOR].Name = "Middle Price Label Color";
		sc.Input[INPUT_LABEL_COLOR].SetColor(RGB(255, 128, 0));

		sc.Input[INPUT_DEBUG_LOGGING].Name = "Enable Debug Logging";
		sc.Input[INPUT_DEBUG_LOGGING].SetYesNo(1);

		sc.Input[INPUT_VOL_BAR_FILL_COLOR].Name = "LVN Volume Bar Fill Color";
		sc.Input[INPUT_VOL_BAR_FILL_COLOR].SetColor(RGB(255, 140, 0));

		sc.Input[INPUT_VOL_BAR_FILL_TRANSPARENCY].Name = "LVN Volume Bar Fill Transparency (0=solid, 100=invisible)";
		sc.Input[INPUT_VOL_BAR_FILL_TRANSPARENCY].SetInt(50);
		sc.Input[INPUT_VOL_BAR_FILL_TRANSPARENCY].SetIntLimits(0, 100);

		sc.Input[INPUT_VOL_BAR_BORDER_COLOR].Name = "LVN Volume Bar Border Color";
		sc.Input[INPUT_VOL_BAR_BORDER_COLOR].SetColor(RGB(255, 140, 0));

		sc.Input[INPUT_VOL_BAR_BORDER_TRANSPARENCY].Name = "LVN Volume Bar Border Transparency (0=solid, 100=invisible)";
		sc.Input[INPUT_VOL_BAR_BORDER_TRANSPARENCY].SetInt(50);
		sc.Input[INPUT_VOL_BAR_BORDER_TRANSPARENCY].SetIntLimits(0, 100);

		sc.Input[INPUT_ACTIVE_RECT_FILL_COLOR].Name = "Active Rectangle Fill Color";
		sc.Input[INPUT_ACTIVE_RECT_FILL_COLOR].SetColor(RGB(255, 140, 0));

		sc.Input[INPUT_ACTIVE_RECT_FILL_TRANSPARENCY].Name = "Active Rectangle Fill Transparency (0=solid, 100=invisible)";
		sc.Input[INPUT_ACTIVE_RECT_FILL_TRANSPARENCY].SetInt(85);
		sc.Input[INPUT_ACTIVE_RECT_FILL_TRANSPARENCY].SetIntLimits(0, 100);

		sc.Input[INPUT_ACTIVE_RECT_BORDER_COLOR].Name = "Active Rectangle Border Color";
		sc.Input[INPUT_ACTIVE_RECT_BORDER_COLOR].SetColor(RGB(255, 128, 0));

		sc.Input[INPUT_ACTIVE_RECT_BORDER_TRANSPARENCY].Name = "Active Rectangle Border Transparency (0=solid, 100=invisible)";
		sc.Input[INPUT_ACTIVE_RECT_BORDER_TRANSPARENCY].SetInt(20);
		sc.Input[INPUT_ACTIVE_RECT_BORDER_TRANSPARENCY].SetIntLimits(0, 100);

		sc.Input[INPUT_INACTIVE_RECT_FILL_COLOR].Name = "Inactive Rectangle Fill Color";
		sc.Input[INPUT_INACTIVE_RECT_FILL_COLOR].SetColor(RGB(160, 160, 160));

		sc.Input[INPUT_INACTIVE_RECT_FILL_TRANSPARENCY].Name = "Inactive Rectangle Fill Transparency (0=solid, 100=invisible)";
		sc.Input[INPUT_INACTIVE_RECT_FILL_TRANSPARENCY].SetInt(85);
		sc.Input[INPUT_INACTIVE_RECT_FILL_TRANSPARENCY].SetIntLimits(0, 100);

		sc.Input[INPUT_INACTIVE_RECT_BORDER_COLOR].Name = "Inactive Rectangle Border Color";
		sc.Input[INPUT_INACTIVE_RECT_BORDER_COLOR].SetColor(RGB(160, 160, 160));

		sc.Input[INPUT_INACTIVE_RECT_BORDER_TRANSPARENCY].Name = "Inactive Rectangle Border Transparency (0=solid, 100=invisible)";
		sc.Input[INPUT_INACTIVE_RECT_BORDER_TRANSPARENCY].SetInt(20);
		sc.Input[INPUT_INACTIVE_RECT_BORDER_TRANSPARENCY].SetIntLimits(0, 100);

		sc.Subgraph[SG_PRICE_LABEL].Name = "Price Label Horizontal Offset (pixels from profile column)";
		sc.Subgraph[SG_PRICE_LABEL].DrawStyle = DRAWSTYLE_IGNORE;
		sc.Subgraph[SG_PRICE_LABEL].LineWidth = 4;

		return;
	}

	if (sc.LastCallToFunction)
	{
		EraseRectangles(sc, 0, 5 * MAX_HIGHLIGHTS);

		LVNHighlightCache* p = reinterpret_cast<LVNHighlightCache*>(sc.GetPersistentPointer(1));
		if (p != nullptr)
		{
			sc.FreeMemory(p);
			sc.SetPersistentPointer(1, nullptr);
		}
		return;
	}

	// When the study is hidden, Sierra Chart still calls this function but does
	// NOT auto-remove our manually-added chart drawings or GDI overlay. Clear
	// them ourselves so hiding the study removes everything from the chart.
	if (sc.HideStudy)
	{
		sc.p_GDIFunction = nullptr;
		EraseRectangles(sc, 0, 5 * MAX_HIGHLIGHTS);
		return;
	}

	sc.p_GDIFunction = DrawProfileOverlay;

	UpdateCache(sc);

	const LVNHighlightCache* p = reinterpret_cast<const LVNHighlightCache*>(sc.GetPersistentPointer(1));
	DrawRectangles(sc, p);
}
