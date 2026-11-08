//+------------------------------------------------------------------+
//| Goldstar_ReadOnly_Snapshot.mq5                                   |
//| One-shot, demo-only MT5 snapshot sender.                          |
//| This EA does not contain trading or order-management functions.   |
//+------------------------------------------------------------------+
#property strict
#property version   "1.00"
#property description "Goldstar demo-only read-only snapshot sender"

input string IngestBridgeKey = "";  // MT5_BRIDGE_KEY; never commit or share this value
input int    HttpTimeoutMs   = 15000;
input int    MaxPositions    = 30;  // Worker limit
input int    MaxMarketWatchTicks = 30; // Worker limit

const string SNAPSHOT_URL =
   "https://05931c07-trading-research-agent-staging.goldstar-nsl83.workers.dev/mt5/snapshot";

string JsonEscape(string value)
{
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   StringReplace(value, "\r", "\\r");
   StringReplace(value, "\n", "\\n");
   StringReplace(value, "\t", "\\t");
   return value;
}

string JsonNumber(double value)
{
   if(!MathIsValidNumber(value))
      return "0";
   return DoubleToString(value, 8);
}

string BuildPositionsJson()
{
   string output = "[";
   int total = PositionsTotal();
   int limit = MathMin(total, MathMin(MaxPositions, 30));
   int added = 0;

   for(int index = 0; index < limit; index++)
   {
      ulong ticket = PositionGetTicket(index);
      if(ticket == 0 || !PositionSelectByTicket(ticket))
         continue;

      ENUM_POSITION_TYPE positionType =
         (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      string side = (positionType == POSITION_TYPE_BUY) ? "BUY" : "SELL";

      string item = "{";
      item += "\"ticket\":\"" + StringFormat("%I64u", ticket) + "\",";
      item += "\"symbol\":\"" + JsonEscape(PositionGetString(POSITION_SYMBOL)) + "\",";
      item += "\"type\":\"" + side + "\",";
      item += "\"volume\":" + JsonNumber(PositionGetDouble(POSITION_VOLUME)) + ",";
      item += "\"price_open\":" + JsonNumber(PositionGetDouble(POSITION_PRICE_OPEN)) + ",";
      item += "\"price_current\":" + JsonNumber(PositionGetDouble(POSITION_PRICE_CURRENT)) + ",";
      item += "\"stop_loss\":" + JsonNumber(PositionGetDouble(POSITION_SL)) + ",";
      item += "\"take_profit\":" + JsonNumber(PositionGetDouble(POSITION_TP)) + ",";
      item += "\"profit\":" + JsonNumber(PositionGetDouble(POSITION_PROFIT)) + ",";
      item += "\"swap\":" + JsonNumber(PositionGetDouble(POSITION_SWAP)) + ",";
      item += "\"opened_at\":\"" +
              JsonEscape(TimeToString((datetime)PositionGetInteger(POSITION_TIME),
                                      TIME_DATE | TIME_SECONDS)) + "\"";
      item += "}";

      if(added > 0)
         output += ",";
      output += item;
      added++;
   }

   output += "]";
   return output;
}

string BuildTicksJson()
{
   string output = "[";
   int total = SymbolsTotal(true);
   int limit = MathMin(total, MathMin(MaxMarketWatchTicks, 30));
   int added = 0;

   for(int index = 0; index < limit; index++)
   {
      string symbol = SymbolName(index, true);
      if(symbol == "")
         continue;

      MqlTick tick;
      if(!SymbolInfoTick(symbol, tick))
         continue;

      string item = "{";
      item += "\"symbol\":\"" + JsonEscape(symbol) + "\",";
      item += "\"bid\":" + JsonNumber(tick.bid) + ",";
      item += "\"ask\":" + JsonNumber(tick.ask) + ",";
      item += "\"last\":" + JsonNumber(tick.last) + ",";
      item += "\"time_msc\":" + StringFormat("%I64d", tick.time_msc);
      item += "}";

      if(added > 0)
         output += ",";
      output += item;
      added++;
   }

   output += "]";
   return output;
}

bool SendOneSnapshot()
{
   if(IngestBridgeKey == "")
   {
      Print("Goldstar: enter the staging MT5 bridge key in EA Inputs. No request sent.");
      return false;
   }

   if(!TerminalInfoInteger(TERMINAL_CONNECTED))
   {
      Print("Goldstar: MT5 terminal is not connected. No request sent.");
      return false;
   }

   ENUM_ACCOUNT_TRADE_MODE tradeMode =
      (ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE);
   if(tradeMode != ACCOUNT_TRADE_MODE_DEMO)
   {
      Print("Goldstar safety stop: this EA sends data only from a DEMO account.");
      return false;
   }

   long login = AccountInfoInteger(ACCOUNT_LOGIN);
   long leverage = AccountInfoInteger(ACCOUNT_LEVERAGE);
   string server = AccountInfoString(ACCOUNT_SERVER);
   string currency = AccountInfoString(ACCOUNT_CURRENCY);
   bool tradeAllowed = (AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) == 1);

   string account = "{";
   account += "\"login\":\"" + StringFormat("%I64d", login) + "\",";
   account += "\"server\":\"" + JsonEscape(server) + "\",";
   account += "\"currency\":\"" + JsonEscape(currency) + "\",";
   account += "\"leverage\":" + StringFormat("%I64d", leverage) + ",";
   account += "\"balance\":" + JsonNumber(AccountInfoDouble(ACCOUNT_BALANCE)) + ",";
   account += "\"equity\":" + JsonNumber(AccountInfoDouble(ACCOUNT_EQUITY)) + ",";
   account += "\"margin\":" + JsonNumber(AccountInfoDouble(ACCOUNT_MARGIN)) + ",";
   account += "\"free_margin\":" + JsonNumber(AccountInfoDouble(ACCOUNT_MARGIN_FREE)) + ",";
   account += "\"margin_level\":" + JsonNumber(AccountInfoDouble(ACCOUNT_MARGIN_LEVEL)) + ",";
   account += "\"terminal_connected\":true,";
   account += "\"trade_allowed\":" + (tradeAllowed ? "true" : "false") + ",";
   account += "\"terminal_version\":\"" +
              StringFormat("%I64d", TerminalInfoInteger(TERMINAL_BUILD)) + "\",";
   account += "\"trade_mode\":\"DEMO\"";
   account += "}";

   string payload = "{";
   payload += "\"account\":" + account + ",";
   payload += "\"positions\":" + BuildPositionsJson() + ",";
   payload += "\"ticks\":" + BuildTicksJson();
   payload += "}";

   char postData[];
   char responseData[];
   string responseHeaders;

   int bytes = StringToCharArray(payload, postData, 0, WHOLE_ARRAY, CP_UTF8);
   if(bytes <= 1)
   {
      Print("Goldstar: could not encode the JSON snapshot. No request sent.");
      return false;
   }

   // Remove StringToCharArray's terminating zero byte.
   ArrayResize(postData, bytes - 1);

   string headers =
      "Content-Type: application/json\r\n" +
      "X-Goldstar-MT5-Key: " + IngestBridgeKey + "\r\n";

   ResetLastError();
   int status = WebRequest("POST", SNAPSHOT_URL, headers, HttpTimeoutMs,
                           postData, responseData, responseHeaders);

   if(status == -1)
   {
      int errorCode = GetLastError();
      PrintFormat("Goldstar: WebRequest failed. MT5 error=%d. Check the allowed URL and connection.",
                  errorCode);
      return false;
   }

   string response = CharArrayToString(responseData, 0, WHOLE_ARRAY, CP_UTF8);
   if(status == 202)
   {
      PrintFormat("Goldstar: demo snapshot accepted. HTTP=%d. Response=%s",
                  status, response);
      return true;
   }

   PrintFormat("Goldstar: snapshot was not accepted. HTTP=%d. Response=%s",
               status, response);
   return false;
}

int OnInit()
{
   if(HttpTimeoutMs < 1000 || HttpTimeoutMs > 60000)
   {
      Print("Goldstar: HttpTimeoutMs must be between 1000 and 60000.");
      return INIT_PARAMETERS_INCORRECT;
   }

   if(MaxPositions < 0 || MaxPositions > 30 ||
      MaxMarketWatchTicks < 0 || MaxMarketWatchTicks > 30)
   {
      Print("Goldstar: position and tick limits must be between 0 and 30.");
      return INIT_PARAMETERS_INCORRECT;
   }

   // Exactly one read-only snapshot is sent when the EA is attached/reinitialized.
   // Remove and re-attach the EA to request another snapshot.
   SendOneSnapshot();
   return INIT_SUCCEEDED;
}

void OnTick()
{
   // Intentionally empty. No periodic polling and no trade operations.
}

void OnDeinit(const int reason)
{
   // No timers, files, or persistent state are used.
}
