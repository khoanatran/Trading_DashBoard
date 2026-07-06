#include "sierrachart.h"

#include <cstdint>
#include <cstdio>
#include <string>

SCDLLName("SC Memory Reporter")

namespace
{
	constexpr int kMaxStudyProfiles = 32;
	constexpr size_t kVapLevelBytes = 48;
	constexpr size_t kDepthLevelBytes = 40;
	constexpr size_t kTimeAndSalesRecordBytes = 96;
	constexpr int kMaxDepthBarsToScan = 4000;

	static int64_t EstimateFloatArrayBytes(SCFloatArrayInRef Array)
	{
		const int Size = Array.GetArraySize();
		if (Size <= 0)
			return 0;
		return static_cast<int64_t>(Size) * static_cast<int64_t>(sizeof(float));
	}

	static int64_t EstimateGraphDataBytes(const SCGraphData& Data)
	{
		int64_t Total = 0;
		for (int Index = 0; Index < SC_SUBGRAPHS_AVAILABLE; ++Index)
			Total += EstimateFloatArrayBytes(Data[Index]);
		return Total;
	}

	static int64_t EstimateVapBytes(c_VAPContainer* pVAP)
	{
		if (pVAP == nullptr)
			return 0;

		const unsigned int BarCount = pVAP->GetNumberOfBars();
		uint64_t LevelCount = 0;
		for (unsigned int BarIndex = 0; BarIndex < BarCount; ++BarIndex)
			LevelCount += pVAP->GetSizeAtBarIndex(BarIndex);

		return static_cast<int64_t>(LevelCount) * static_cast<int64_t>(kVapLevelBytes);
	}

	static int64_t EstimateOhlcBytes(const SCGraphData& BaseData)
	{
		int64_t Total = 0;
		for (int Index = SC_OPEN; Index <= SC_LAST; ++Index)
			Total += EstimateFloatArrayBytes(BaseData[Index]);
		return Total;
	}

	static int64_t EstimateMarketDepthBytes(SCStudyInterfaceRef sc, const int ChartNumber)
	{
		c_ACSILDepthBars* pDepth = sc.GetMarketDepthBarsFromChart(ChartNumber);
		if (pDepth == nullptr)
			return 0;

		const int NumBars = pDepth->NumBars();
		if (NumBars <= 0)
			return 0;

		const int Step = max(1, NumBars / kMaxDepthBarsToScan);
		uint64_t LevelCount = 0;
		uint64_t SampledBars = 0;

		for (int BarIndex = 0; BarIndex < NumBars; BarIndex += Step)
		{
			if (!pDepth->DepthDataExistsAt(BarIndex))
				continue;

			++SampledBars;
			const int Low = pDepth->GetBarLowestPriceTickIndex(BarIndex);
			const int High = pDepth->GetBarHighestPriceTickIndex(BarIndex);
			if (High >= Low)
				LevelCount += static_cast<uint64_t>(High - Low + 1);
		}

		if (SampledBars == 0)
			return 0;

		const uint64_t ExtrapolatedLevels = (LevelCount * static_cast<uint64_t>(NumBars))
			/ max(SampledBars, static_cast<uint64_t>(1));

		return static_cast<int64_t>(ExtrapolatedLevels) * static_cast<int64_t>(kDepthLevelBytes);
	}

	static int64_t EstimateTimeAndSalesBytes(SCStudyInterfaceRef sc)
	{
		c_SCTimeAndSalesArray TimeAndSales;
		sc.GetTimeAndSales(TimeAndSales);
		return static_cast<int64_t>(TimeAndSales.Size()) * static_cast<int64_t>(kTimeAndSalesRecordBytes);
	}

	static int64_t EstimateProfileBytes(SCStudyInterfaceRef sc, const int StudyID)
	{
		int64_t Total = 0;
		for (int ProfileIndex = 0; ProfileIndex < kMaxStudyProfiles; ++ProfileIndex)
		{
			const int LevelCount = sc.GetNumPriceLevelsForStudyProfile(StudyID, ProfileIndex);
			if (LevelCount <= 0)
				continue;
			Total += static_cast<int64_t>(LevelCount) * static_cast<int64_t>(kVapLevelBytes);
		}
		return Total;
	}

	static void AppendEscapedJsonString(std::string& Out, const char* Value)
	{
		Out.push_back('"');
		if (Value == nullptr)
		{
			Out.push_back('"');
			return;
		}

		for (const char* Cursor = Value; *Cursor != '\0'; ++Cursor)
		{
			const char Ch = *Cursor;
			if (Ch == '\\' || Ch == '"')
			{
				Out.push_back('\\');
				Out.push_back(Ch);
			}
			else if (Ch == '\r' || Ch == '\n' || Ch == '\t')
				Out.push_back(' ');
			else
				Out.push_back(Ch);
		}
		Out.push_back('"');
	}

	static void AppendJsonKeyValue(std::string& Out, const char* Key, const char* Value, const bool TrailingComma)
	{
		Out.push_back('"');
		Out.append(Key);
		Out.append("\":");
		AppendEscapedJsonString(Out, Value);
		if (TrailingComma)
			Out.push_back(',');
	}

	static void AppendJsonKeyNumber(std::string& Out, const char* Key, const int64_t Value, const bool TrailingComma)
	{
		char Buffer[64];
		snprintf(Buffer, sizeof(Buffer), "\"%s\":%lld", Key, static_cast<long long>(Value));
		Out.append(Buffer);
		if (TrailingComma)
			Out.push_back(',');
	}

	static void AppendSanitizedChartbookName(SCString& Out, const SCString& ChartbookName)
	{
		const char* Cursor = ChartbookName.GetChars();
		if (Cursor == nullptr)
			return;

		for (; *Cursor != '\0'; ++Cursor)
		{
			const unsigned char Ch = static_cast<unsigned char>(*Cursor);
			if ((Ch >= 'A' && Ch <= 'Z') || (Ch >= 'a' && Ch <= 'z') || (Ch >= '0' && Ch <= '9'))
				Out += static_cast<char>(Ch);
			else
				Out += '_';
		}
	}

	static bool WriteReportFile(SCStudyInterfaceRef sc, const SCString& ChartbookName, const std::string& JsonBody)
	{
		SCString Path = sc.DataFilesFolder();
		Path += "SCMemoryReport_";
		AppendSanitizedChartbookName(Path, ChartbookName);
		Path += ".json";

		int FileHandle = 0;
		if (sc.OpenFile(Path, n_ACSIL::FILE_MODE_CREATE_AND_OPEN_FOR_READ_WRITE, FileHandle) <= 0)
			return false;

		unsigned int BytesWritten = 0;
		sc.WriteFile(
			FileHandle,
			JsonBody.c_str(),
			static_cast<int>(JsonBody.size()),
			&BytesWritten);

		sc.CloseFile(FileHandle);
		return BytesWritten == JsonBody.size();
	}
}

SCSFExport scsf_SCMemoryReporter(SCStudyInterfaceRef sc)
{
	SCInputRef Input_UpdateSeconds = sc.Input[0];

	if (sc.SetDefaults)
	{
		sc.GraphName = "SC Memory Reporter";
		sc.StudyDescription =
			"Writes SCMemoryReport_<ChartbookName>.json to the Data folder with estimated RAM usage "
			"for each chart and study in the open chartbook. Used by the SC Memory Monitor desktop app.";

		sc.AutoLoop = 0;
		sc.UpdateAlways = 1;
		sc.FreeDLL = 1;
		sc.GraphRegion = 0;
		sc.DrawZeros = 0;

		for (int SubgraphIndex = 0; SubgraphIndex < SC_SUBGRAPHS_AVAILABLE; ++SubgraphIndex)
			sc.Subgraph[SubgraphIndex].DrawStyle = DRAWSTYLE_IGNORE;

		Input_UpdateSeconds.Name = "Report Update Interval (seconds)";
		Input_UpdateSeconds.SetInt(2);
		Input_UpdateSeconds.SetIntLimits(1, 60);

		return;
	}

	if (sc.LastCallToFunction)
		return;

	const int UpdateSeconds = Input_UpdateSeconds.GetInt();
	const int IntervalSeconds = UpdateSeconds > 0 ? UpdateSeconds : 2;

	int& r_LastWriteSecond = sc.GetPersistentInt(1);
	const int CurrentSecond = static_cast<int>(sc.CurrentSystemDateTime.GetTimeInSeconds());

	if (!sc.IsFullRecalculation && r_LastWriteSecond > 0
		&& (CurrentSecond - r_LastWriteSecond) < IntervalSeconds)
	{
		return;
	}

	r_LastWriteSecond = CurrentSecond;

	const int HighestChartNumber = sc.GetHighestChartNumberUsedInChartBook();
	const SCString ChartbookName = sc.ChartbookName();
	const SCString DataFolder = sc.DataFilesFolder();

	std::string Json;
	Json.reserve(65536);
	Json += "{\n";

	char Buffer[256];
	snprintf(
		Buffer,
		sizeof(Buffer),
		"  \"timestampUnix\": %lld,\n  \"processId\": %u,\n",
		static_cast<long long>(sc.CurrentSystemDateTime.ToUNIXTime()),
		sc.ProcessIdentifier);
	Json += Buffer;

	Json += "  \"chartbookName\": ";
	AppendEscapedJsonString(Json, ChartbookName.GetChars());
	Json += ",\n  \"dataFolder\": ";
	AppendEscapedJsonString(Json, DataFolder.GetChars());
	Json += ",\n  \"reporterChartNumber\": ";
	snprintf(Buffer, sizeof(Buffer), "%d,\n", sc.ChartNumber);
	Json += Buffer;

	Json += "  \"note\": \"Estimated in-process bytes from chart arrays, VAP, market depth, studies, and time & sales. Working Set also includes graphics, file cache, and other process memory.\",\n";
	Json += "  \"charts\": [";

	int64_t ChartbookEstimatedBytes = 0;
	int64_t SumBaseDataBytes = 0;
	int64_t SumOhlcBytes = 0;
	int64_t SumExtendedBaseBytes = 0;
	int64_t SumVapBytes = 0;
	int64_t SumMarketDepthBytes = 0;
	int64_t SumStudySubgraphBytes = 0;
	int64_t SumStudyProfileBytes = 0;

	for (int ChartNumber = 1; ChartNumber <= HighestChartNumber; ++ChartNumber)
	{
		SCGraphData BaseData;
		sc.GetChartBaseData(ChartNumber, BaseData);

		int BarCount = 0;
		for (int SeriesIndex = SC_OPEN; SeriesIndex <= SC_LAST; ++SeriesIndex)
			BarCount = max(BarCount, BaseData[SeriesIndex].GetArraySize());

		const int64_t BaseDataBytes = EstimateGraphDataBytes(BaseData);
		const int64_t OhlcBytes = EstimateOhlcBytes(BaseData);
		const int64_t ExtendedBaseBytes = max(static_cast<int64_t>(0), BaseDataBytes - OhlcBytes);
		c_VAPContainer* pVAP = sc.GetVolumeAtPriceForBarsForChart(ChartNumber);
		const int64_t VapBytes = EstimateVapBytes(pVAP);
		const int64_t MarketDepthBytes = EstimateMarketDepthBytes(sc, ChartNumber);

		const SCString ChartName = sc.GetChartName(ChartNumber);
		const SCString Symbol = sc.GetChartSymbol(ChartNumber);
		const int StudyCount = sc.GetStudyCount(ChartNumber);

		int64_t ChartStudySubgraphBytes = 0;
		int64_t ChartStudyProfileBytes = 0;
		int64_t ChartStudyBytes = 0;
		std::string StudiesJson;
		StudiesJson.reserve(8192);
		StudiesJson += "[";

		bool WroteStudy = false;
		for (int StudyIndex = 0; StudyIndex < StudyCount; ++StudyIndex)
		{
			const int StudyID = sc.GetStudyIDByIndex(ChartNumber, StudyIndex);
			if (StudyID == 0)
				continue;

			SCGraphData StudyData;
			sc.GetStudyArraysFromChartUsingID(ChartNumber, StudyID, StudyData);

			const int64_t SubgraphBytes = EstimateGraphDataBytes(StudyData);
			const int64_t ProfileBytes = EstimateProfileBytes(sc, StudyID);
			const int64_t StudyEstimatedBytes = SubgraphBytes + ProfileBytes;

			ChartStudyBytes += StudyEstimatedBytes;
			ChartStudySubgraphBytes += SubgraphBytes;
			ChartStudyProfileBytes += ProfileBytes;

			if (WroteStudy)
				StudiesJson += ",";
			WroteStudy = true;

			StudiesJson += "\n      {";
			StudiesJson += "\"studyId\":";
			snprintf(Buffer, sizeof(Buffer), "%d", StudyID);
			StudiesJson += Buffer;
			StudiesJson += ",\"name\":";
			AppendEscapedJsonString(StudiesJson, sc.GetStudyNameFromChart(ChartNumber, StudyID).GetChars());
			StudiesJson += ",\"subgraphBytes\":";
			snprintf(Buffer, sizeof(Buffer), "%lld", static_cast<long long>(SubgraphBytes));
			StudiesJson += Buffer;
			StudiesJson += ",\"profileBytes\":";
			snprintf(Buffer, sizeof(Buffer), "%lld", static_cast<long long>(ProfileBytes));
			StudiesJson += Buffer;
			StudiesJson += ",\"estimatedBytes\":";
			snprintf(Buffer, sizeof(Buffer), "%lld", static_cast<long long>(StudyEstimatedBytes));
			StudiesJson += Buffer;
			StudiesJson += "}";
		}

		StudiesJson += "\n    ]";

		const int64_t ChartEstimatedBytes = BaseDataBytes + VapBytes + MarketDepthBytes + ChartStudyBytes;
		ChartbookEstimatedBytes += ChartEstimatedBytes;
		SumBaseDataBytes += BaseDataBytes;
		SumOhlcBytes += OhlcBytes;
		SumExtendedBaseBytes += ExtendedBaseBytes;
		SumVapBytes += VapBytes;
		SumMarketDepthBytes += MarketDepthBytes;
		SumStudySubgraphBytes += ChartStudySubgraphBytes;
		SumStudyProfileBytes += ChartStudyProfileBytes;

		if (ChartNumber > 1)
			Json += ",";

		Json += "\n    {";
		Json += "\"chartNumber\":";
		snprintf(Buffer, sizeof(Buffer), "%d", ChartNumber);
		Json += Buffer;
		Json += ",\"chartName\":";
		AppendEscapedJsonString(Json, ChartName.GetChars());
		Json += ",\"symbol\":";
		AppendEscapedJsonString(Json, Symbol.GetChars());
		Json += ",\"barCount\":";
		snprintf(Buffer, sizeof(Buffer), "%d", BarCount);
		Json += Buffer;
		Json += ",\"ohlcBytes\":";
		snprintf(Buffer, sizeof(Buffer), "%lld", static_cast<long long>(OhlcBytes));
		Json += Buffer;
		Json += ",\"extendedBaseBytes\":";
		snprintf(Buffer, sizeof(Buffer), "%lld", static_cast<long long>(ExtendedBaseBytes));
		Json += Buffer;
		Json += ",\"baseDataBytes\":";
		snprintf(Buffer, sizeof(Buffer), "%lld", static_cast<long long>(BaseDataBytes));
		Json += Buffer;
		Json += ",\"vapBytes\":";
		snprintf(Buffer, sizeof(Buffer), "%lld", static_cast<long long>(VapBytes));
		Json += Buffer;
		Json += ",\"marketDepthBytes\":";
		snprintf(Buffer, sizeof(Buffer), "%lld", static_cast<long long>(MarketDepthBytes));
		Json += Buffer;
		Json += ",\"studySubgraphBytes\":";
		snprintf(Buffer, sizeof(Buffer), "%lld", static_cast<long long>(ChartStudySubgraphBytes));
		Json += Buffer;
		Json += ",\"studyProfileBytes\":";
		snprintf(Buffer, sizeof(Buffer), "%lld", static_cast<long long>(ChartStudyProfileBytes));
		Json += Buffer;
		Json += ",\"studiesEstimatedBytes\":";
		snprintf(Buffer, sizeof(Buffer), "%lld", static_cast<long long>(ChartStudyBytes));
		Json += Buffer;
		Json += ",\"estimatedBytes\":";
		snprintf(Buffer, sizeof(Buffer), "%lld", static_cast<long long>(ChartEstimatedBytes));
		Json += Buffer;
		Json += ",\"studies\":";
		Json += StudiesJson;
		Json += "}";
	}

	Json += "\n  ],\n  \"memorySummary\": {\n";
	AppendJsonKeyNumber(Json, "baseDataBytes", SumBaseDataBytes, true);
	AppendJsonKeyNumber(Json, "ohlcBytes", SumOhlcBytes, true);
	AppendJsonKeyNumber(Json, "extendedBaseBytes", SumExtendedBaseBytes, true);
	AppendJsonKeyNumber(Json, "vapBytes", SumVapBytes, true);
	AppendJsonKeyNumber(Json, "marketDepthBytes", SumMarketDepthBytes, true);
	AppendJsonKeyNumber(Json, "studySubgraphBytes", SumStudySubgraphBytes, true);
	AppendJsonKeyNumber(Json, "studyProfileBytes", SumStudyProfileBytes, true);
	const int64_t TimeAndSalesBytes = EstimateTimeAndSalesBytes(sc);
	AppendJsonKeyNumber(Json, "timeAndSalesBytes", TimeAndSalesBytes, true);
	ChartbookEstimatedBytes += TimeAndSalesBytes;
	AppendJsonKeyNumber(Json, "chartbookMeasuredBytes", ChartbookEstimatedBytes, false);
	Json += "\n  },\n";
	AppendJsonKeyNumber(Json, "chartbookEstimatedBytes", ChartbookEstimatedBytes, false);
	Json += "\n}\n";

	WriteReportFile(sc, ChartbookName, Json);
}
