//+------------------------------------------------------------------+
//| Goldstar_ReadOnly_OHLC_Collector.mq5                             |
//| Demo-only, read-only incremental OHLC history collector.         |
//| No order, position, or account-modification functions are used.  |
//+------------------------------------------------------------------+
#property strict
#property version   "1.00"
#property description "Goldstar AMarkets demo-only incremental OHLC collector"

input string IngestBridgeKey = "";     // MT5_BRIDGE_KEY; never commit/share this value
input int    HttpTimeoutMs = 15000;
input int    TimerIntervalSeconds = 300;
input int    MaxMarketWatchSymbols = 20;
input int    BarsPerSeries = 30;        // Max 20 symbols x 5 timeframes x 30 = 3000 bars

const string HISTORY_URL =
   "https://26380461-trading-research-agent-staging.goldstar-nsl83.workers.dev/mt5/history";

struct SeriesCursor
{
   string key;
   datetime last_server_bar_time;
};

SeriesCursor SentCursors[];

// AMarkets documents GMT+3 from the last Sunday of October through the
// last Sunday of March, and GMT+2 for the rest of the year. We skip each
// complete transition Sunday because the exact change hour is not specified
// in the public FAQ. A visible gap is safer than a fabricated UTC timestamp.
int LastSundayDayOfMonth(const int year, const int month)
{
   int lastDayNumber = 31;
   if(month == 4 || month == 6 || month == 9 || month == 11)
      lastDayNumber = 30;
   else if(month == 2)
   {
      const bool leapYear = ((year % 400) == 0 || ((year % 4) == 0 && (year % 100) != 0));
      lastDayNumber = leapYear ? 29 : 28;
   }

   MqlDateTime lastDay;
   ZeroMemory(lastDay);
   lastDay.year = year;
   lastDay.mon = month;
   lastDay.day = lastDayNumber;
   const datetime stamp = StructToTime(lastDay);
   TimeToStruct(stamp, lastDay);
   return lastDay.day - lastDay.day_of_week;
}

int AMarketsUtcOffsetHours(const datetime serverBarTime, bool &isTransitionDay)
{
   MqlDateTime value;
   TimeToStruct(serverBarTime, value);
   isTransitionDay = false;

   const int marchLastSunday = LastSundayDayOfMonth(value.year, 3);
   const int octoberLastSunday = LastSundayDayOfMonth(value.year, 10);

   if((value.mon == 3 && value.day == marchLastSunday) ||
      (value.mon == 10 && value.day == octoberLastSunday))
   {
      isTransitionDay = true;
      return 0;
   }

   if(value.mon > 10 || value.mon < 3)
      return 3;
   if(value.mon == 3)
      return (value.day < marchLastSunday) ? 3 : 2;
   if(value.mon == 10)
      return (value.day < octoberLastSunday) ? 2 : 3;
   return 2;
}

string JsonEscape(string value)
{
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   StringReplace(value, "\r", "\\r");
   StringReplace(value, "\n", "\\n");
   StringReplace(value, "\t", "\\t");
   return value;
}

string JsonNumber(const double value)
{
   if(!MathIsValidNumber(value))
      return "null";
   return DoubleToString(value, 10);
}

string TimeframeLabel(const ENUM_TIMEFRAMES timeframe)
{
   switch(timeframe)
   {
      case PERIOD_M5:  return "M5";
      case PERIOD_M15: return "M15";
      case PERIOD_H1:  return "H1";
      case PERIOD_H4:  return "H4";
      case PERIOD_D1:  return "D1";
   }
   return "";
}

string SeriesKey(const string symbol, const string timeframe)
{
   return symbol + "|" + timeframe;
}

datetime LastSentTime(const string key)
{
   for(int index = 0; index < ArraySize(SentCursors); index++)
   {
      if(SentCursors[index].key == key)
         return SentCursors[index].last_server_bar_time;
   }
   return 0;
}

void CommitSentTime(const string key, const datetime serverBarTime)
{
   if(serverBarTime <= 0)
      return;

   for(int index = 0; index < ArraySize(SentCursors); index++)
   {
      if(SentCursors[index].key == key)
      {
         if(serverBarTime > SentCursors[index].last_server_bar_time)
            SentCursors[index].last_server_bar_time = serverBarTime;
         return;
      }
   }

   const int size = ArraySize(SentCursors);
   if(ArrayResize(SentCursors, size + 1) != size + 1)
      return;
   SentCursors[size].key = key;
   SentCursors[size].last_server_bar_time = serverBarTime;
}

void AddPendingCursor(SeriesCursor &pending[], const string key, const datetime serverBarTime)
{
   if(serverBarTime <= 0)
      return;

   for(int index = 0; index < ArraySize(pending); index++)
   {
      if(pending[index].key == key)
      {
         if(serverBarTime > pending[index].last_server_bar_time)
            pending[index].last_server_bar_time = serverBarTime;
         return;
      }
   }

   const int size = ArraySize(pending);
   if(ArrayResize(pending, size + 1) != size + 1)
      return;
   pending[size].key = key;
   pending[size].last_server_bar_time = serverBarTime;
}

bool ValidRates(const MqlRates &bar)
{
   if(!MathIsValidNumber(bar.open) || !MathIsValidNumber(bar.high) ||
      !MathIsValidNumber(bar.low) || !MathIsValidNumber(bar.close))
      return false;
   if(bar.open <= 0 || bar.high <= 0 || bar.low <= 0 || bar.close <= 0)
      return false;
   if(bar.high < MathMax(bar.open, MathMax(bar.close, bar.low)))
      return false;
   if(bar.low > MathMin(bar.open, MathMin(bar.close, bar.high)))
      return false;
   if(bar.tick_volume < 0 || bar.real_volume < 0 || bar.spread < 0)
      return false;
   return true;
}

bool BuildHistoryPayload(string &payload, SeriesCursor &pending[], int &barCount)
{
   ENUM_TIMEFRAMES frames[5];
   frames[0] = PERIOD_M5;
   frames[1] = PERIOD_M15;
   frames[2] = PERIOD_H1;
   frames[3] = PERIOD_H4;
   frames[4] = PERIOD_D1;

   const int totalSymbols = SymbolsTotal(true);
   const int symbolLimit = MathMin(totalSymbols, MaxMarketWatchSymbols);
   string barsJson = "";
   barCount = 0;

   for(int symbolIndex = 0; symbolIndex < symbolLimit; symbolIndex++)
   {
      const string symbol = SymbolName(symbolIndex, true);
      if(symbol == "" || StringLen(symbol) > 32)
         continue;

      for(int timeframeIndex = 0; timeframeIndex < 5; timeframeIndex++)
      {
         const string timeframe = TimeframeLabel(frames[timeframeIndex]);
         if(timeframe == "")
            continue;

         const string key = SeriesKey(symbol, timeframe);
         const datetime cursor = LastSentTime(key);
         MqlRates rates[];
         ArraySetAsSeries(rates, false);

         // Shift=1 excludes the currently forming candle.
         const int copied = CopyRates(symbol, frames[timeframeIndex], 1, BarsPerSeries, rates);
         if(copied <= 0)
            continue;

         datetime latestSeen = cursor;
         for(int barIndex = 0; barIndex < copied; barIndex++)
         {
            const datetime serverBarTime = rates[barIndex].time;
            if(serverBarTime <= cursor)
               continue;
            if(serverBarTime > latestSeen)
               latestSeen = serverBarTime;

            bool transitionDay = false;
            const int utcOffsetHours = AMarketsUtcOffsetHours(serverBarTime, transitionDay);
            if(transitionDay || !ValidRates(rates[barIndex]))
               continue;

            const long utcSeconds = (long)serverBarTime - (long)utcOffsetHours * 3600;
            const long timeMsc = utcSeconds * 1000;
            if(timeMsc <= 0)
               continue;

            string item = "{";
            item += "\"symbol\":\"" + JsonEscape(symbol) + "\",";
            item += "\"timeframe\":\"" + timeframe + "\",";
            item += "\"time_msc\":" + StringFormat("%I64d", timeMsc) + ",";
            item += "\"open\":" + JsonNumber(rates[barIndex].open) + ",";
            item += "\"high\":" + JsonNumber(rates[barIndex].high) + ",";
            item += "\"low\":" + JsonNumber(rates[barIndex].low) + ",";
            item += "\"close\":" + JsonNumber(rates[barIndex].close) + ",";
            item += "\"tick_volume\":" + StringFormat("%I64d", rates[barIndex].tick_volume) + ",";
            item += "\"real_volume\":" + StringFormat("%I64d", rates[barIndex].real_volume) + ",";
            item += "\"spread_points\":" + IntegerToString(rates[barIndex].spread);
            item += "}";

            if(barCount > 0)
               barsJson += ",";
            barsJson += item;
            barCount++;
         }

         // Commit cursors only after the server returns HTTP 202. Invalid or
         // DST-boundary bars are skipped deliberately, never fabricated.
         if(latestSeen > cursor)
            AddPendingCursor(pending, key, latestSeen);
      }
   }

   if(barCount == 0)
   {
      payload = "";
      return true;
   }

   const string server = AccountInfoString(ACCOUNT_SERVER);
   const long terminalBuild = TerminalInfoInteger(TERMINAL_BUILD);
   payload = "{";
   payload += "\"account\":{";
   payload += "\"server\":\"" + JsonEscape(server) + "\",";
   payload += "\"terminal_build\":" + StringFormat("%I64d", terminalBuild) + ",";
   payload += "\"terminal_connected\":true,";
   payload += "\"trade_mode\":\"DEMO\"";
   payload += "},";
   payload += "\"bars\":[" + barsJson + "]";
   return (StringLen(payload) < 900000);
}

bool SendHistoryBatch()
{
   if(IngestBridgeKey == "")
   {
      Print("Goldstar OHLC: enter staging MT5_BRIDGE_KEY in EA Inputs. No request sent.");
      return false;
   }
   if(!TerminalInfoInteger(TERMINAL_CONNECTED))
   {
      Print("Goldstar OHLC: terminal is disconnected. No request sent.");
      return false;
   }
   const ENUM_ACCOUNT_TRADE_MODE tradeMode =
      (ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE);
   if(tradeMode != ACCOUNT_TRADE_MODE_DEMO)
   {
      Print("Goldstar OHLC safety stop: collection is DEMO-only. No request sent.");
      return false;
   }

   string payload;
   int barCount = 0;
   SeriesCursor pending[];
   if(!BuildHistoryPayload(payload, pending, barCount))
   {
      Print("Goldstar OHLC: payload exceeded the safe size limit or could not be built.");
      return false;
   }
   if(barCount == 0)
   {
      Print("Goldstar OHLC: no new closed bars to upload.");
      return true;
   }

   char postData[];
   char responseData[];
   string responseHeaders;
   const int bytes = StringToCharArray(payload, postData, 0, WHOLE_ARRAY, CP_UTF8);
   if(bytes <= 1)
   {
      Print("Goldstar OHLC: JSON encoding failed. No request sent.");
      return false;
   }
   ArrayResize(postData, bytes - 1);

   const string headers =
      "Content-Type: application/json\r\n" +
      "X-Goldstar-MT5-Key: " + IngestBridgeKey + "\r\n";

   ResetLastError();
   const int status = WebRequest("POST", HISTORY_URL, headers, HttpTimeoutMs,
                                postData, responseData, responseHeaders);
   if(status == -1)
   {
      PrintFormat("Goldstar OHLC: WebRequest failed; MT5 error=%d. Check the allowed URL and connection.",
                  GetLastError());
      return false;
   }

   const string response = CharArrayToString(responseData, 0, WHOLE_ARRAY, CP_UTF8);
   if(status != 202)
   {
      PrintFormat("Goldstar OHLC: history batch rejected. HTTP=%d. Response=%s",
                  status, response);
      return false;
   }

   for(int index = 0; index < ArraySize(pending); index++)
      CommitSentTime(pending[index].key, pending[index].last_server_bar_time);

   PrintFormat("Goldstar OHLC: accepted %d closed bars across %d series. HTTP=%d. Response=%s",
               barCount, ArraySize(pending), status, response);
   return true;
}

int OnInit()
{
   if(HttpTimeoutMs < 1000 || HttpTimeoutMs > 60000 ||
      TimerIntervalSeconds < 60 || TimerIntervalSeconds > 3600 ||
      MaxMarketWatchSymbols < 1 || MaxMarketWatchSymbols > 20 ||
      BarsPerSeries < 1 || BarsPerSeries > 30)
   {
      Print("Goldstar OHLC: invalid Inputs. Check timeout, timer, symbols and bar limits.");
      return INIT_PARAMETERS_INCORRECT;
   }

   if(!EventSetTimer(TimerIntervalSeconds))
   {
      PrintFormat("Goldstar OHLC: could not start timer. MT5 error=%d", GetLastError());
      return INIT_FAILED;
   }

   // Initial bounded catch-up: no more than 20 x 5 x 30 = 3000 bars.
   SendHistoryBatch();
   return INIT_SUCCEEDED;
}

void OnTimer()
{
   SendHistoryBatch();
}

void OnTick()
{
   // Intentionally empty. No trading or tick-driven execution code.
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}
