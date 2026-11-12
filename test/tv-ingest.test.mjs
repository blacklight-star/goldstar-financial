import test from "node:test";
import assert from "node:assert/strict";
import worker from "../workers/tv-ingest/src/worker.js";

function makeEnv({secret="test-secret",changes=1,fail=false,withDb=true}={}) {
  const calls=[];
  const DB=withDb?{
    prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this;}}},
    async batch(statements){
      calls.push(statements);
      if(fail) throw new Error("simulated D1 failure");
      return [{meta:{changes}},{meta:{changes}}];
    }
  }:undefined;
  return {env:{TV_WEBHOOK_SECRET:secret,DB},calls};
}
const req=(path,method="GET",body,headers={})=>new Request("https://example.test"+path,{
  method,
  headers:{"content-type":"application/json",...headers},
  body:body===undefined?undefined:JSON.stringify(body)
});

test("health is public and reports the deployed source version",async()=>{
  const {env}=makeEnv({withDb:false});
  const response=await worker.fetch(req("/health"),env);
  assert.equal(response.status,200);
  assert.equal((await response.json()).version,"1.2.0");
});

test("unknown paths and methods are rejected",async()=>{
  const {env}=makeEnv();
  assert.equal((await worker.fetch(req("/other"),env)).status,404);
  assert.equal((await worker.fetch(req("/webhook"),env)).status,405);
});

test("invalid JSON and non-object JSON are rejected",async()=>{
  const {env}=makeEnv();
  const bad=await worker.fetch(new Request("https://example.test/webhook",{method:"POST",body:"{"}),env);
  assert.equal(bad.status,400);
  const arr=await worker.fetch(new Request("https://example.test/webhook",{method:"POST",body:"[]"}),env);
  assert.equal(arr.status,400);
});

test("missing or incorrect webhook token is rejected before database access",async()=>{
  const {env,calls}=makeEnv();
  const response=await worker.fetch(req("/webhook","POST",{symbol:"EURUSD",token:"wrong"}),env);
  assert.equal(response.status,401);
  assert.equal(calls.length,0);
});

test("oversized payload is rejected",async()=>{
  const {env}=makeEnv();
  const response=await worker.fetch(new Request("https://example.test/webhook",{
    method:"POST",headers:{"content-length":"40000"},body:"{}"
  }),env);
  assert.equal(response.status,413);
});

test("valid webhook writes raw and normalized records in one D1 batch without storing token",async()=>{
  const {env,calls}=makeEnv();
  const response=await worker.fetch(req("/webhook","POST",{
    token:"test-secret",event_id:"tv-100",symbol:"EURUSD",exchange:"OANDA",
    timeframe:"15",signal:"BUY",price:1.08
  }),env);
  assert.equal(response.status,202);
  const result=await response.json();
  assert.equal(result.accepted,true);
  assert.equal(result.duplicate,false);
  assert.equal(calls.length,1);
  assert.equal(calls[0].length,2);
  assert.match(calls[0][0].sql,/INSERT OR IGNORE INTO tv_events/);
  assert.match(calls[0][1].sql,/INSERT OR IGNORE INTO gs_market_events/);
  assert.equal(calls[0][0].args[7].includes("test-secret"),false);
  assert.equal(calls[0][1].args.length,1);
});

test("duplicate webhook is acknowledged but not counted as newly accepted",async()=>{
  const {env}=makeEnv({changes:0});
  const response=await worker.fetch(req("/webhook","POST",{
    token:"test-secret",event_id:"tv-100",symbol:"EURUSD"
  }),env);
  assert.equal(response.status,202);
  const result=await response.json();
  assert.equal(result.accepted,false);
  assert.equal(result.duplicate,true);
});

test("storage failures and missing D1 fail closed",async()=>{
  const failing=makeEnv({fail:true});
  const failure=await worker.fetch(req("/webhook","POST",{token:"test-secret",symbol:"EURUSD"}),failing.env);
  assert.equal(failure.status,503);
  const missing=makeEnv({withDb:false});
  const unavailable=await worker.fetch(req("/webhook","POST",{token:"test-secret",symbol:"EURUSD"}),missing.env);
  assert.equal(unavailable.status,503);
});
