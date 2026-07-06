// The top of every source code file must include this line
#include "sierrachart.h"

#include <string>
#include <cstdint>
#include <cstdio>

// For reference:
// https://www.sierrachart.com/index.php?page=doc/AdvancedCustomStudyInterfaceAndLanguage.php

SCDLLName("NQ Live Data Exporter")

/*============================================================================
 * NQDataExporter
 *
 * Exports live OHLCV bar data from any Sierra Chart graph to two JSON files
 * inside the SC Data folder so a local web server can feed them to a
 * TradingView Lightweight Charts page.
 *
 * Files written (default base name "NQ_5s"):
 *   <DataFolder>\NQ_5s_history.json   – JSON array of completed bars
 *   <DataFolder>\NQ_5s_live.json      – JSON object for the forming bar
 *
 * Setup:
 *   1. Open (or create) a 5-second chart for NQM26_FUT_CME.
 *   2. Add this study via Analysis > Add Custom Study DLL.
 *   3. Build the DLL once via Analysis > Build Custom Studies DLL.
 *   4. Double-click the "NQ Live Chart" desktop shortcut, or run:
 *        cd "C:\Asus Trading\Tradingview local" && npm run app
 *   5. The chart opens in the standalone desktop app (port 3737).
 *
 * Bar layout used from scconstants.h:
 *   SC_OPEN=0  SC_HIGH=1  SC_LOW=2  SC_LAST=3  SC_VOLUME=4
 *
 * DateTime conversion:
 *   SCDateTime is a fractional-day count since 1899-12-30 (OLE Automation).
 *   SCDATETIME_UNIX_EPOCH = 25569.0 is defined in scdatetime.h and represents
 *   the offset between the SC epoch and the Unix epoch (1970-01-01).
 *   Unix timestamp (s) = (SCDateTime - 25569.0) * 86400.0
 *============================================================================*/
SCSFExport scsf_NQDataExporter(SCStudyInterfaceRef sc)
{
	SCInputRef Input_MaxBars  = sc.Input[0];
	SCInputRef Input_BaseName = sc.Input[1];

	if (sc.SetDefaults)
	{
		sc.GraphName        = "NQ Live Data Exporter";
		sc.StudyDescription =
			"Writes completed bars to <BaseName>_history.json and the "
			"forming bar to <BaseName>_live.json in the SC Data folder. "
			"Launch the Tradingview local app from the desktop shortcut (port 3737).";

		sc.AutoLoop  = 0;   // manual – we decide when to process
		sc.FreeDLL   = 1;   // set to 0 after DLL is stable for production

		// No visual output needed – the study just does file I/O
		sc.ScaleRangeType = SCALE_INDEPENDENT;

		Input_MaxBars.Name = "Max History Bars to Export";
		Input_MaxBars.SetInt(2000);
		Input_MaxBars.SetIntLimits(100, 50000);

		Input_BaseName.Name = "Output File Base Name";
		Input_BaseName.SetString("NQ_5s");

		return;
	}

	// Clean up persistent objects when study is removed
	if (sc.LastCallToFunction)
		return;

	const int TotalBars = sc.ArraySize;
	if (TotalBars < 1)
		return;

	// Persistent state: track the last ArraySize seen so we know when a
	// new bar has been completed.
	int& r_PrevArraySize = sc.GetPersistentInt(1);

	const bool NewBarCompleted = (sc.ArraySize != r_PrevArraySize);
	r_PrevArraySize = sc.ArraySize;

	// -----------------------------------------------------------------------
	// Paths
	// -----------------------------------------------------------------------
	const SCString DataFolder = sc.DataFilesFolder();
	const SCString BaseName   = Input_BaseName.GetString();
	SCString HistoryPath      = DataFolder; HistoryPath += BaseName; HistoryPath += "_history.json";
	SCString LivePath         = DataFolder; LivePath    += BaseName; LivePath    += "_live.json";

	// -----------------------------------------------------------------------
	// Inline helper: SCDateTime → Unix timestamp (seconds)
	// SCDateTime::ToUNIXTime() returns time_t (seconds since 1970-01-01 UTC).
	// -----------------------------------------------------------------------
	#define SC_TO_UNIX_TS(dt) ( (long long)((dt).ToUNIXTime()) )

	// -----------------------------------------------------------------------
	// 1. Write history.json on full recalc or whenever a bar completes.
	//    Completed bars = indices 0 … (ArraySize - 2).
	//    The forming bar (index ArraySize-1) is excluded and goes to live.json.
	// -----------------------------------------------------------------------
	if (sc.IsFullRecalculation || NewBarCompleted)
	{
		const int LastCompleted = TotalBars - 2;

		if (LastCompleted >= 0)
		{
			const int MaxBars = Input_MaxBars.GetInt();
			const int FirstBar = (LastCompleted - MaxBars + 1 > 0)
			                   ? (LastCompleted - MaxBars + 1) : 0;

			// Reserve roughly 120 bytes per bar
			std::string json;
			json.reserve((size_t)(LastCompleted - FirstBar + 1) * 120 + 8);
			json += "[";

			char buf[160];
			for (int i = FirstBar; i <= LastCompleted; ++i)
			{
				if (i > FirstBar)
					json += ",";

				snprintf(buf, sizeof(buf),
					"{\"t\":%lld,\"o\":%.2f,\"h\":%.2f,\"l\":%.2f,\"c\":%.2f,\"v\":%.0f}",
					SC_TO_UNIX_TS(sc.BaseDateTimeIn[i]),
					(double)sc.BaseData[SC_OPEN][i],
					(double)sc.BaseData[SC_HIGH][i],
					(double)sc.BaseData[SC_LOW][i],
					(double)sc.BaseData[SC_LAST][i],
					(double)sc.BaseData[SC_VOLUME][i]);

				json += buf;
			}
			json += "]";

			int FileHandle = 0;
			if (sc.OpenFile(HistoryPath,
			                n_ACSIL::FILE_MODE_CREATE_AND_OPEN_FOR_READ_WRITE,
			                FileHandle) > 0)
			{
				unsigned int BytesWritten = 0;
				sc.WriteFile(FileHandle,
				             json.c_str(),
				             (int)json.size(),
				             &BytesWritten);
				sc.CloseFile(FileHandle);
			}
			else
			{
				SCString Msg("NQDataExporter: cannot write to ");
				Msg += HistoryPath;
				sc.AddMessageToLog(Msg, 1);
			}
		}
	}

	// -----------------------------------------------------------------------
	// 2. Always write live.json with the current forming bar (last bar).
	//    Also includes symbol and bar-period info so the UI can display them.
	// -----------------------------------------------------------------------
	{
		const int LiveIdx = TotalBars - 1;

		// Retrieve bar-period so the UI can label the resolution
		n_ACSIL::s_BarPeriod BarPeriod;
		sc.GetBarPeriodParameters(BarPeriod);
		int BarPeriodSeconds = BarPeriod.IntradayChartBarPeriodParameter1;  // seconds for time-based bars

		char liveBuf[512];
		snprintf(liveBuf, sizeof(liveBuf),
			"{\"t\":%lld"
			",\"o\":%.2f,\"h\":%.2f,\"l\":%.2f,\"c\":%.2f,\"v\":%.0f"
			",\"sym\":\"%s\",\"res\":%d}",
			SC_TO_UNIX_TS(sc.BaseDateTimeIn[LiveIdx]),
			(double)sc.BaseData[SC_OPEN][LiveIdx],
			(double)sc.BaseData[SC_HIGH][LiveIdx],
			(double)sc.BaseData[SC_LOW][LiveIdx],
			(double)sc.BaseData[SC_LAST][LiveIdx],
			(double)sc.BaseData[SC_VOLUME][LiveIdx],
			sc.Symbol.GetChars(),
			BarPeriodSeconds);

		int FileHandle = 0;
		if (sc.OpenFile(LivePath,
		                n_ACSIL::FILE_MODE_CREATE_AND_OPEN_FOR_READ_WRITE,
		                FileHandle) > 0)
		{
			unsigned int BytesWritten = 0;
			sc.WriteFile(FileHandle,
			             liveBuf,
			             (int)strlen(liveBuf),
			             &BytesWritten);
			sc.CloseFile(FileHandle);
		}
	}

	#undef SC_TO_UNIX_TS
}
