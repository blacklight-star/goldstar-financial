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
