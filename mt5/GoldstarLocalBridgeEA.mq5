#property strict
#property version   "1.00"
#property description "Goldstar local MT5 bridge — DEMO account, read-only snapshots only"

input string BridgeUrl = "https://mt5-readonly-v5-trading-research-agent-staging.goldstar-nsl83.workers.dev/mt5/snapshot";
input string BridgeKey = "";
input int IntervalSeconds = 60;
input int MaxPositions = 20;
input int MaxSymbols = 10;

string BoolJson(const bool value) {
   return value ? "true" : "false";
}

string JsonEscape(string value) {
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   StringReplace(value, "\r", "");
   StringReplace(value, "\n", " ");
   return value;
}

string BuildPositions() {
   string result = "[";
   int count = 0;
   int limit = MathMax(0, MathMin(30, MaxPositions));
   for(int i = 0; i < PositionsTotal() && count < limit; i++) {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;

      string symbol = PositionGetString(POSITION_SYMBOL);
      long type = PositionGetInteger(POSITION_TYPE);
      string typeText = (type == POSITION_TYPE_BUY) ? "BUY" : "SELL";
      int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
      if(digits < 0 || digits > 10) digits = 5;

      if(count > 0) result += ",";
      result += "{";
      result += "\"ticket\":\"" + IntegerToString((long)ticket) + "\",";
      result += "\"symbol\":\"" + JsonEscape(symbol) + "\",";
      result += "\"type\":\"" + typeText + "\",";
      result += "\"volume\":" + DoubleToString(PositionGetDouble(POSITION_VOLUME), 4) + ",";
      result += "\"price_open\":" + DoubleToString(PositionGetDouble(POSITION_PRICE_OPEN), digits) + ",";
      result += "\"price_current\":" + DoubleToString(PositionGetDouble(POSITION_PRICE_CURRENT), digits) + ",";
      result += "\"stop_loss\":" + DoubleToString(PositionGetDouble(POSITION_SL), digits) + ",";
      result += "\"take_profit\":" + DoubleToString(PositionGetDouble(POSITION_TP), digits) + ",";
      result += "\"profit\":" + DoubleToString(PositionGetDouble(POSITION_PROFIT), 2) + ",";
      result += "\"swap\":" + DoubleToString(PositionGetDouble(POSITION_SWAP), 2) + ",";
      result += "\"opened_at\":\"" + TimeToString((datetime)PositionGetInteger(POSITION_TIME), TIME_DATE|TIME_SECONDS) + "\"";
      result += "}";
      count++;
   }
   result += "]";
   return result;
}

string BuildTicks() {
   string result = "[";
   int count = 0;
   int limit = MathMax(0, MathMin(30, MaxSymbols));
   int total = SymbolsTotal(true);
   for(int i = 0; i < total && count < limit; i++) {
      string symbol = SymbolName(i, true);
      MqlTick tick;
      if(symbol == "" || !SymbolInfoTick(symbol, tick)) continue;

      if(count > 0) result += ",";
      result += "{";
      result += "\"symbol\":\"" + JsonEscape(symbol) + "\",";
      result += "\"bid\":" + DoubleToString(tick.bid, 10) + ",";
      result += "\"ask\":" + DoubleToString(tick.ask, 10) + ",";
      result += "\"last\":" + DoubleToString(tick.last, 10) + ",";
      result += "\"time_msc\":" + IntegerToString((long)tick.time_msc);
      result += "}";
      count++;
   }
   result += "]";
   return result;
}

string BuildSnapshot() {
   string server = AccountInfoString(ACCOUNT_SERVER);
   string currency = AccountInfoString(ACCOUNT_CURRENCY);
   long login = AccountInfoInteger(ACCOUNT_LOGIN);
   long leverage = AccountInfoInteger(ACCOUNT_LEVERAGE);
   bool connected = (TerminalInfoInteger(TERMINAL_CONNECTED) != 0);
   bool tradeAllowed = (AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) != 0 &&
                        TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) != 0);
   int build = (int)TerminalInfoInteger(TERMINAL_BUILD);

   string account = "{";
   account += "\"login\":\"" + IntegerToString(login) + "\",";
   account += "\"server\":\"" + JsonEscape(server) + "\",";
   account += "\"currency\":\"" + JsonEscape(currency) + "\",";
   account += "\"leverage\":" + IntegerToString(leverage) + ",";
   account += "\"balance\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2) + ",";
   account += "\"equity\":" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2) + ",";
   account += "\"margin\":" + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN), 2) + ",";
   account += "\"free_margin\":" + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2) + ",";
   account += "\"margin_level\":" + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN_LEVEL), 2) + ",";
   account += "\"terminal_connected\":" + BoolJson(connected) + ",";
   account += "\"trade_allowed\":" + BoolJson(tradeAllowed) + ",";
   account += "\"terminal_version\":\"" + IntegerToString(build) + "\",";
   account += "\"trade_mode\":\"DEMO\"";
   account += "}";

   return "{\"account\":" + account +
          ",\"positions\":" + BuildPositions() +
          ",\"ticks\":" + BuildTicks() + "}";
}

void SendSnapshot() {
   if(BridgeKey == "") {
      Print("Goldstar bridge: set BridgeKey in EA inputs.");
      return;
   }
   if((ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE) != ACCOUNT_TRADE_MODE_DEMO) {
      Print("Goldstar bridge blocked: this EA sends demo-account data only.");
      return;
   }
   if(TerminalInfoInteger(TERMINAL_CONNECTED) == 0) {
      Print("Goldstar bridge: terminal is not connected.");
      return;
   }

   string payload = BuildSnapshot();
   char data[];
   char response[];
   string responseHeaders;
   int bytes = StringToCharArray(payload, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(bytes <= 1) {
      Print("Goldstar bridge: failed to encode snapshot.");
      return;
   }
   ArrayResize(data, bytes - 1);

   string headers = "Content-Type: application/json\r\n" +
                    "X-Goldstar-MT5-Key: " + BridgeKey + "\r\n";
   ResetLastError();
   int status = WebRequest("POST", BridgeUrl, headers, 7000, data, response, responseHeaders);
   if(status == -1) {
      PrintFormat("Goldstar bridge WebRequest failed. Error=%d. Check MT5 WebRequest allowlist.", GetLastError());
      return;
   }
   string responseText = CharArrayToString(response, 0, -1, CP_UTF8);
   if(status != 202) {
      PrintFormat("Goldstar bridge rejected snapshot. HTTP=%d Response=%s", status, StringSubstr(responseText, 0, 250));
      return;
   }
   Print("Goldstar bridge: demo snapshot accepted.");
}

int OnInit() {
   if((ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE) != ACCOUNT_TRADE_MODE_DEMO) {
      Print("Goldstar local bridge refuses to start on non-demo accounts.");
      return INIT_FAILED;
   }
   if(BridgeKey == "" || BridgeUrl == "") {
      Print("Goldstar local bridge: BridgeKey and BridgeUrl are required.");
      return INIT_PARAMETERS_INCORRECT;
   }
   int timerSeconds = (int)MathMax(15, MathMin(300, IntervalSeconds));
   EventSetTimer(timerSeconds);
   SendSnapshot();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) {
   EventKillTimer();
}

void OnTimer() {
   SendSnapshot();
}
