import test from "node:test";
import assert from "node:assert/strict";
import worker from "../workers/trading-research-agent/src/worker.js";

function request(path, body, token="client-gateway-secret", headers={}) {
  return new Request("https://research.example"+path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer "+token, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}
function env(overrides={}) {
  const state={fetchCalls:[],logs:[]};
  const DB={
    prepare(sql) {
      return {sql,args:[],bind(...args){this.args=args;return this;},async run(){state.logs.push({sql,args:this.args});return {success:true,meta:{changes:1}};}};
    },
    async batch(statements) { state.logs.push({batch:statements.length}); return statements.map(()=>({success:true,meta:{changes:1}})); }
  };
  return {state,env:{
    MQL5_GATEWAY_API_KEY:"client-gateway-secret",
    MQL5_MARKETDATA_API_KEY:"upstream-mql5-secret",
    DB,
    ...overrides
  }};
}
function mockMcpFetch(state) {
  return async (url,init={}) => {
    state.fetchCalls.push({url:String(url),authorization:init.headers?.authorization,body:JSON.parse(init.body)});
    const payload=JSON.parse(init.body);
    if(payload.method==="initialize") return new Response(JSON.stringify({jsonrpc:"2.0",id:payload.id,result:{protocolVersion:"2025-06-18"}}),{status:200,headers:{"mcp-session-id":"test-session"}});
    if(payload.method==="tools/list") return new Response(JSON.stringify({jsonrpc:"2.0",id:payload.id,result:{tools:[{name:"marketdata_get_symbol_info",description:"Read-only symbol metadata"}]}}),{status:200,headers:{"mcp-session-id":"test-session"}});
    if(payload.method==="tools/call") return new Response(JSON.stringify({jsonrpc:"2.0",id:payload.id,result:{content:[{type:"text",text:"EURUSD"}]}}),{status:200,headers:{"mcp-session-id":"test-session"}});
    return new Response("",{status:202,headers:{"mcp-session-id":"test-session"}});
  };
}

test("MQL5 endpoints fail closed when the separate gateway key is absent",async()=>{
  const {env:bindings}=env({MQL5_GATEWAY_API_KEY:""});
  const response=await worker.fetch(request("/mql5/tools",{}),bindings);
  assert.equal(response.status,503);
});

test("MQL5 endpoints fail closed when the upstream MQL5 key is absent",async()=>{
  const {env:bindings}=env({MQL5_MARKETDATA_API_KEY:""});
  const response=await worker.fetch(request("/mql5/tools",{}),bindings);
  assert.equal(response.status,503);
});

test("client gateway key is checked independently from the upstream MQL5 key",async()=>{
  const {env:bindings,state}=env();
  const originalFetch=globalThis.fetch;
  globalThis.fetch=mockMcpFetch(state);
  try {
    const denied=await worker.fetch(request("/mql5/tools",{},"upstream-mql5-secret"),bindings);
    assert.equal(denied.status,401);
    assert.equal(state.fetchCalls.length,0);
    const allowed=await worker.fetch(request("/mql5/tools",{}),bindings);
    assert.equal(allowed.status,200);
    assert.equal(state.fetchCalls.length,3);
    assert.ok(state.fetchCalls.every(call=>call.authorization==="Bearer upstream-mql5-secret"));
    assert.ok(state.fetchCalls.every(call=>call.authorization!=="Bearer client-gateway-secret"));
  } finally { globalThis.fetch=originalFetch; }
});

test("MQL5 call permits only tools exposed by the market-data MCP server and audits success",async()=>{
  const {env:bindings,state}=env();
  const originalFetch=globalThis.fetch;
  globalThis.fetch=mockMcpFetch(state);
  try {
    const response=await worker.fetch(request("/mql5/call",{name:"marketdata_get_symbol_info",arguments:{symbol:"EURUSD"}}),bindings);
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.ok,true);
    assert.equal(body.result.tool,"marketdata_get_symbol_info");
    assert.equal(state.logs.length,1);
    assert.match(state.logs[0].sql,/INSERT INTO mql5_marketdata_calls/);
    assert.equal(state.fetchCalls.length,6);
    assert.ok(state.fetchCalls.every(call=>call.authorization==="Bearer upstream-mql5-secret"));
  } finally { globalThis.fetch=originalFetch; }
});

test("MQL5 route rejects non-marketdata tool names before upstream calls",async()=>{
  const {env:bindings,state}=env();
  const response=await worker.fetch(request("/mql5/call",{name:"trade_place_order",arguments:{symbol:"EURUSD"}}),bindings);
  assert.equal(response.status,400);
  assert.equal(state.fetchCalls.length,0);
});

test("MQL5 route enforces JSON content type and bounded request body",async()=>{
  const {env:bindings}=env();
  const wrongType=await worker.fetch(request("/mql5/tools",{},"client-gateway-secret",{"content-type":"text/plain"}),bindings);
  assert.equal(wrongType.status,415);
  const large=await worker.fetch(new Request("https://research.example/mql5/call",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer client-gateway-secret"},body:JSON.stringify({name:"marketdata_"+ "x".repeat(5000)})}),bindings);
  assert.equal(large.status,413);
});


function mockCmcV3Fetch(state, payload, status=200) {
  return async (url, init={}) => {
    state.fetchCalls.push({url:String(url),headers:init.headers});
    return new Response(JSON.stringify(payload),{status,headers:{"content-type":"application/json"}});
  };
}

test("CMC ingestion uses the V3 quotes endpoint and parses its array response",async()=>{
  const {env:bindings,state}=env({CMC_API_KEY:"cmc-test-key",INGEST_AUTH_TOKEN:"ingest-test-token"});
  const payload={status:{error_code:0,error_message:null},data:[
    {id:1,symbol:"BTC",name:"Bitcoin",cmc_rank:1,quote:[{id:2781,symbol:"USD",price:65000,volume_24h:1000,market_cap:1200000,percent_change_1h:0.2,percent_change_24h:1.1,percent_change_7d:3.2,last_updated:"2026-11-08T10:00:00.000Z"}]},
    {id:1027,symbol:"ETH",name:"Ethereum",cmc_rank:2,quote:[{id:2781,symbol:"USD",price:3200,volume_24h:500,market_cap:400000,percent_change_1h:0.1,percent_change_24h:0.8,percent_change_7d:2.4,last_updated:"2026-11-08T10:00:00.000Z"}]}
  ]};
  const originalFetch=globalThis.fetch;
  globalThis.fetch=mockCmcV3Fetch(state,payload);
  try {
    const response=await worker.fetch(request("/cmc/quotes",{symbols:["BTC","ETH"],convert:"USD"},"ingest-test-token"),bindings);
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.ok,true);
    assert.equal(body.provider,"coinmarketcap");
    assert.equal(body.records_written,2);
    assert.equal(state.fetchCalls.length,1);
    const call=state.fetchCalls[0];
    const url=new URL(call.url);
    assert.equal(url.pathname,"/v3/cryptocurrency/quotes/latest");
    assert.equal(url.searchParams.get("symbol"),"BTC,ETH");
    assert.equal(url.searchParams.get("convert"),"USD");
    assert.equal(call.headers["X-CMC_PRO_API_KEY"],"cmc-test-key");
    assert.match(state.logs[0].sql,/INSERT INTO cmc_ingestion_runs/);
    assert.equal(state.logs[1].batch,3);
  } finally { globalThis.fetch=originalFetch; }
});

test("CMC ingestion rejects the legacy V1-shaped response instead of silently writing zero quotes",async()=>{
  const {env:bindings,state}=env({CMC_API_KEY:"cmc-test-key",INGEST_AUTH_TOKEN:"ingest-test-token"});
  const originalFetch=globalThis.fetch;
  globalThis.fetch=mockCmcV3Fetch(state,{status:{error_code:0},data:{BTC:{id:1,symbol:"BTC"}}});
  try {
    const response=await worker.fetch(request("/cmc/quotes",{symbols:["BTC"]},"ingest-test-token"),bindings);
    assert.equal(response.status,502);
    const body=await response.json();
    assert.equal(body.ok,false);
    assert.equal(body.error,"ingestion_failed");
    assert.ok(state.logs.some(item=>/UPDATE cmc_ingestion_runs SET status = 'failed'/.test(item.sql||"")));
  } finally { globalThis.fetch=originalFetch; }
});

test("CMC ingestion rejects an invalid ingest token before contacting CoinMarketCap",async()=>{
  const {env:bindings,state}=env({CMC_API_KEY:"cmc-test-key",INGEST_AUTH_TOKEN:"ingest-test-token"});
  const originalFetch=globalThis.fetch;
  globalThis.fetch=mockCmcV3Fetch(state,{status:{error_code:0},data:[]});
  try {
    const response=await worker.fetch(request("/cmc/quotes",{symbols:["BTC"]},"wrong-token"),bindings);
    assert.equal(response.status,401);
    assert.equal(state.fetchCalls.length,0);
  } finally { globalThis.fetch=originalFetch; }
});
