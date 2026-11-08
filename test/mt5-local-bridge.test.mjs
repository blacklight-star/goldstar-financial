
import { readFile } from "node:fs/promises";

test("MT5 EA is pinned to the immutable V5 preview URL", async () => {
  const source = await readFile(new URL("../mt5/GoldstarLocalBridgeEA.mq5", import.meta.url), "utf8");
  assert.match(source, /https:\/\/05931c07-trading-research-agent-staging\.goldstar-nsl83\.workers\.dev\/mt5\/snapshot/);
  assert.doesNotMatch(source, /mt5-readonly-v5-trading-research-agent-staging/);
});

import test from "node:test";
import assert from "node:assert/strict";
import worker from "../workers/trading-research-agent/src/worker.js";

function makeEnv({key="demo-bridge-secret",withDb=true,failBatch=false}={}) {
  const state={batches:[]};
  const DB=withDb?{
    prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this;}}},
    async batch(statements){if(failBatch)throw new Error("simulated D1 failure");state.batches.push(statements);return statements.map(()=>({success:true,meta:{changes:1}}));}
  }:undefined;
  return {state,env:{MT5_BRIDGE_KEY:key,DB}};
}
const account={
  login:"12345678",server:"AMarkets-Demo",currency:"USD",leverage:100,
  balance:1000,equity:1010,margin:10,free_margin:1000,margin_level:10100,
  terminal_connected:true,trade_allowed:true,terminal_version:"MetaTrader 5 build 5000",trade_mode:"DEMO"
};
const positions=[{ticket:"987654321",symbol:"EURUSD",type:"BUY",volume:0.1,price_open:1.08,price_current:1.081,stop_loss:1.07,take_profit:1.09,profit:1,swap:0,opened_at:"2026.11.08 09:00:00"}];
const ticks=[{symbol:"EURUSD",bid:1.0809,ask:1.081,last:1.08095,time_msc:1794128400000}];
function post(body,key="demo-bridge-secret") {
  return new Request("https://mt5-bridge.example/mt5/snapshot",{
    method:"POST",
    headers:{"content-type":"application/json","x-goldstar-mt5-key":key},
    body:JSON.stringify(body)
  });
}

test("health is public and identifies a demo-only read-only bridge",async()=>{
  const {env}=makeEnv({withDb:false});
  const response=await worker.fetch(new Request("https://mt5-bridge.example/health"),env);
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.mode,"demo_read_only");
});

test("snapshot endpoint rejects missing or invalid bridge authentication",async()=>{
  const {env,state}=makeEnv();
  const response=await worker.fetch(post({account,positions,ticks},"wrong-key"),env);
  assert.equal(response.status,401);
  assert.equal(state.batches.length,0);
});

test("snapshot endpoint rejects non-demo or disconnected terminals",async()=>{
  const {env,state}=makeEnv();
  const real=await worker.fetch(post({account:{...account,trade_mode:"REAL"},positions,ticks}),env);
  assert.equal(real.status,403);
  const disconnected=await worker.fetch(post({account:{...account,terminal_connected:false},positions,ticks}),env);
  assert.equal(disconnected.status,403);
  assert.equal(state.batches.length,0);
});

test("valid demo snapshot writes account, positions, and ticks in one D1 batch",async()=>{
  const {env,state}=makeEnv();
  const response=await worker.fetch(post({account,positions,ticks}),env);
  assert.equal(response.status,202);
  const body=await response.json();
  assert.equal(body.mode,"demo_read_only");
  assert.equal(body.positions,1);
  assert.equal(body.ticks,1);
  assert.equal(state.batches.length,1);
  const statements=state.batches[0];
  assert.equal(statements.length,3);
  assert.match(statements[0].sql,/INSERT INTO mt5_terminal_snapshots/);
  assert.match(statements[1].sql,/INSERT INTO mt5_positions/);
  assert.match(statements[2].sql,/INSERT INTO mt5_symbol_ticks/);
  assert.equal(statements[0].args[2],"12345678");
  assert.equal(JSON.stringify(statements[0].args).includes("demo-bridge-secret"),false);
});

test("invalid position and tick records are rejected before any database write",async()=>{
  const {env,state}=makeEnv();
  const badPosition=await worker.fetch(post({account,positions:[{...positions[0],type:"PENDING_ORDER"}],ticks}),env);
  assert.equal(badPosition.status,400);
  const badTick=await worker.fetch(post({account,positions,ticks:[{...ticks[0],bid:"not-a-number"}]}),env);
  assert.equal(badTick.status,400);
  assert.equal(state.batches.length,0);
});

test("snapshot request size is bounded and missing storage fails closed",async()=>{
  const {env}=makeEnv();
  const large=new Request("https://mt5-bridge.example/mt5/snapshot",{
    method:"POST",headers:{"content-type":"application/json","x-goldstar-mt5-key":"demo-bridge-secret"},
    body:JSON.stringify({account,positions,ticks,padding:"x".repeat(70000)})
  });
  const tooLarge=await worker.fetch(large,env);
  assert.equal(tooLarge.status,413);
  const missing=makeEnv({withDb:false});
  const unavailable=await worker.fetch(post({account,positions,ticks}),missing.env);
  assert.equal(unavailable.status,503);
});

test("no order or command execution endpoint exists",async()=>{
  const {env}=makeEnv();
  const response=await worker.fetch(new Request("https://mt5-bridge.example/v1/order",{method:"POST"}),env);
  assert.equal(response.status,404);
});
