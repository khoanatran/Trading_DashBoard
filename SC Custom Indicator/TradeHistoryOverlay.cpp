// The top of every source code file must include this line
#include "sierrachart.h"

#include <cstdio>
#include <cstring>

// https://www.sierrachart.com/index.php?page=doc/AdvancedCustomStudyInterfaceAndLanguage.php

SCDLLName("TDV Trade History")

namespace
{
	const int MAX_TRADES = 500;
	const int MAX_DAYS = 64;
	const int DRAWINGS_PER_TRADE = 5;

	const int DRAWING_RECT_PRICE = 0;
	const int DRAWING_ENTRY_MARKER = 1;
	const int DRAWING_EXIT_MARKER = 2;
	const int DRAWING_POINTS_LABEL = 3;
	const int DRAWING_RECT_CANDLE_WRAP = 4;

	const int INPUT_TRADE_EXPORT_PATH = 0;
	const int INPUT_SHOW_EXIT_MARKERS = 1;
	const int INPUT_WIN_RECT_COLOR = 2;
	const int INPUT_WIN_RECT_TRANSPARENCY = 3;
	const int INPUT_LOSS_RECT_COLOR = 4;
	const int INPUT_LOSS_RECT_TRANSPARENCY = 5;
	const int INPUT_SELECTION_MODE = 6;
	const int INPUT_DAY_DROPDOWN = 7;
	const int INPUT_TRADE_DROPDOWN = 8;
	const int INPUT_FILTER_SUMMARY = 9;
	const int INPUT_SHOW_POINTS_LABEL = 10;
	const int INPUT_REFERENCE_CHART = 11;

	const int STUDY_INPUT_COUNT = 12;
	const int STUDY_SETTINGS_VERSION = 7;
	const int DEFAULT_REFERENCE_CHART = 0;
	const char* DEFAULT_TRADE_EXPORT_PATH =
		"C:\\SierraChart\\Trade History for SC\\trade-export-ET.txt";
	const char* TRADE_EXPORT_RELATIVE_PATH =
		"Trade History for SC\\trade-export-ET.txt";

	const int MODE_SHOW_ALL = 0;
	const int REFERENCE_BAR_SECONDS = 1;
	const char* STUDY_DISPLAY_NAME = "TDV Trade History Overlay";

	struct TradeRecord
	{
		SCDateTime EntryET;
		SCDateTime ExitET;
		bool IsLong;
		bool Valid;
		bool HasPnL = false;
		float PnLValue = 0.0f;
		char PnLText[32];
	};

	struct OneSecondPriceLookup
	{
		int ReferenceChartNumber = 0;
		bool UsesLocalArrays = false;
		SCGraphData BaseData;
	};

	struct TradeCache
	{
		TradeRecord Trades[MAX_TRADES] = {};
		int TradeCount = 0;
		int FileSize = 0;

		int DayDateKey[MAX_DAYS] = {};
		int DayTradeCount[MAX_DAYS] = {};
		int TradeDayIndex[MAX_TRADES] = {};
		int DayCount = 0;

		int TradeDropdownMap[MAX_TRADES + 1] = {};
		int TradeDropdownCount = 0;
		int CachedDayDropdownIndex = -1;
	};

	struct SharedFilterState
	{
		int Version = 0;
		int SourceChartNumber = 0;
		int SourceStudyID = 0;
		int SelectionMode = 0;
		int DayDateKey = 0;
		int SelectedTradeIndex = -1;
	};

	static SharedFilterState g_SharedFilterState;

	struct SharedMarkerPriceState
	{
		int Version = 0;
		int SourceChartNumber = 0;
		bool Valid[MAX_TRADES] = {};
		float EntryPrice[MAX_TRADES] = {};
		float ExitPrice[MAX_TRADES] = {};
	};

	static SharedMarkerPriceState g_SharedMarkerPrices;

	struct SharedReferenceChartState
	{
		int Version = 0;
		int ReferenceChartNumber = 0;
		char Symbol[64] = {};
	};

	static SharedReferenceChartState g_SharedReferenceChart;

	static int GetDateKey(const SCDateTime& DateTime)
	{
		int Year = 0;
		int Month = 0;
		int Day = 0;
		int Hour = 0;
		int Minute = 0;
		int Second = 0;
		DateTime.GetDateTimeYMDHMS(Year, Month, Day, Hour, Minute, Second);
		return Year * 10000 + Month * 100 + Day;
	}

	static void CopyPnLText(const char* Source, char* Dest, const int DestSize)
	{
		if (DestSize < 2)
			return;

		Dest[0] = '\0';
		if (Source == nullptr)
			return;

		const char* ValuePos = strstr(Source, "P&L");
		if (ValuePos == nullptr)
			return;

		ValuePos = strchr(ValuePos, '$');
		if (ValuePos == nullptr)
		{
			if (strstr(Source, "N/A") != nullptr)
			{
				strncpy(Dest, "N/A", DestSize - 1);
				Dest[DestSize - 1] = '\0';
			}
			return;
		}

		if (ValuePos > Source && *(ValuePos - 1) == '-')
			--ValuePos;

		int CopyIndex = 0;
		for (; *ValuePos != '\0' && CopyIndex < DestSize - 1; ++ValuePos)
		{
			if (*ValuePos == '\r' || *ValuePos == '\n')
				break;
			Dest[CopyIndex++] = *ValuePos;
		}
		Dest[CopyIndex] = '\0';
	}

	static float ParsePnLValueFromText(const char* PnLText)
	{
		if (PnLText == nullptr || PnLText[0] == '\0')
			return 0.0f;

		if (strcmp(PnLText, "N/A") == 0)
			return 0.0f;

		const char* Start = PnLText;
		bool Negative = false;

		if (*Start == '-')
		{
			Negative = true;
			++Start;
		}

		if (*Start == '$')
			++Start;

		double Value = 0.0;
		if (sscanf(Start, "%lf", &Value) != 1)
			return 0.0f;

		const float PnLValue = static_cast<float>(Value);
		return Negative ? -PnLValue : PnLValue;
	}

	static void ParsePnLFromLine(
		const char* Line,
		char* PnLText,
		const int PnLTextSize,
		float& OutPnLValue,
		bool& OutHasPnL)
	{
		CopyPnLText(Line, PnLText, PnLTextSize);
		OutPnLValue = ParsePnLValueFromText(PnLText);
		OutHasPnL = (strstr(Line, "P&L") != nullptr && strcmp(PnLText, "N/A") != 0);
	}

	static bool IsWinningTrade(const TradeRecord& Trade)
	{
		return Trade.HasPnL && Trade.PnLValue > 0.0f;
	}

	static float CalculateTradePoints(
		const TradeRecord& Trade,
		const float EntryMarkerValue,
		const float ExitMarkerValue)
	{
		if (Trade.IsLong)
			return ExitMarkerValue - EntryMarkerValue;

		return EntryMarkerValue - ExitMarkerValue;
	}

	static SCString FormatTradePointsText(
		SCStudyInterfaceRef sc,
		const float Points)
	{
		const float AbsolutePoints = fabsf(Points);
		const SCString FormattedPoints =
			sc.FormatGraphValue(AbsolutePoints, sc.BaseGraphValueFormat);

		SCString PointsText;
		if (Points >= 0.0f)
			PointsText.Format("+%s pts", FormattedPoints.GetChars());
		else
			PointsText.Format("-%s pts", FormattedPoints.GetChars());

		return PointsText;
	}

	static SCDateTime GetTradeLabelDateTime(
		const SCDateTime& EntryChartTime,
		const SCDateTime& RectangleEndTime)
	{
		const double Midpoint =
			(EntryChartTime.GetAsDouble() + RectangleEndTime.GetAsDouble()) * 0.5;
		return SCDateTime(Midpoint);
	}

	static float GetTradeLabelValue(
		const bool IsLong,
		const float EntryMarkerValue,
		const float RectangleEndValue,
		const float TickSize)
	{
		const float Offset = TickSize * 3.0f;

		if (IsLong)
			return max(EntryMarkerValue, RectangleEndValue) + Offset;

		return min(EntryMarkerValue, RectangleEndValue) - Offset;
	}

	static bool ParseEtDateTimeFromLine(const char* Line, SCDateTime& OutDateTime)
	{
		const char* YearPos = strstr(Line, "20");
		if (YearPos == nullptr)
			return false;

		int Year = 0;
		int Month = 0;
		int Day = 0;
		int Hour = 0;
		int Minute = 0;
		int Second = 0;

		if (sscanf(YearPos, "%d-%d-%d %d:%d:%d",
			&Year, &Month, &Day, &Hour, &Minute, &Second) != 6)
			return false;

		if (Year < 2000 || Month < 1 || Month > 12 || Day < 1 || Day > 31)
			return false;

		OutDateTime = SCDateTime(Year, Month, Day, Hour, Minute, Second);
		return true;
	}

	static bool ParseDirectionFromLine(const char* Line, bool& OutIsLong)
	{
		const char* ValuePos = strstr(Line, "Direction");
		if (ValuePos == nullptr)
			return false;

		ValuePos = strchr(ValuePos, ' ');
		if (ValuePos == nullptr)
			return false;

		while (*ValuePos == ' ')
			++ValuePos;

		if (_strnicmp(ValuePos, "long", 4) == 0)
		{
			OutIsLong = true;
			return true;
		}

		if (_strnicmp(ValuePos, "short", 5) == 0)
		{
			OutIsLong = false;
			return true;
		}

		if (_strnicmp(ValuePos, "buy", 3) == 0)
		{
			OutIsLong = true;
			return true;
		}

		if (_strnicmp(ValuePos, "sell", 4) == 0)
		{
			OutIsLong = false;
			return true;
		}

		return false;
	}

	static int ParseTradesFromExport(const char* FileText, TradeRecord* Trades, const int MaxTrades)
	{
		int TradeCount = 0;
		TradeRecord CurrentTrade = {};
		bool InTradeBlock = false;

		const char* LineStart = FileText;
		while (*LineStart != '\0' && TradeCount < MaxTrades)
		{
			const char* LineEnd = LineStart;
			while (*LineEnd != '\0' && *LineEnd != '\n' && *LineEnd != '\r')
				++LineEnd;

			char Line[256] = {};
			const int LineLen = static_cast<int>(LineEnd - LineStart);
			if (LineLen > 0)
			{
				const int CopyLen = LineLen < static_cast<int>(sizeof(Line) - 1)
					? LineLen
					: static_cast<int>(sizeof(Line) - 1);
				memcpy(Line, LineStart, CopyLen);
				Line[CopyLen] = '\0';
			}

			if (strncmp(Line, "Trade #", 7) == 0)
			{
				if (InTradeBlock && CurrentTrade.Valid)
					Trades[TradeCount++] = CurrentTrade;

				CurrentTrade = {};
				InTradeBlock = true;
			}
			else if (InTradeBlock)
			{
				if (strstr(Line, "Entry Time (ET)") != nullptr)
					CurrentTrade.Valid = ParseEtDateTimeFromLine(Line, CurrentTrade.EntryET);

				if (strstr(Line, "Exit Time (ET)") != nullptr)
					ParseEtDateTimeFromLine(Line, CurrentTrade.ExitET);

				if (strstr(Line, "Direction") != nullptr)
					ParseDirectionFromLine(Line, CurrentTrade.IsLong);

				if (strstr(Line, "P&L") != nullptr)
				{
					ParsePnLFromLine(
						Line,
						CurrentTrade.PnLText,
						sizeof(CurrentTrade.PnLText),
						CurrentTrade.PnLValue,
						CurrentTrade.HasPnL);
				}
			}

			if (*LineEnd == '\0')
				break;

			LineStart = LineEnd;
			if (*LineStart == '\r')
				++LineStart;
			if (*LineStart == '\n')
				++LineStart;
		}

		if (InTradeBlock && CurrentTrade.Valid && TradeCount < MaxTrades)
			Trades[TradeCount++] = CurrentTrade;

		return TradeCount;
	}

	static bool IsCurrentTradeExportPath(const SCString& Path)
	{
		return Path.Compare(DEFAULT_TRADE_EXPORT_PATH) == 0;
	}

	static bool IsLegacyTradeExportPath(const SCString& Path)
	{
		const char* PathChars = Path.GetChars();
		if (PathChars == nullptr || Path.GetLength() == 0)
			return false;

		if (IsCurrentTradeExportPath(Path))
			return false;

		return strstr(PathChars, TRADE_EXPORT_RELATIVE_PATH) != nullptr;
	}

	static SCString RemapLegacyTradeExportPath(const SCString& Path)
	{
		if (IsLegacyTradeExportPath(Path))
			return SCString(DEFAULT_TRADE_EXPORT_PATH);

		return Path;
	}

	static SCString GetDefaultTradeExportPath()
	{
		return SCString(DEFAULT_TRADE_EXPORT_PATH);
	}

	static bool ReadTextFile(SCStudyInterfaceRef sc, const SCString& Path, SCString& OutText)
	{
		int FileHandle = 0;
		if (sc.OpenFile(Path, n_ACSIL::FILE_MODE_OPEN_EXISTING_FOR_SEQUENTIAL_READING, FileHandle) <= 0)
			return false;

		OutText = "";
		char Buffer[4096] = {};

		for (;;)
		{
			unsigned int BytesRead = 0;
			if (sc.ReadFile(FileHandle, Buffer, static_cast<int>(sizeof(Buffer) - 1), &BytesRead) <= 0
				|| BytesRead == 0)
				break;

			Buffer[BytesRead] = '\0';
			OutText += Buffer;
		}

		sc.CloseFile(FileHandle);
		return OutText.GetLength() > 0;
	}

	static bool TryReadTradeExportFile(
		SCStudyInterfaceRef sc,
		const SCString& Path,
		SCString& OutText)
	{
		if (Path.GetLength() == 0)
			return false;

		return ReadTextFile(sc, Path, OutText);
	}

	static SCString ResolveTradeExportPath(
		SCStudyInterfaceRef sc,
		SCString& OutText,
		bool& OutPathUpdated)
	{
		OutPathUpdated = false;
		OutText = "";

		SCString ConfiguredPath = sc.Input[INPUT_TRADE_EXPORT_PATH].GetString();
		if (ConfiguredPath.GetLength() == 0)
			ConfiguredPath = GetDefaultTradeExportPath();

		if (TryReadTradeExportFile(sc, ConfiguredPath, OutText))
			return ConfiguredPath;

		const SCString LegacyResolvedPath = RemapLegacyTradeExportPath(ConfiguredPath);
		if (LegacyResolvedPath != ConfiguredPath
			&& TryReadTradeExportFile(sc, LegacyResolvedPath, OutText))
		{
			OutPathUpdated = true;
			return LegacyResolvedPath;
		}

		const SCString DefaultPath = GetDefaultTradeExportPath();
		if (DefaultPath != ConfiguredPath
			&& DefaultPath != LegacyResolvedPath
			&& TryReadTradeExportFile(sc, DefaultPath, OutText))
		{
			OutPathUpdated = true;
			return DefaultPath;
		}

		return ConfiguredPath;
	}

	static void DeleteTradeDrawings(
		SCStudyInterfaceRef sc,
		const int BaseLineNumber,
		const int FirstTradeIndex,
		const int LastTradeIndex)
	{
		for (int TradeIndex = FirstTradeIndex; TradeIndex < LastTradeIndex; ++TradeIndex)
		{
			for (int DrawingOffset = 0; DrawingOffset < DRAWINGS_PER_TRADE; ++DrawingOffset)
			{
				sc.DeleteACSChartDrawing(
					sc.ChartNumber,
					TOOL_DELETE_CHARTDRAWING,
					BaseLineNumber + TradeIndex * DRAWINGS_PER_TRADE + DrawingOffset);
			}
		}
	}

	static bool IsOneSecondIntradayChart(SCStudyInterfaceRef sc, const int ChartNumber)
	{
		n_ACSIL::s_BarPeriod BarPeriod;
		if (ChartNumber == sc.ChartNumber)
			sc.GetBarPeriodParameters(BarPeriod);
		else
			sc.GetBarPeriodParametersForChart(ChartNumber, BarPeriod);

		return BarPeriod.ChartDataType == INTRADAY_DATA
			&& BarPeriod.IntradayChartBarPeriodType == IBPT_DAYS_MINS_SECS
			&& BarPeriod.IntradayChartBarPeriodParameter1 == REFERENCE_BAR_SECONDS;
	}

	static int GetReferenceBarIndexForDateTime(
		SCStudyInterfaceRef sc,
		const int ChartNumber,
		const SCDateTime& ChartDateTime)
	{
		int BarIndex = sc.GetNearestMatchForSCDateTimeExtended(ChartNumber, ChartDateTime);
		if (BarIndex < 0)
			BarIndex = sc.GetNearestMatchForSCDateTime(ChartNumber, ChartDateTime);

		return BarIndex;
	}

	static int GetReferenceArraySize(
		SCStudyInterfaceRef sc,
		const OneSecondPriceLookup& Lookup)
	{
		if (Lookup.UsesLocalArrays)
			return sc.ArraySize;

		return Lookup.BaseData[SC_HIGH].GetArraySize();
	}

	static float GetBarLast(
		SCStudyInterfaceRef sc,
		const OneSecondPriceLookup& Lookup,
		const int BarIndex)
	{
		if (BarIndex < 0)
			return 0.0f;

		if (Lookup.UsesLocalArrays)
		{
			if (BarIndex >= sc.ArraySize)
				return 0.0f;
			return sc.Close[BarIndex];
		}

		if (BarIndex >= Lookup.BaseData[SC_LAST].GetArraySize())
			return 0.0f;

		return Lookup.BaseData[SC_LAST][BarIndex];
	}

	static void ResolveTradeMarkerPrices(
		SCStudyInterfaceRef sc,
		const OneSecondPriceLookup& Lookup,
		const int EntryBarIndex,
		const int ExitBarIndex,
		float& OutEntryPrice,
		float& OutExitPrice)
	{
		OutEntryPrice = GetBarLast(sc, Lookup, EntryBarIndex);
		OutExitPrice = GetBarLast(sc, Lookup, ExitBarIndex);
	}

	static bool TryGetSharedMarkerPrices(
		const int TradeIndex,
		float& OutEntryPrice,
		float& OutExitPrice)
	{
		if (TradeIndex < 0 || TradeIndex >= MAX_TRADES || !g_SharedMarkerPrices.Valid[TradeIndex])
			return false;

		OutEntryPrice = g_SharedMarkerPrices.EntryPrice[TradeIndex];
		OutExitPrice = g_SharedMarkerPrices.ExitPrice[TradeIndex];
		return OutEntryPrice > 0.0f || OutExitPrice > 0.0f;
	}

	static void PublishSharedMarkerPrices(
		SCStudyInterfaceRef sc,
		const int TradeIndex,
		const float EntryPrice,
		const float ExitPrice)
	{
		if (TradeIndex < 0 || TradeIndex >= MAX_TRADES)
			return;

		g_SharedMarkerPrices.EntryPrice[TradeIndex] = EntryPrice;
		g_SharedMarkerPrices.ExitPrice[TradeIndex] = ExitPrice;
		g_SharedMarkerPrices.Valid[TradeIndex] =
			(EntryPrice > 0.0f || ExitPrice > 0.0f);
		g_SharedMarkerPrices.SourceChartNumber = sc.ChartNumber;
	}

	static void ResetSharedMarkerPrices()
	{
		g_SharedMarkerPrices.Version = 0;
		g_SharedMarkerPrices.SourceChartNumber = 0;
		memset(g_SharedMarkerPrices.Valid, 0, sizeof(g_SharedMarkerPrices.Valid));
		memset(g_SharedMarkerPrices.EntryPrice, 0, sizeof(g_SharedMarkerPrices.EntryPrice));
		memset(g_SharedMarkerPrices.ExitPrice, 0, sizeof(g_SharedMarkerPrices.ExitPrice));
	}

	static void ResetSharedReferenceChart()
	{
		g_SharedReferenceChart.Version = 0;
		g_SharedReferenceChart.ReferenceChartNumber = 0;
		g_SharedReferenceChart.Symbol[0] = '\0';
	}

	static void PublishSharedReferenceChart(
		const SCString& CurrentSymbol,
		const int ReferenceChartNumber)
	{
		if (ReferenceChartNumber <= 0)
			return;

		g_SharedReferenceChart.ReferenceChartNumber = ReferenceChartNumber;
		strncpy(
			g_SharedReferenceChart.Symbol,
			CurrentSymbol.GetChars(),
			sizeof(g_SharedReferenceChart.Symbol) - 1);
		g_SharedReferenceChart.Symbol[sizeof(g_SharedReferenceChart.Symbol) - 1] = '\0';
		++g_SharedReferenceChart.Version;
	}

	static int GetOneSecondChartArraySize(
		SCStudyInterfaceRef sc,
		const int ChartNumber)
	{
		if (ChartNumber == sc.ChartNumber)
			return sc.ArraySize;

		SCGraphData BaseData;
		sc.GetChartBaseData(ChartNumber, BaseData);
		return BaseData[SC_LAST].GetArraySize();
	}

	static bool IsUsableOneSecondReferenceChart(
		SCStudyInterfaceRef sc,
		const int ChartNumber,
		const SCString& CurrentSymbol)
	{
		if (ChartNumber <= 0 || ChartNumber > sc.GetHighestChartNumberUsedInChartBook())
			return false;

		if (!IsOneSecondIntradayChart(sc, ChartNumber))
			return false;

		if (sc.GetChartSymbol(ChartNumber) != CurrentSymbol)
			return false;

		return GetOneSecondChartArraySize(sc, ChartNumber) >= 2;
	}

	static int AutoDetectOneSecondReferenceChart(SCStudyInterfaceRef sc)
	{
		const SCString CurrentSymbol = sc.Symbol;

		if (g_SharedReferenceChart.ReferenceChartNumber > 0
			&& strcmp(g_SharedReferenceChart.Symbol, CurrentSymbol.GetChars()) == 0
			&& IsUsableOneSecondReferenceChart(
				sc,
				g_SharedReferenceChart.ReferenceChartNumber,
				CurrentSymbol))
		{
			return g_SharedReferenceChart.ReferenceChartNumber;
		}

		const int HighestChartNumber = sc.GetHighestChartNumberUsedInChartBook();
		int BestChartNumber = 0;
		int BestArraySize = 0;
		int FallbackChartNumber = 0;
		int FallbackArraySize = 0;

		for (int ChartNumber = 1; ChartNumber <= HighestChartNumber; ++ChartNumber)
		{
			if (!IsOneSecondIntradayChart(sc, ChartNumber))
				continue;

			const int ArraySize = GetOneSecondChartArraySize(sc, ChartNumber);
			if (ArraySize < 2)
				continue;

			if (sc.GetChartSymbol(ChartNumber) == CurrentSymbol)
			{
				if (ArraySize > BestArraySize)
				{
					BestArraySize = ArraySize;
					BestChartNumber = ChartNumber;
				}
				continue;
			}

			if (ArraySize > FallbackArraySize)
			{
				FallbackArraySize = ArraySize;
				FallbackChartNumber = ChartNumber;
			}
		}

		const int DetectedChartNumber =
			(BestChartNumber > 0) ? BestChartNumber : FallbackChartNumber;

		if (DetectedChartNumber > 0)
			PublishSharedReferenceChart(CurrentSymbol, DetectedChartNumber);

		return DetectedChartNumber;
	}

	static int FindOneSecondReferenceChart(
		SCStudyInterfaceRef sc,
		const int PreferredChartNumber)
	{
		const SCString CurrentSymbol = sc.Symbol;

		if (IsOneSecondIntradayChart(sc, sc.ChartNumber)
			&& GetOneSecondChartArraySize(sc, sc.ChartNumber) >= 2)
		{
			PublishSharedReferenceChart(CurrentSymbol, sc.ChartNumber);
			return sc.ChartNumber;
		}

		if (PreferredChartNumber > 0
			&& IsUsableOneSecondReferenceChart(sc, PreferredChartNumber, CurrentSymbol))
		{
			PublishSharedReferenceChart(CurrentSymbol, PreferredChartNumber);
			return PreferredChartNumber;
		}

		return AutoDetectOneSecondReferenceChart(sc);
	}

	static bool PrepareOneSecondPriceLookup(
		SCStudyInterfaceRef sc,
		OneSecondPriceLookup& Lookup)
	{
		const int PreferredChartNumber = sc.Input[INPUT_REFERENCE_CHART].GetInt();
		Lookup.ReferenceChartNumber = FindOneSecondReferenceChart(sc, PreferredChartNumber);
		if (Lookup.ReferenceChartNumber == 0)
			return false;

		Lookup.UsesLocalArrays = (Lookup.ReferenceChartNumber == sc.ChartNumber);
		if (!Lookup.UsesLocalArrays)
			sc.GetChartBaseData(Lookup.ReferenceChartNumber, Lookup.BaseData);

		return true;
	}

	static void FinalizeSharedMarkerPrices(SCStudyInterfaceRef sc)
	{
		if (!IsOneSecondIntradayChart(sc, sc.ChartNumber))
			return;

		++g_SharedMarkerPrices.Version;
	}

	static void EnsureMinimumRectangleHeight(
		const bool IsLong,
		const float TickSize,
		float& EntryValue,
		float& ExitValue)
	{
		const float MinSpan = TickSize * 4.0f;
		const float Span = ExitValue - EntryValue;

		if (Span >= MinSpan || Span <= -MinSpan)
			return;

		if (IsLong)
			ExitValue = EntryValue + MinSpan;
		else
			ExitValue = EntryValue - MinSpan;
	}

	static int FindDayIndex(const TradeCache& Cache, const int DateKey)
	{
		for (int DayIndex = 0; DayIndex < Cache.DayCount; ++DayIndex)
		{
			if (Cache.DayDateKey[DayIndex] == DateKey)
				return DayIndex;
		}
		return -1;
	}

	static void BuildDayGroups(TradeCache& Cache)
	{
		Cache.DayCount = 0;
		memset(Cache.DayDateKey, 0, sizeof(Cache.DayDateKey));
		memset(Cache.DayTradeCount, 0, sizeof(Cache.DayTradeCount));

		for (int TradeIndex = 0; TradeIndex < Cache.TradeCount; ++TradeIndex)
			Cache.TradeDayIndex[TradeIndex] = -1;

		for (int TradeIndex = 0; TradeIndex < Cache.TradeCount; ++TradeIndex)
		{
			const int DateKey = GetDateKey(Cache.Trades[TradeIndex].EntryET);
			int DayIndex = FindDayIndex(Cache, DateKey);

			if (DayIndex < 0 && Cache.DayCount < MAX_DAYS)
			{
				DayIndex = Cache.DayCount++;
				Cache.DayDateKey[DayIndex] = DateKey;
			}

			if (DayIndex >= 0)
			{
				Cache.TradeDayIndex[TradeIndex] = DayIndex;
				++Cache.DayTradeCount[DayIndex];
			}
		}

		for (int i = 1; i < Cache.DayCount; ++i)
		{
			const int Key = Cache.DayDateKey[i];
			const int Count = Cache.DayTradeCount[i];
			int j = i;

			while (j > 0 && Cache.DayDateKey[j - 1] < Key)
			{
				Cache.DayDateKey[j] = Cache.DayDateKey[j - 1];
				Cache.DayTradeCount[j] = Cache.DayTradeCount[j - 1];
				--j;
			}

			Cache.DayDateKey[j] = Key;
			Cache.DayTradeCount[j] = Count;
		}

		for (int TradeIndex = 0; TradeIndex < Cache.TradeCount; ++TradeIndex)
		{
			const int DateKey = GetDateKey(Cache.Trades[TradeIndex].EntryET);
			Cache.TradeDayIndex[TradeIndex] = FindDayIndex(Cache, DateKey);
		}
	}

	static void FormatDateKey(const int DateKey, int& Year, int& Month, int& Day)
	{
		Year = DateKey / 10000;
		Month = (DateKey / 100) % 100;
		Day = DateKey % 100;
	}

	static int ClampDayDropdownIndex(const TradeCache& Cache, const int DropdownIndex)
	{
		if (DropdownIndex < 0 || DropdownIndex > Cache.DayCount)
			return 0;

		return DropdownIndex;
	}

	static void UpdateDayDropdown(
		SCStudyInterfaceRef sc,
		const TradeCache& Cache,
		const int PreferredIndex)
	{
		const int PreviousIndex = ClampDayDropdownIndex(Cache, PreferredIndex);

		SCString DayStrings("All Days");

		for (int DayIndex = 0; DayIndex < Cache.DayCount; ++DayIndex)
		{
			int Year = 0;
			int Month = 0;
			int Day = 0;
			FormatDateKey(Cache.DayDateKey[DayIndex], Year, Month, Day);

			SCString Entry;
			Entry.Format(";%04d-%02d-%02d (%d trades)", Year, Month, Day, Cache.DayTradeCount[DayIndex]);
			DayStrings += Entry;
		}

		sc.Input[INPUT_DAY_DROPDOWN].SetCustomInputStrings(DayStrings);
		sc.Input[INPUT_DAY_DROPDOWN].SetCustomInputIndex(PreviousIndex);
	}

	static void AppendTradeDropdownEntry(
		SCString& TradeStrings,
		TradeCache& Cache,
		const TradeRecord& Trade,
		const int TradeIndex,
		const int Year,
		const int Month,
		const int Day)
	{
		int Hour = 0;
		int Minute = 0;
		int Second = 0;
		int DummyYear = 0;
		int DummyMonth = 0;
		int DummyDay = 0;
		Trade.EntryET.GetDateTimeYMDHMS(DummyYear, DummyMonth, DummyDay, Hour, Minute, Second);

		const char* PnL = Trade.PnLText[0] != '\0' ? Trade.PnLText : "N/A";
		SCString Entry;
		Entry.Format(
			";%04d-%02d-%02d #%03d %02d:%02d | %s",
			Year, Month, Day,
			TradeIndex + 1,
			Hour, Minute,
			PnL);

		TradeStrings += Entry;

		if (Cache.TradeDropdownCount < MAX_TRADES)
		{
			++Cache.TradeDropdownCount;
			Cache.TradeDropdownMap[Cache.TradeDropdownCount] = TradeIndex;
		}
	}

	static void AppendTradesForDay(
		SCString& TradeStrings,
		TradeCache& Cache,
		const int DayIndex)
	{
		if (DayIndex < 0 || DayIndex >= Cache.DayCount)
			return;

		int Year = 0;
		int Month = 0;
		int Day = 0;
		FormatDateKey(Cache.DayDateKey[DayIndex], Year, Month, Day);

		for (int TradeIndex = Cache.TradeCount - 1; TradeIndex >= 0; --TradeIndex)
		{
			if (Cache.TradeDayIndex[TradeIndex] != DayIndex)
				continue;

			AppendTradeDropdownEntry(
				TradeStrings,
				Cache,
				Cache.Trades[TradeIndex],
				TradeIndex,
				Year,
				Month,
				Day);
		}
	}

	static int FindDayDropdownIndex(const TradeCache& Cache, const int DayDateKey)
	{
		if (DayDateKey <= 0)
			return 0;

		const int DayIndex = FindDayIndex(Cache, DayDateKey);
		if (DayIndex < 0)
			return 0;

		return DayIndex + 1;
	}

	static int FindTradeDropdownIndex(const TradeCache& Cache, const int SelectedTradeIndex)
	{
		if (SelectedTradeIndex < 0)
			return 0;

		for (int DropdownIndex = 1; DropdownIndex <= Cache.TradeDropdownCount; ++DropdownIndex)
		{
			if (Cache.TradeDropdownMap[DropdownIndex] == SelectedTradeIndex)
				return DropdownIndex;
		}

		return 0;
	}

	static int GetSelectedTradeIndexFromDropdown(
		const TradeCache& Cache,
		const int TradeDropdownIndex)
	{
		if (TradeDropdownIndex <= 0 || TradeDropdownIndex > Cache.TradeDropdownCount)
			return -1;

		return Cache.TradeDropdownMap[TradeDropdownIndex];
	}

	static void UpdateTradeDropdown(
		SCStudyInterfaceRef sc,
		TradeCache& Cache,
		const int DayDropdownIndex,
		const bool ResetTradeSelection,
		const int PreferredTradeIndex)
	{
		const int PreviousTradeIndex = ResetTradeSelection
			? -1
			: GetSelectedTradeIndexFromDropdown(
				Cache,
				sc.Input[INPUT_TRADE_DROPDOWN].GetIndex());

		const int FilterDayIndex = (DayDropdownIndex > 0) ? DayDropdownIndex - 1 : -1;
		SCString TradeStrings(FilterDayIndex >= 0 ? "All Trades This Day" : "All Trades");
		Cache.TradeDropdownCount = 0;
		memset(Cache.TradeDropdownMap, 0, sizeof(Cache.TradeDropdownMap));

		if (FilterDayIndex >= 0)
			AppendTradesForDay(TradeStrings, Cache, FilterDayIndex);
		else
		{
			for (int DayIndex = 0; DayIndex < Cache.DayCount; ++DayIndex)
				AppendTradesForDay(TradeStrings, Cache, DayIndex);
		}

		sc.Input[INPUT_TRADE_DROPDOWN].SetCustomInputStrings(TradeStrings);

		int RestoredTradeDropdownIndex = 0;
		if (!ResetTradeSelection)
		{
			const int TradeIndexToRestore = (PreferredTradeIndex >= 0)
				? PreferredTradeIndex
				: PreviousTradeIndex;

			if (TradeIndexToRestore >= 0)
				RestoredTradeDropdownIndex = FindTradeDropdownIndex(Cache, TradeIndexToRestore);
		}

		if (RestoredTradeDropdownIndex > Cache.TradeDropdownCount)
			RestoredTradeDropdownIndex = 0;

		sc.Input[INPUT_TRADE_DROPDOWN].SetCustomInputIndex(RestoredTradeDropdownIndex);
	}

	static void UpdateFilterDropdowns(
		SCStudyInterfaceRef sc,
		TradeCache& Cache,
		const int PreferredDayDropdownIndex,
		const int PreferredTradeIndex)
	{
		const int DayDropdownIndex = ClampDayDropdownIndex(Cache, PreferredDayDropdownIndex);
		UpdateDayDropdown(sc, Cache, DayDropdownIndex);
		UpdateTradeDropdown(
			sc,
			Cache,
			DayDropdownIndex,
			false,
			PreferredTradeIndex);
		Cache.CachedDayDropdownIndex = DayDropdownIndex;
	}

	static void ApplyLocalFilterSelectionFromInputs(
		SCStudyInterfaceRef sc,
		TradeCache& Cache,
		const int UserMode,
		const int UserDayDropdownIndex,
		const int UserTradeDropdownIndex)
	{
		sc.Input[INPUT_SELECTION_MODE].SetCustomInputIndex(UserMode);

		const int DayDropdownIndex = ClampDayDropdownIndex(Cache, UserDayDropdownIndex);
		const bool DayChanged = (DayDropdownIndex != Cache.CachedDayDropdownIndex);

		if (DayChanged)
			UpdateDayDropdown(sc, Cache, DayDropdownIndex);
		else
			sc.Input[INPUT_DAY_DROPDOWN].SetCustomInputIndex(DayDropdownIndex);

		UpdateTradeDropdown(
			sc,
			Cache,
			DayDropdownIndex,
			DayChanged,
			-1);

		int TradeDropdownIndex = 0;
		if (!DayChanged)
		{
			TradeDropdownIndex = UserTradeDropdownIndex;
			if (TradeDropdownIndex < 0 || TradeDropdownIndex > Cache.TradeDropdownCount)
				TradeDropdownIndex = 0;
		}

		sc.Input[INPUT_TRADE_DROPDOWN].SetCustomInputIndex(TradeDropdownIndex);
		Cache.CachedDayDropdownIndex = DayDropdownIndex;
	}

	static int FindTDVOverlayStudyID(SCStudyInterfaceRef sc, const int ChartNumber)
	{
		int StudyID = sc.GetStudyIDByName(ChartNumber, STUDY_DISPLAY_NAME, 0);
		if (StudyID != 0)
			return StudyID;

		StudyID = sc.GetStudyIDByName(ChartNumber, STUDY_DISPLAY_NAME, 1);
		if (StudyID != 0)
			return StudyID;

		for (int StudyIndex = 0; StudyIndex < 200; ++StudyIndex)
		{
			StudyID = sc.GetStudyIDByIndex(ChartNumber, StudyIndex);
			if (StudyID == 0)
				break;

			const SCString StudyName = sc.GetStudyNameFromChart(ChartNumber, StudyID);
			if (strstr(StudyName.GetChars(), "TDV Trade History") != nullptr)
				return StudyID;
		}

		return 0;
	}

	static void RecalculatePeerTDVCharts(SCStudyInterfaceRef sc)
	{
		const int HighestChartNumber = sc.GetHighestChartNumberUsedInChartBook();

		for (int ChartNumber = 1; ChartNumber <= HighestChartNumber; ++ChartNumber)
		{
			if (ChartNumber == sc.ChartNumber)
				continue;

			if (FindTDVOverlayStudyID(sc, ChartNumber) == 0)
				continue;

			const int ReplayStatus = sc.GetReplayStatusFromChart(ChartNumber);
			if (ReplayStatus != REPLAY_STOPPED)
				sc.RecalculateChartImmediate(ChartNumber);
			else
				sc.RecalculateChart(ChartNumber);
		}
	}

	static void PublishSharedFilterState(SCStudyInterfaceRef sc, const TradeCache& Cache)
	{
		const int DayDropdownIndex = sc.Input[INPUT_DAY_DROPDOWN].GetIndex();
		const int TradeDropdownIndex = sc.Input[INPUT_TRADE_DROPDOWN].GetIndex();

		g_SharedFilterState.SelectionMode = sc.Input[INPUT_SELECTION_MODE].GetIndex();
		g_SharedFilterState.DayDateKey = 0;
		if (DayDropdownIndex > 0 && DayDropdownIndex - 1 < Cache.DayCount)
			g_SharedFilterState.DayDateKey = Cache.DayDateKey[DayDropdownIndex - 1];

		g_SharedFilterState.SelectedTradeIndex = -1;
		if (TradeDropdownIndex > 0 && TradeDropdownIndex <= Cache.TradeDropdownCount)
			g_SharedFilterState.SelectedTradeIndex = Cache.TradeDropdownMap[TradeDropdownIndex];

		g_SharedFilterState.SourceChartNumber = sc.ChartNumber;
		g_SharedFilterState.SourceStudyID = sc.StudyGraphInstanceID;
		++g_SharedFilterState.Version;

		RecalculatePeerTDVCharts(sc);
	}

	static bool ApplySharedFilterState(
		SCStudyInterfaceRef sc,
		TradeCache& Cache,
		int& r_LastAppliedSyncVersion)
	{
		if (g_SharedFilterState.Version == 0
			|| g_SharedFilterState.Version == r_LastAppliedSyncVersion)
			return false;

		if (g_SharedFilterState.SourceChartNumber == sc.ChartNumber
			&& g_SharedFilterState.SourceStudyID == sc.StudyGraphInstanceID)
		{
			r_LastAppliedSyncVersion = g_SharedFilterState.Version;
			return false;
		}

		sc.Input[INPUT_SELECTION_MODE].SetCustomInputIndex(g_SharedFilterState.SelectionMode);

		const int PreviousDayDropdownIndex = sc.Input[INPUT_DAY_DROPDOWN].GetIndex();
		const int DayDropdownIndex = FindDayDropdownIndex(Cache, g_SharedFilterState.DayDateKey);
		sc.Input[INPUT_DAY_DROPDOWN].SetCustomInputIndex(DayDropdownIndex);

		const bool DayChanged = (DayDropdownIndex != PreviousDayDropdownIndex);
		if (DayChanged)
			UpdateDayDropdown(sc, Cache, DayDropdownIndex);
		else
			sc.Input[INPUT_DAY_DROPDOWN].SetCustomInputIndex(DayDropdownIndex);

		const int PreferredTradeIndex = DayChanged
			? -1
			: g_SharedFilterState.SelectedTradeIndex;

		UpdateTradeDropdown(
			sc,
			Cache,
			DayDropdownIndex,
			DayChanged,
			PreferredTradeIndex);
		Cache.CachedDayDropdownIndex = DayDropdownIndex;

		r_LastAppliedSyncVersion = g_SharedFilterState.Version;
		return true;
	}

	static int ComputeSelectionHash(SCStudyInterfaceRef sc)
	{
		int Hash = 17;
		Hash = Hash * 31 + sc.Input[INPUT_SELECTION_MODE].GetIndex();
		Hash = Hash * 31 + sc.Input[INPUT_DAY_DROPDOWN].GetIndex();
		Hash = Hash * 31 + sc.Input[INPUT_TRADE_DROPDOWN].GetIndex();
		return Hash;
	}

	static int ComputeStyleHash(SCStudyInterfaceRef sc)
	{
		int Hash = 17;
		Hash = Hash * 31 + sc.Input[INPUT_SHOW_EXIT_MARKERS].GetYesNo();
		Hash = Hash * 31 + sc.Input[INPUT_SHOW_POINTS_LABEL].GetYesNo();
		Hash = Hash * 31 + sc.Input[INPUT_WIN_RECT_COLOR].GetColor();
		Hash = Hash * 31 + sc.Input[INPUT_WIN_RECT_TRANSPARENCY].GetInt();
		Hash = Hash * 31 + sc.Input[INPUT_LOSS_RECT_COLOR].GetColor();
		Hash = Hash * 31 + sc.Input[INPUT_LOSS_RECT_TRANSPARENCY].GetInt();
		return Hash;
	}

	static bool ShouldShowTrade(
		SCStudyInterfaceRef sc,
		const TradeCache& Cache,
		const int TradeIndex,
		const bool ShowAllMode)
	{
		if (ShowAllMode)
			return true;

		if (TradeIndex < 0 || TradeIndex >= Cache.TradeCount)
			return false;

		const int DayIndex = Cache.TradeDayIndex[TradeIndex];
		if (DayIndex < 0)
			return false;

		const int DayDropdownIndex = sc.Input[INPUT_DAY_DROPDOWN].GetIndex();
		if (DayDropdownIndex > 0 && DayIndex != DayDropdownIndex - 1)
			return false;

		const int TradeDropdownIndex = sc.Input[INPUT_TRADE_DROPDOWN].GetIndex();
		if (TradeDropdownIndex > 0)
		{
			if (TradeDropdownIndex > Cache.TradeDropdownCount)
				return false;

			return Cache.TradeDropdownMap[TradeDropdownIndex] == TradeIndex;
		}

		return true;
	}

	static int GetReplayBarIndex(SCStudyInterfaceRef sc, const SCDateTime& ReplayDateTime)
	{
		int BarIndex = sc.GetNearestMatchForSCDateTime(sc.ChartNumber, ReplayDateTime);
		if (BarIndex < 0)
			BarIndex = sc.ArraySize - 1;

		return max(0, min(BarIndex, sc.ArraySize - 1));
	}

	static bool IsReplayEntryTimeReached(
		const SCDateTime& EntryChartTime,
		const SCDateTime& ReplayDateTime)
	{
		return ReplayDateTime >= EntryChartTime;
	}

	static bool IsReplayExitTimeReached(
		const SCDateTime& ExitChartTime,
		const SCDateTime& ReplayDateTime)
	{
		return ReplayDateTime >= ExitChartTime;
	}

	static int GetChartBarIndexForDateTime(
		SCStudyInterfaceRef sc,
		const SCDateTime& ChartDateTime)
	{
		int BarIndex = sc.GetNearestMatchForSCDateTimeExtended(sc.ChartNumber, ChartDateTime);
		if (BarIndex < 0)
			BarIndex = sc.GetNearestMatchForSCDateTime(sc.ChartNumber, ChartDateTime);

		return BarIndex;
	}

	static bool GetCandleRangeForBarSpan(
		SCStudyInterfaceRef sc,
		const int BeginBarIndex,
		const int EndBarIndex,
		float& OutLow,
		float& OutHigh)
	{
		if (sc.ArraySize <= 0)
			return false;

		const int StartBar = max(0, min(BeginBarIndex, EndBarIndex));
		const int EndBar = min(sc.ArraySize - 1, max(BeginBarIndex, EndBarIndex));
		if (StartBar < 0 || EndBar < StartBar)
			return false;

		OutLow = sc.Low[StartBar];
		OutHigh = sc.High[StartBar];

		for (int BarIndex = StartBar; BarIndex <= EndBar; ++BarIndex)
		{
			OutLow = min(OutLow, sc.Low[BarIndex]);
			OutHigh = max(OutHigh, sc.High[BarIndex]);
		}

		return true;
	}

	static float GetReplayRectangleEndValue(
		const float EntryPrice,
		const float ExitPrice,
		const SCDateTime& EntryChartTime,
		const SCDateTime& ExitChartTime,
		const SCDateTime& ReplayDateTime)
	{
		const double EntryDateTime = EntryChartTime.GetAsDouble();
		const double ExitDateTime = ExitChartTime.GetAsDouble();
		const double ReplayDateTimeValue = ReplayDateTime.GetAsDouble();

		if (ExitDateTime <= EntryDateTime)
			return ExitPrice;

		double Fraction = (ReplayDateTimeValue - EntryDateTime) / (ExitDateTime - EntryDateTime);
		if (Fraction < 0.0)
			Fraction = 0.0;
		else if (Fraction > 1.0)
			Fraction = 1.0;

		return static_cast<float>(EntryPrice + Fraction * (ExitPrice - EntryPrice));
	}

	static int CountVisibleTrades(SCStudyInterfaceRef sc, const TradeCache& Cache, const bool ShowAllMode)
	{
		int VisibleCount = 0;
		const bool ReplayActive = sc.IsReplayRunning() != 0;
		const SCDateTime ReplayDateTime = ReplayActive ? sc.GetCurrentDateTime() : SCDateTime(0, 0);

		for (int TradeIndex = 0; TradeIndex < Cache.TradeCount; ++TradeIndex)
		{
			if (!ShouldShowTrade(sc, Cache, TradeIndex, ShowAllMode))
				continue;

			if (ReplayActive)
			{
				const SCDateTime EntryChartTime = sc.ConvertDateTimeToChartTimeZone(
					Cache.Trades[TradeIndex].EntryET,
					TIMEZONE_NEW_YORK);

				if (!IsReplayEntryTimeReached(EntryChartTime, ReplayDateTime))
					continue;
			}

			++VisibleCount;
		}
		return VisibleCount;
	}

	static void ClearUnusedStudyInputs(SCStudyInterfaceRef sc)
	{
		for (int InputIndex = STUDY_INPUT_COUNT; InputIndex < 145; ++InputIndex)
		{
			sc.Input[InputIndex].Clear();
			sc.Input[InputIndex].Name = "";
		}
	}

	static void ApplyStudyInputDefinitions(SCStudyInterfaceRef sc)
	{
		int DisplayOrder = 1;

		sc.Input[INPUT_TRADE_EXPORT_PATH].Name = "Trade Export File Path";
		sc.Input[INPUT_TRADE_EXPORT_PATH].DisplayOrder = DisplayOrder++;

		sc.Input[INPUT_SHOW_EXIT_MARKERS].Name = "Show Exit Markers";
		sc.Input[INPUT_SHOW_EXIT_MARKERS].DisplayOrder = DisplayOrder++;

		sc.Input[INPUT_SHOW_POINTS_LABEL].Name = "Show Points Label";
		sc.Input[INPUT_SHOW_POINTS_LABEL].DisplayOrder = DisplayOrder++;

		sc.Input[INPUT_REFERENCE_CHART].Name = "1s Price Reference Chart Number";
		sc.Input[INPUT_REFERENCE_CHART].DisplayOrder = DisplayOrder++;
		sc.Input[INPUT_REFERENCE_CHART].SetDescription(
			"Chart # that provides 1-second close prices for markers and rectangles. "
			"0 = auto-detect the 1-second chart in this chartbook (same symbol preferred).");

		sc.Input[INPUT_WIN_RECT_COLOR].Name = "Winning Trade Rectangle Color";
		sc.Input[INPUT_WIN_RECT_COLOR].DisplayOrder = DisplayOrder++;

		sc.Input[INPUT_WIN_RECT_TRANSPARENCY].Name = "Winning Trade Rectangle Transparency (0-100)";
		sc.Input[INPUT_WIN_RECT_TRANSPARENCY].DisplayOrder = DisplayOrder++;

		sc.Input[INPUT_LOSS_RECT_COLOR].Name = "Losing Trade Rectangle Color";
		sc.Input[INPUT_LOSS_RECT_COLOR].DisplayOrder = DisplayOrder++;

		sc.Input[INPUT_LOSS_RECT_TRANSPARENCY].Name = "Losing Trade Rectangle Transparency (0-100)";
		sc.Input[INPUT_LOSS_RECT_TRANSPARENCY].DisplayOrder = DisplayOrder++;

		sc.Input[INPUT_SELECTION_MODE].Name = "Selection Mode";
		sc.Input[INPUT_SELECTION_MODE].DisplayOrder = DisplayOrder++;

		sc.Input[INPUT_DAY_DROPDOWN].Name = "Day Filter";
		sc.Input[INPUT_DAY_DROPDOWN].DisplayOrder = DisplayOrder++;
		sc.Input[INPUT_DAY_DROPDOWN].SetDescription(
			"All Days or one specific session date from the export file. Newest day first. Synced across charts.");

		sc.Input[INPUT_TRADE_DROPDOWN].Name = "Trade Filter";
		sc.Input[INPUT_TRADE_DROPDOWN].DisplayOrder = DisplayOrder++;
		sc.Input[INPUT_TRADE_DROPDOWN].SetDescription(
			"When a day is selected in Day Filter, lists only that day's trades. "
			"Newest trade first. Synced across charts.");

		sc.Input[INPUT_FILTER_SUMMARY].Name = "Trade List Summary";
		sc.Input[INPUT_FILTER_SUMMARY].DisplayOrder = DisplayOrder++;
		sc.Input[INPUT_FILTER_SUMMARY].SetDescription(
			"Auto-updated visible trade count from export file.");

		ClearUnusedStudyInputs(sc);
	}
}

/*==========================================================================
 * TDV Trade History Overlay
 *==========================================================================*/
SCSFExport scsf_TDVTradeHistoryOverlay(SCStudyInterfaceRef sc)
{
	if (sc.SetDefaults)
	{
		sc.GraphName = "TDV Trade History Overlay";
		sc.StudyDescription =
			"Draws Trading Dashboard trades from trade-export-ET.txt. "
			"Filter in Study Settings with Day Filter and Trade Filter dropdowns (newest first, synced across charts). "
			"Green rectangles = positive P&L, red rectangles = zero/negative P&L. "
			"Triangles: green up = long entry, red down = short entry. "
			"Marker and points prices use the 1-second chart close at entry/exit time. "
			"The 1-second chart is auto-detected within the chartbook and synced across charts. "
			"During chart replay, trades appear when replay time reaches entry.";

		sc.AutoLoop = 0;
		sc.FreeDLL = 1;
		sc.GraphRegion = 0;
		sc.ScaleRangeType = SCALE_SAMEASREGION;

		ApplyStudyInputDefinitions(sc);

		sc.Input[INPUT_TRADE_EXPORT_PATH].SetString(DEFAULT_TRADE_EXPORT_PATH);

		sc.Input[INPUT_SHOW_EXIT_MARKERS].SetYesNo(1);
		sc.Input[INPUT_SHOW_POINTS_LABEL].SetYesNo(1);
		sc.Input[INPUT_REFERENCE_CHART].SetInt(DEFAULT_REFERENCE_CHART);
		sc.Input[INPUT_REFERENCE_CHART].SetIntLimits(0, 500);

		sc.Input[INPUT_WIN_RECT_COLOR].SetColor(RGB(0, 170, 0));
		sc.Input[INPUT_WIN_RECT_TRANSPARENCY].SetInt(80);
		sc.Input[INPUT_WIN_RECT_TRANSPARENCY].SetIntLimits(0, 100);

		sc.Input[INPUT_LOSS_RECT_COLOR].SetColor(RGB(210, 0, 0));
		sc.Input[INPUT_LOSS_RECT_TRANSPARENCY].SetInt(80);
		sc.Input[INPUT_LOSS_RECT_TRANSPARENCY].SetIntLimits(0, 100);

		sc.Input[INPUT_SELECTION_MODE].SetCustomInputStrings("Show All Trades;Filter by Day and Trade");
		sc.Input[INPUT_SELECTION_MODE].SetCustomInputIndex(1);

		sc.Input[INPUT_DAY_DROPDOWN].SetCustomInputStrings("All Days");
		sc.Input[INPUT_DAY_DROPDOWN].SetCustomInputIndex(0);

		sc.Input[INPUT_TRADE_DROPDOWN].SetCustomInputStrings("All Trades");
		sc.Input[INPUT_TRADE_DROPDOWN].SetCustomInputIndex(0);

		sc.Input[INPUT_FILTER_SUMMARY].SetString("Recalculate chart to load trades.");

		return;
	}

	const int BaseLineNumber = sc.StudyGraphInstanceID * 10000;
	int& r_LastDrawnTradeCount = sc.GetPersistentInt(1);
	int& r_UpdateCounter = sc.GetPersistentInt(2);
	int& r_LoggedReadError = sc.GetPersistentInt(3);
	int& r_LastSelectionHash = sc.GetPersistentInt(4);
	int& r_SettingsVersion = sc.GetPersistentInt(5);
	int& r_LastAppliedSyncVersion = sc.GetPersistentInt(6);
	int& r_LastStyleHash = sc.GetPersistentInt(7);

	SCDateTime& r_LastReplayDateTime = sc.GetPersistentSCDateTime(1);

	TradeCache*& r_Cache = reinterpret_cast<TradeCache*&>(sc.GetPersistentPointer(1));

	if (sc.LastCallToFunction)
	{
		DeleteTradeDrawings(sc, BaseLineNumber, 0, r_LastDrawnTradeCount);
		r_LastDrawnTradeCount = 0;

		if (r_Cache != nullptr)
		{
			delete r_Cache;
			r_Cache = nullptr;
		}
		return;
	}

	if (r_Cache == nullptr)
		r_Cache = new TradeCache();

	const bool SettingsMigrationNeeded = (r_SettingsVersion != STUDY_SETTINGS_VERSION);
	if (SettingsMigrationNeeded || sc.IsFullRecalculation)
	{
		ApplyStudyInputDefinitions(sc);

		if (SettingsMigrationNeeded)
		{
			SCString ExportPath = sc.Input[INPUT_TRADE_EXPORT_PATH].GetString();
			if (ExportPath.GetLength() == 0
				|| IsLegacyTradeExportPath(ExportPath))
			{
				sc.Input[INPUT_TRADE_EXPORT_PATH].SetString(GetDefaultTradeExportPath());
			}

			sc.Input[INPUT_DAY_DROPDOWN].SetCustomInputStrings("All Days");
			sc.Input[INPUT_TRADE_DROPDOWN].SetCustomInputStrings("All Trades");
			sc.Input[INPUT_DAY_DROPDOWN].SetCustomInputIndex(0);
			sc.Input[INPUT_TRADE_DROPDOWN].SetCustomInputIndex(0);
			sc.Input[INPUT_REFERENCE_CHART].SetInt(DEFAULT_REFERENCE_CHART);
			sc.Input[INPUT_FILTER_SUMMARY].SetString("Recalculate chart to load trades.");
			r_SettingsVersion = STUDY_SETTINGS_VERSION;
			r_LastSelectionHash = 0;
			r_LastStyleHash = 0;

			if (r_Cache->TradeCount > 0)
			{
				r_Cache->CachedDayDropdownIndex = -1;
				UpdateFilterDropdowns(sc, *r_Cache, 0, -1);
			}
		}
	}

	if (sc.ArraySize < 2)
		return;

	const bool ReplayActive = sc.IsReplayRunning() != 0;
	sc.UpdateAlways = ReplayActive ? 1 : 0;

	SCDateTime ReplayDateTime(0, 0);
	bool ReplayTimeAdvanced = false;

	if (ReplayActive)
	{
		ReplayDateTime = sc.GetCurrentDateTime();
		ReplayTimeAdvanced = (ReplayDateTime != r_LastReplayDateTime);
		r_LastReplayDateTime = ReplayDateTime;
	}
	else
	{
		r_LastReplayDateTime = SCDateTime(0, 0);
	}

	++r_UpdateCounter;
	const bool PeriodicFileCheck = (r_UpdateCounter % 50 == 0);
	const bool ShouldReadFile =
		sc.IsFullRecalculation || PeriodicFileCheck || r_Cache->TradeCount == 0;

	const int StyleHash = ComputeStyleHash(sc);
	const bool StyleChanged = (StyleHash != r_LastStyleHash);
	if (StyleChanged)
		r_LastStyleHash = StyleHash;

	SCString FileText;
	SCString FilePath;
	bool ExportPathUpdated = false;
	bool FileDataRefreshed = false;

	if (ShouldReadFile)
	{
		FilePath = ResolveTradeExportPath(sc, FileText, ExportPathUpdated);
		if (ExportPathUpdated)
			sc.Input[INPUT_TRADE_EXPORT_PATH].SetString(FilePath);

		if (FileText.GetLength() == 0)
		{
			if (r_LoggedReadError == 0)
			{
				SCString Msg("TDV Trade History Overlay: cannot read ");
				Msg += FilePath;
				sc.AddMessageToLog(Msg, 1);
				r_LoggedReadError = 1;
			}
			return;
		}

		r_LoggedReadError = 0;

		const int FileSize = FileText.GetLength();
		const bool FileChanged = (FileSize != r_Cache->FileSize);

		if (FileChanged || sc.IsFullRecalculation || r_Cache->TradeCount == 0)
		{
			const int SavedDayDropdownIndex = sc.Input[INPUT_DAY_DROPDOWN].GetIndex();
			const int SavedTradeIndex = GetSelectedTradeIndexFromDropdown(
				*r_Cache,
				sc.Input[INPUT_TRADE_DROPDOWN].GetIndex());

			r_Cache->FileSize = FileSize;
			r_Cache->TradeCount = ParseTradesFromExport(
				FileText.GetChars(),
				r_Cache->Trades,
				MAX_TRADES);

			BuildDayGroups(*r_Cache);
			UpdateFilterDropdowns(
				sc,
				*r_Cache,
				SavedDayDropdownIndex,
				SavedTradeIndex);
			ResetSharedMarkerPrices();
			ResetSharedReferenceChart();
			FileDataRefreshed = true;
		}
	}

	if (r_Cache->TradeCount <= 0)
		return;

	if (r_LastSelectionHash == 0)
		r_LastSelectionHash = ComputeSelectionHash(sc);

	const int UserMode = sc.Input[INPUT_SELECTION_MODE].GetIndex();
	const int UserDay = sc.Input[INPUT_DAY_DROPDOWN].GetIndex();
	const int UserTrade = sc.Input[INPUT_TRADE_DROPDOWN].GetIndex();
	const int UserSelectionHash = ComputeSelectionHash(sc);
	const bool UserChangedSinceLastRun = (UserSelectionHash != r_LastSelectionHash);

	bool SyncApplied = false;
	if (r_Cache->TradeCount > 0)
		SyncApplied = ApplySharedFilterState(sc, *r_Cache, r_LastAppliedSyncVersion);

	if (UserChangedSinceLastRun)
	{
		ApplyLocalFilterSelectionFromInputs(
			sc,
			*r_Cache,
			UserMode,
			UserDay,
			UserTrade);
		r_LastSelectionHash = ComputeSelectionHash(sc);
		PublishSharedFilterState(sc, *r_Cache);
		r_LastAppliedSyncVersion = g_SharedFilterState.Version;
	}
	else if (SyncApplied)
		r_LastSelectionHash = ComputeSelectionHash(sc);

	if (!ShouldReadFile && !FileDataRefreshed && !UserChangedSinceLastRun && !SyncApplied
		&& !StyleChanged && !sc.IsFullRecalculation && !ReplayTimeAdvanced)
		return;

	const bool ShowAllMode = (sc.Input[INPUT_SELECTION_MODE].GetIndex() == MODE_SHOW_ALL);
	const int VisibleCount = CountVisibleTrades(sc, *r_Cache, ShowAllMode);

	OneSecondPriceLookup PriceLookup;
	const bool HasOneSecondReference = PrepareOneSecondPriceLookup(sc, PriceLookup);
	if (!HasOneSecondReference)
	{
		PriceLookup.ReferenceChartNumber = sc.ChartNumber;
		PriceLookup.UsesLocalArrays = true;
	}

	const int PriceChartNumber = PriceLookup.ReferenceChartNumber;
	const int PreferredChartNumber = sc.Input[INPUT_REFERENCE_CHART].GetInt();

	SCString Summary;
	SCString PriceSourceText;
	if (HasOneSecondReference)
	{
		if (PreferredChartNumber > 0)
		{
			PriceSourceText.Format(
				" | Prices from chart #%d (1s)",
				PriceChartNumber);
		}
		else
		{
			PriceSourceText.Format(
				" | Prices from chart #%d (1s, auto)",
				PriceChartNumber);
		}
	}
	else
	{
		PriceSourceText = " | No 1s chart in chartbook: local prices";
	}

	Summary.Format(
		"Showing %d of %d trades | %d days | %s%s%s",
		VisibleCount,
		r_Cache->TradeCount,
		r_Cache->DayCount,
		ShowAllMode ? "Show All" : "Day + Trade Filter (synced)",
		ReplayActive ? " | Replay: synced filters, trades at entry time" : "",
		PriceSourceText.GetChars());
	sc.Input[INPUT_FILTER_SUMMARY].SetString(Summary);

	const int TradeCount = r_Cache->TradeCount;
	if (r_LastDrawnTradeCount > TradeCount)
		DeleteTradeDrawings(sc, BaseLineNumber, TradeCount, r_LastDrawnTradeCount);

	const bool ShowExitMarkers = sc.Input[INPUT_SHOW_EXIT_MARKERS].GetYesNo() != 0;
	const bool ShowPointsLabel = sc.Input[INPUT_SHOW_POINTS_LABEL].GetYesNo() != 0;
	const COLORREF WinRectColor = sc.Input[INPUT_WIN_RECT_COLOR].GetColor();
	const COLORREF LossRectColor = sc.Input[INPUT_LOSS_RECT_COLOR].GetColor();
	const int WinRectTransparency = sc.Input[INPUT_WIN_RECT_TRANSPARENCY].GetInt();
	const int LossRectTransparency = sc.Input[INPUT_LOSS_RECT_TRANSPARENCY].GetInt();

	for (int TradeIndex = 0; TradeIndex < TradeCount; ++TradeIndex)
	{
		const int LineOffset = TradeIndex * DRAWINGS_PER_TRADE;

		if (!ShouldShowTrade(sc, *r_Cache, TradeIndex, ShowAllMode))
		{
			for (int DrawingOffset = 0; DrawingOffset < DRAWINGS_PER_TRADE; ++DrawingOffset)
			{
				sc.DeleteACSChartDrawing(
					sc.ChartNumber,
					TOOL_DELETE_CHARTDRAWING,
					BaseLineNumber + LineOffset + DrawingOffset);
			}
			continue;
		}

		const TradeRecord& Trade = r_Cache->Trades[TradeIndex];

		const SCDateTime EntryChartTime =
			sc.ConvertDateTimeToChartTimeZone(Trade.EntryET, TIMEZONE_NEW_YORK);
		const SCDateTime ExitChartTime =
			sc.ConvertDateTimeToChartTimeZone(Trade.ExitET, TIMEZONE_NEW_YORK);

		if (ReplayActive && !IsReplayEntryTimeReached(EntryChartTime, ReplayDateTime))
		{
			for (int DrawingOffset = 0; DrawingOffset < DRAWINGS_PER_TRADE; ++DrawingOffset)
			{
				sc.DeleteACSChartDrawing(
					sc.ChartNumber,
					TOOL_DELETE_CHARTDRAWING,
					BaseLineNumber + LineOffset + DrawingOffset);
			}
			continue;
		}

		int EntryBarIndex = GetReferenceBarIndexForDateTime(sc, PriceChartNumber, EntryChartTime);
		int ExitBarIndex = GetReferenceBarIndexForDateTime(sc, PriceChartNumber, ExitChartTime);

		if (EntryBarIndex < 0 || ExitBarIndex < 0)
		{
			for (int DrawingOffset = 0; DrawingOffset < DRAWINGS_PER_TRADE; ++DrawingOffset)
			{
				sc.DeleteACSChartDrawing(
					sc.ChartNumber,
					TOOL_DELETE_CHARTDRAWING,
					BaseLineNumber + LineOffset + DrawingOffset);
			}
			continue;
		}

		const int PriceArraySize = GetReferenceArraySize(sc, PriceLookup);

		EntryBarIndex = max(EntryBarIndex, 0);
		ExitBarIndex = min(ExitBarIndex, PriceArraySize - 1);

		const float TickSize = sc.TickSize > 0.0f ? sc.TickSize : 0.25f;
		float EntryMarkerValue = 0.0f;
		float ExitMarkerValue = 0.0f;

		const bool IsReferenceOneSecondChart =
			(PriceChartNumber == sc.ChartNumber && IsOneSecondIntradayChart(sc, sc.ChartNumber));

		if (!IsReferenceOneSecondChart
			&& TryGetSharedMarkerPrices(TradeIndex, EntryMarkerValue, ExitMarkerValue))
		{
			// Use marker prices published by the 1-second reference chart.
		}
		else
		{
			ResolveTradeMarkerPrices(
				sc,
				PriceLookup,
				EntryBarIndex,
				ExitBarIndex,
				EntryMarkerValue,
				ExitMarkerValue);

			if (IsReferenceOneSecondChart)
			{
				PublishSharedMarkerPrices(
					sc,
					TradeIndex,
					EntryMarkerValue,
					ExitMarkerValue);
			}
		}

		if (EntryMarkerValue == 0.0f && ExitMarkerValue == 0.0f)
		{
			for (int DrawingOffset = 0; DrawingOffset < DRAWINGS_PER_TRADE; ++DrawingOffset)
			{
				sc.DeleteACSChartDrawing(
					sc.ChartNumber,
					TOOL_DELETE_CHARTDRAWING,
					BaseLineNumber + LineOffset + DrawingOffset);
			}
			continue;
		}

		SCDateTime RectangleEndTime = ExitChartTime;
		float PriceRectBeginValue = EntryMarkerValue;
		float PriceRectEndValue = ExitMarkerValue;
		bool DrawExitMarkerNow = ShowExitMarkers;
		bool DrawCandleWrapRect = false;
		float CandleWrapLow = 0.0f;
		float CandleWrapHigh = 0.0f;

		if (ReplayActive)
		{
			int ChartEntryBarIndex = GetChartBarIndexForDateTime(sc, EntryChartTime);
			int ChartEndBarIndex = ChartEntryBarIndex;

			if (IsReplayExitTimeReached(ExitChartTime, ReplayDateTime))
				ChartEndBarIndex = GetChartBarIndexForDateTime(sc, ExitChartTime);
			else
			{
				RectangleEndTime = ReplayDateTime;
				ChartEndBarIndex = GetReplayBarIndex(sc, ReplayDateTime);
				PriceRectEndValue = GetReplayRectangleEndValue(
					EntryMarkerValue,
					ExitMarkerValue,
					EntryChartTime,
					ExitChartTime,
					ReplayDateTime);
				DrawExitMarkerNow = false;

				ChartEntryBarIndex = max(ChartEntryBarIndex, 0);
				ChartEndBarIndex = min(ChartEndBarIndex, sc.ArraySize - 1);
				ChartEndBarIndex = max(ChartEndBarIndex, ChartEntryBarIndex);

				DrawCandleWrapRect = GetCandleRangeForBarSpan(
					sc,
					ChartEntryBarIndex,
					ChartEndBarIndex,
					CandleWrapLow,
					CandleWrapHigh);
			}
		}

		EnsureMinimumRectangleHeight(
			Trade.IsLong,
			TickSize,
			PriceRectBeginValue,
			PriceRectEndValue);

		const bool IsWinner = IsWinningTrade(Trade);
		s_UseTool Tool;
		Tool.ChartNumber = sc.ChartNumber;
		Tool.Region = 0;
		Tool.AddMethod = UTAM_ADD_OR_ADJUST;
		Tool.DrawUnderneathMainGraph = 1;

		if (DrawCandleWrapRect)
		{
			const int WrapTransparency = min(
				100,
				(IsWinner ? WinRectTransparency : LossRectTransparency) + 25);

			Tool.Clear();
			Tool.LineNumber = BaseLineNumber + LineOffset + DRAWING_RECT_CANDLE_WRAP;
			Tool.DrawingType = DRAWING_RECTANGLEHIGHLIGHT;
			Tool.BeginDateTime = EntryChartTime;
			Tool.EndDateTime = RectangleEndTime;
			Tool.TransparencyLevel = WrapTransparency;
			Tool.LineWidth = 1;
			Tool.BeginValue = CandleWrapLow;
			Tool.EndValue = CandleWrapHigh;
			Tool.Color = IsWinner ? WinRectColor : LossRectColor;
			Tool.SecondaryColor = IsWinner ? WinRectColor : LossRectColor;
			sc.UseTool(Tool);
		}
		else
		{
			sc.DeleteACSChartDrawing(
				sc.ChartNumber,
				TOOL_DELETE_CHARTDRAWING,
				BaseLineNumber + LineOffset + DRAWING_RECT_CANDLE_WRAP);
		}

		Tool.Clear();
		Tool.LineNumber = BaseLineNumber + LineOffset + DRAWING_RECT_PRICE;
		Tool.DrawingType = DRAWING_RECTANGLEHIGHLIGHT;
		Tool.BeginDateTime = EntryChartTime;
		Tool.EndDateTime = RectangleEndTime;
		Tool.TransparencyLevel = IsWinner ? WinRectTransparency : LossRectTransparency;
		Tool.LineWidth = 1;
		Tool.BeginValue = PriceRectBeginValue;
		Tool.EndValue = PriceRectEndValue;
		Tool.Color = IsWinner ? WinRectColor : LossRectColor;
		Tool.SecondaryColor = IsWinner ? WinRectColor : LossRectColor;

		sc.UseTool(Tool);

		Tool.Clear();
		Tool.ChartNumber = sc.ChartNumber;
		Tool.Region = 0;
		Tool.AddMethod = UTAM_ADD_OR_ADJUST;
		Tool.LineNumber = BaseLineNumber + LineOffset + DRAWING_ENTRY_MARKER;
		Tool.DrawingType = DRAWING_MARKER;
		Tool.BeginDateTime = EntryChartTime;
		Tool.BeginValue = EntryMarkerValue;
		Tool.MarkerType = Trade.IsLong ? MARKER_TRIANGLEUP : MARKER_TRIANGLEDOWN;
		Tool.MarkerSize = 7;
		Tool.LineWidth = 3;
		Tool.Color = Trade.IsLong ? RGB(0, 255, 0) : RGB(255, 0, 0);
		sc.UseTool(Tool);

		if (DrawExitMarkerNow)
		{
			Tool.Clear();
			Tool.ChartNumber = sc.ChartNumber;
			Tool.Region = 0;
			Tool.AddMethod = UTAM_ADD_OR_ADJUST;
			Tool.LineNumber = BaseLineNumber + LineOffset + DRAWING_EXIT_MARKER;
			Tool.DrawingType = DRAWING_MARKER;
			Tool.BeginDateTime = ExitChartTime;
			Tool.BeginValue = ExitMarkerValue;
			Tool.MarkerType = Trade.IsLong ? MARKER_TRIANGLEDOWN : MARKER_TRIANGLEUP;
			Tool.MarkerSize = 5;
			Tool.LineWidth = 2;
			Tool.Color = Trade.IsLong ? RGB(255, 0, 0) : RGB(0, 255, 0);
			sc.UseTool(Tool);
		}
		else
		{
			sc.DeleteACSChartDrawing(
				sc.ChartNumber,
				TOOL_DELETE_CHARTDRAWING,
				BaseLineNumber + LineOffset + DRAWING_EXIT_MARKER);
		}

		if (ShowPointsLabel)
		{
			const float TradePoints = CalculateTradePoints(
				Trade,
				EntryMarkerValue,
				ExitMarkerValue);
			const SCString PointsText = FormatTradePointsText(sc, TradePoints);

			Tool.Clear();
			Tool.ChartNumber = sc.ChartNumber;
			Tool.Region = 0;
			Tool.AddMethod = UTAM_ADD_OR_ADJUST;
			Tool.DrawUnderneathMainGraph = 0;
			Tool.LineNumber = BaseLineNumber + LineOffset + DRAWING_POINTS_LABEL;
			Tool.DrawingType = DRAWING_TEXT;
			Tool.BeginDateTime = GetTradeLabelDateTime(EntryChartTime, RectangleEndTime);
			Tool.BeginValue = GetTradeLabelValue(
				Trade.IsLong,
				EntryMarkerValue,
				ReplayActive ? PriceRectEndValue : ExitMarkerValue,
				TickSize);
			Tool.Text = PointsText;
			Tool.Color = IsWinner ? WinRectColor : LossRectColor;
			Tool.FontSize = 8;
			Tool.FontBold = 1;
			Tool.TextAlignment = Trade.IsLong
				? (DT_LEFT | DT_BOTTOM)
				: (DT_LEFT | DT_TOP);
			sc.UseTool(Tool);
		}
		else
		{
			sc.DeleteACSChartDrawing(
				sc.ChartNumber,
				TOOL_DELETE_CHARTDRAWING,
				BaseLineNumber + LineOffset + DRAWING_POINTS_LABEL);
		}
	}

	r_LastDrawnTradeCount = TradeCount;

	if (HasOneSecondReference && PriceChartNumber == sc.ChartNumber)
		FinalizeSharedMarkerPrices(sc);
}
