const J={ "content-type":"application/json; charset=utf-8","cache-control":"no-store" };
const C="goldstar_cmc_admin", TTL=2592000;
const QURL="https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest";
const KURL="https://pro-api.coinmarketcap.com/v1/key/info";
function out(v,s=200,h={}){return new Response(JSON.stringify(v),{status:s,headers:{...J,...h}});}
function page(v,s=200,h={}){return new Response(v,{status:s,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer","content-security-policy":"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",...h}});}
function b64(a){let x="";for(const b of a)x+=String.fromCharCode(b);return btoa(x);}
function un64(x){const s=atob(x),a=new Uint8Array(s.length);for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i);return a;}
function url64(a){return b64(a).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");}
async function sha(x){const a=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(x)));return Array.from(a,b=>b.toString(16).padStart(2,"0")).join("");}
function getCookie(r){for(const p of (r.headers.get("cookie")||"").split(";")){const x=p.trim();if(x.startsWith(C+"="))return x.slice(C.length+1);}return "";}
async function auth(r,e){const v=getCookie(r);if(!v)return false;const n=Math.floor(Date.now()/1000);return Boolean(await e.VAULT_DB.prepare("UPDATE cmc_admin_sessions SET expires_at=? WHERE token_hash=? AND expires_at>? RETURNING token_hash").bind(n+TTL,await sha(v),n).first());}
async function readBody(r,max=8192){
  if(!r.body)throw Error("empty_body");
  const reader=r.body.getReader(),chunks=[];
  let total=0;
  try{
    while(true){
      const part=await reader.read();
      if(part.done)break;
      total+=part.value.byteLength;
      if(total>max){await reader.cancel();throw Error("body_too_large");}
      chunks.push(part.value);
    }
  }finally{try{reader.releaseLock();}catch{}}
  const bytes=new Uint8Array(total);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{
    const x=JSON.parse(new TextDecoder().decode(bytes));
    if(!x||typeof x!=="object"||Array.isArray(x))throw Error();
    return x;
  }catch{throw Error("invalid_json");}
}
async function aes(e){const k=un64(e.CREDENTIAL_VAULT_KEY);if(k.length!==32)throw Error("vault_key_invalid");return crypto.subtle.importKey("raw",k,{name:"AES-GCM"},false,["encrypt","decrypt"]);}
async function storeKey(e,k){const key=await aes(e),iv=crypto.getRandomValues(new Uint8Array(12)),ct=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(k));await e.VAULT_DB.prepare("INSERT INTO cmc_credentials(provider,ciphertext_b64,iv_b64,updated_at) VALUES('coinmarketcap',?,?,?) ON CONFLICT(provider) DO UPDATE SET ciphertext_b64=excluded.ciphertext_b64,iv_b64=excluded.iv_b64,updated_at=excluded.updated_at").bind(b64(new Uint8Array(ct)),b64(iv),Math.floor(Date.now()/1000)).run();}
async function readKey(e){const r=await e.VAULT_DB.prepare("SELECT ciphertext_b64,iv_b64 FROM cmc_credentials WHERE provider='coinmarketcap' LIMIT 1").first();if(!r)return null;const k=await aes(e),pt=await crypto.subtle.decrypt({name:"AES-GCM",iv:un64(r.iv_b64)},k,un64(r.ciphertext_b64));return new TextDecoder().decode(pt);}
async function validate(k){const r=await fetch(KURL,{headers:{"X-CMC_PRO_API_KEY":k,"Accept":"application/json"},signal:AbortSignal.timeout(15000)});let j;try{j=await r.json();}catch{throw Error("CMC_key_info_invalid_response");}if(!r.ok||j?.status?.error_code!==0)throw Error("CMC_key_invalid_"+String(j?.status?.error_code??r.status));}
async function fail(db,id,st,msg){try{await db.prepare("UPDATE cmc_ingestion_runs SET status='failed',provider_status=?,completed_at=?,error_message=? WHERE run_id=?").bind(Number.isInteger(st)?st:null,new Date().toISOString(),String(msg||"failed").slice(0,250),id).run();}catch{}}
async function ingest(e,key,symbols,currency){const id=crypto.randomUUID(),start=new Date().toISOString();let status=null;await e.MARKET_DB.prepare("INSERT INTO cmc_ingestion_runs(run_id,status,symbols,records_written,provider_status,started_at,completed_at,error_message) VALUES(?,'running',?,0,NULL,?,NULL,NULL)").bind(id,symbols.join(","),start).run();try{const u=new URL(QURL);u.searchParams.set("symbol",symbols.join(","));u.searchParams.set("convert",currency);const r=await fetch(u.toString(),{headers:{"X-CMC_PRO_API_KEY":key,"Accept":"application/json"},signal:AbortSignal.timeout(15000)});status=r.status;let j;try{j=await r.json();}catch{throw Error("CMC_non_json");}if(!r.ok||j?.status?.error_code!==0)throw Error("CMC_provider_error_"+String(j?.status?.error_code??r.status));const data=j?.data;if(!data||typeof data!=="object"||Array.isArray(data))throw Error("CMC_data_invalid");const at=new Date().toISOString(),stmts=[],found=new Set();for(const sym of symbols){const a=data[sym],coins=Array.isArray(a)?a:(a?[a]:[]);for(const c of coins){const q=c?.quote?.[currency];if(!c||!Number.isInteger(c.id)||typeof c.symbol!=="string"||typeof c.name!=="string"||!q||typeof q.last_updated!=="string"||!Number.isFinite(Date.parse(q.last_updated)))continue;found.add(sym);stmts.push(e.MARKET_DB.prepare("INSERT INTO cmc_quotes(cmc_id,symbol,name,quote_currency,price,volume_24h,market_cap,percent_change_1h,percent_change_24h,percent_change_7d,cmc_rank,quote_last_updated,ingested_at,raw_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(cmc_id,quote_currency,quote_last_updated) DO UPDATE SET symbol=excluded.symbol,name=excluded.name,price=excluded.price,volume_24h=excluded.volume_24h,market_cap=excluded.market_cap,percent_change_1h=excluded.percent_change_1h,percent_change_24h=excluded.percent_change_24h,percent_change_7d=excluded.percent_change_7d,cmc_rank=excluded.cmc_rank,ingested_at=excluded.ingested_at,raw_json=excluded.raw_json").bind(c.id,c.symbol.toUpperCase(),c.name,currency,Number.isFinite(q.price)?q.price:null,Number.isFinite(q.volume_24h)?q.volume_24h:null,Number.isFinite(q.market_cap)?q.market_cap:null,Number.isFinite(q.percent_change_1h)?q.percent_change_1h:null,Number.isFinite(q.percent_change_24h)?q.percent_change_24h:null,Number.isFinite(q.percent_change_7d)?q.percent_change_7d:null,Number.isInteger(c.cmc_rank)?c.cmc_rank:null,q.last_updated,at,JSON.stringify(c)));}}if(!stmts.length)throw Error("CMC_no_valid_quotes");const done=new Date().toISOString();stmts.push(e.MARKET_DB.prepare("UPDATE cmc_ingestion_runs SET status='success',provider_status=?,records_written=?,completed_at=?,error_message=NULL WHERE run_id=?").bind(status,stmts.length,done,id));await e.MARKET_DB.batch(stmts);return{ok:true,run_id:id,provider_status:status,symbols,missing_symbols:symbols.filter(s=>!found.has(s)),quote_currency:currency,records_written:stmts.length-1,completed_at:done};}catch(x){await fail(e.MARKET_DB,id,status,x.message);throw x;}}
const UI=[
"<!doctype html><html lang='fa' dir='rtl'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Goldstar CMC Staging</title>",
"<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:32px auto;padding:0 18px;background:#f7f8fa;color:#1f2937}main{background:white;border:1px solid #d8dee8;border-radius:14px;padding:22px}h1{font-size:22px}h2{font-size:17px;margin-top:28px}label{display:block;margin:14px 0 6px;font-weight:600}input{box-sizing:border-box;width:100%;padding:11px;border:1px solid #9ca3af;border-radius:8px;font-size:15px}button{margin-top:14px;padding:10px 18px;border:0;border-radius:8px;background:#1f4c7a;color:white;font-size:15px;cursor:pointer}button:disabled{opacity:.5}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f4f7;padding:12px;border-radius:8px;min-height:36px}.warning{border-right:4px solid #b7791f;padding:8px 12px;background:#fff8e8}</style><main>",
"<h1>Goldstar — CMC Staging</h1><p>این پنل فقط به D1 آزمایشی بازار متصل است. کلید CMC در مرورگر یا چت ذخیره نمی‌شود؛ در مخزن اختصاصی EU با AES-256-GCM رمزنگاری می‌شود.</p><div class='warning'>کلید را فقط در همین پنل وارد کن؛ آن را در چت، ایمیل یا GitHub قرار نده.</div>",
"<h2>ثبت یا جایگزینی کلید API</h2><label for='api'>CoinMarketCap API Key</label><input id='api' type='password' autocomplete='off' spellcheck='false'><button id='save'>اعتبارسنجی، ذخیره رمزنگاری‌شده و آزمایش BTC/USD</button>",
"<h2>دریافت داده</h2><label for='symbols'>نمادها (حداکثر ۲۰ مورد، جداشده با کاما)</label><input id='symbols' value='BTC,ETH'><label for='currency'>ارز مظنه</label><input id='currency' value='USD' maxlength='5'><button id='fetch'>دریافت و ثبت در D1 آزمایشی</button>",
"<h2>خروجی</h2><pre id='result'>در انتظار اقدام مالک.</pre><button id='logout'>خروج</button></main>",
"<script>const o=document.getElementById('result');async function post(p,b){const r=await fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});const d=await r.json().catch(()=>({ok:false,error:'invalid_response'}));o.textContent=JSON.stringify(d,null,2);return d;}document.getElementById('save').onclick=async()=>{const i=document.getElementById('api'),k=i.value.trim(),b=document.getElementById('save');if(!k){o.textContent='کلید API وارد نشده است.';return;}b.disabled=true;try{await post('/api/cmc/credential',{apiKey:k});}finally{i.value='';b.disabled=false;}};document.getElementById('fetch').onclick=async()=>{const symbols=document.getElementById('symbols').value.split(',').map(x=>x.trim().toUpperCase()).filter(Boolean),b=document.getElementById('fetch');b.disabled=true;try{await post('/api/cmc/quotes',{symbols,convert:document.getElementById('currency').value.trim().toUpperCase()});}finally{b.disabled=false;}};document.getElementById('logout').onclick=async()=>{await fetch('/api/logout',{method:'POST'});location.href='/';};</script></html>"
].join("");
async function bootstrapPage(e,u){
  const token=u.pathname.slice("/bootstrap/".length);
  if(token.length<32||token.includes("/"))return page("<h1>لینک نامعتبر است.</h1>",404);
  const now=Math.floor(Date.now()/1000);
  const row=await e.VAULT_DB.prepare(
    "SELECT token_hash FROM cmc_bootstrap_tokens WHERE token_hash=? AND consumed_at IS NULL AND expires_at>?"
  ).bind(await sha(token),now).first();
  if(!row)return page("<h1>لینک فعال‌سازی منقضی یا قبلاً استفاده شده است.</h1>",410);
  const safeToken=JSON.stringify(token);
  const body=[
    "<!doctype html><html lang='fa' dir='rtl'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>فعال‌سازی Goldstar CMC</title>",
    "<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 18px;background:#f7f8fa;color:#1f2937}main{background:white;border:1px solid #d8dee8;border-radius:14px;padding:24px}button{padding:12px 18px;border:0;border-radius:8px;background:#1f4c7a;color:white;font-size:16px}button:disabled{opacity:.5}p{line-height:1.8}pre{white-space:pre-wrap}</style><main>",
    "<h1>فعال‌سازی پنل CMC</h1><p>این لینک فقط پس از تأیید صریح شما مصرف می‌شود. بازدید یا پیش‌نمایش خودکار صفحه، لینک را باطل نمی‌کند.</p><button id='activate'>تأیید و ورود به پنل</button><p id='status' role='status'></p></main>",
    "<script>const token="+safeToken+";history.replaceState(null,'','/bootstrap/confirm');const b=document.getElementById('activate'),s=document.getElementById('status');b.addEventListener('click',async()=>{b.disabled=true;s.textContent='در حال فعال‌سازی...';try{const r=await fetch('/bootstrap/activate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})});if(r.redirected){location.replace(r.url);return;}s.textContent='فعال‌سازی ناموفق بود. کد HTTP: '+r.status; b.disabled=false;}catch(e){s.textContent='خطای ارتباط؛ صفحه را دوباره باز کنید.';b.disabled=false;}});</script></html>"
  ].join("");
  return page(body,200,{"referrer-policy":"no-referrer"});
}
async function activateBootstrap(r,e,u){
  if(r.headers.get("origin")!==u.origin)return out({ok:false,error:"origin_denied"},403);
  let x;
  try{x=await readBody(r,1024);}catch(z){return out({ok:false,error:z.message},400);}
  const token=typeof x.token==="string"?x.token:"";
  if(token.length<32||token.length>128)return out({ok:false,error:"invalid_bootstrap_token"},400);
  const now=Math.floor(Date.now()/1000);
  const consumed=await e.VAULT_DB.prepare(
    "UPDATE cmc_bootstrap_tokens SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL AND expires_at>? RETURNING token_hash"
  ).bind(now,await sha(token),now).first();
  if(!consumed)return page("<h1>لینک فعال‌سازی منقضی یا قبلاً استفاده شده است.</h1>",410);
  const session=url64(crypto.getRandomValues(new Uint8Array(32)));
  await e.VAULT_DB.prepare(
    "INSERT INTO cmc_admin_sessions(token_hash,created_at,expires_at) VALUES(?,?,?)"
  ).bind(await sha(session),now,now+TTL).run();
  return new Response(null,{status:303,headers:{
    "location":"/console","cache-control":"no-store","referrer-policy":"no-referrer",
    "set-cookie":C+"="+session+"; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age="+TTL
  }});
}
async function setCredential(r,e){let x;try{x=await readBody(r,4096);}catch(z){return out({ok:false,error:z.message},400);}const k=typeof x.apiKey==="string"?x.apiKey.trim():"";if(k.length<20||k.length>256||/\s/.test(k))return out({ok:false,error:"invalid_api_key_format"},400);try{await validate(k);}catch(z){return out({ok:false,error:"cmc_key_validation_failed",message:z.message.slice(0,140)},422);}try{await storeKey(e,k);}catch{return out({ok:false,error:"encrypted_credential_storage_failed"},500);}try{return out({ok:true,credential_validated:true,credential_stored_encrypted:true,test_ingestion:await ingest(e,k,["BTC"],"USD")});}catch(z){return out({ok:false,credential_validated:true,credential_stored_encrypted:true,test_ingestion_failed:true,message:z.message.slice(0,140)},502);}}
async function quotes(r,e){let x;try{x=await readBody(r);}catch(z){return out({ok:false,error:z.message},400);}if(Object.keys(x).some(k=>k!=="symbols"&&k!=="convert"))return out({ok:false,error:"unsupported_request_field"},400);if(!Array.isArray(x.symbols)||x.symbols.length<1||x.symbols.length>20)return out({ok:false,error:"symbols_must_be_array_of_1_to_20"},400);const a=x.symbols.map(v=>typeof v==="string"?v.trim().toUpperCase():"");if(a.some(v=>!/^[A-Z0-9]{1,12}$/.test(v))||new Set(a).size!==a.length)return out({ok:false,error:"invalid_or_duplicate_symbols"},400);const c=x.convert===undefined?"USD":typeof x.convert==="string"?x.convert.trim().toUpperCase():"";if(!/^[A-Z]{3,5}$/.test(c))return out({ok:false,error:"invalid_convert_currency"},400);let k;try{k=await readKey(e);}catch{return out({ok:false,error:"credential_decryption_failed"},500);}if(!k)return out({ok:false,error:"cmc_credential_not_configured"},503);try{return out(await ingest(e,k,a,c));}catch(z){return out({ok:false,error:"cmc_ingestion_failed",message:z.message.slice(0,150)},502);}}
export default{async fetch(r,e){const u=new URL(r.url);if(u.pathname==="/health"&&r.method==="GET")return out({ok:true,service:"goldstar-cmc-ingest-staging",market_db_configured:Boolean(e.MARKET_DB&&e.MARKET_DB.prepare),vault_db_configured:Boolean(e.VAULT_DB&&e.VAULT_DB.prepare),encryption_key_configured:Boolean(e.CREDENTIAL_VAULT_KEY),credential_vault:"AES-256-GCM; isolated EU D1"});if(u.pathname.startsWith("/bootstrap/")&&r.method==="GET"){try{return await bootstrapPage(e,u);}catch{return out({ok:false,error:"bootstrap_failed"},500);}}if(u.pathname==="/bootstrap/activate"&&r.method==="POST"){try{return await activateBootstrap(r,e,u);}catch{return out({ok:false,error:"bootstrap_activation_failed"},500);}}if(u.pathname==="/console"&&r.method==="GET"){if(!(await auth(r,e)))return page("<h1>نشست معتبر نیست؛ لینک فعال‌سازی یک‌بارمصرف لازم است.</h1>",401);return page(UI);}if(u.pathname.startsWith("/api/")&&r.method==="POST"){if(r.headers.get("origin")!==u.origin)return out({ok:false,error:"origin_denied"},403);if(!(await auth(r,e)))return out({ok:false,error:"session_required"},401);if(u.pathname==="/api/cmc/credential")return setCredential(r,e);if(u.pathname==="/api/cmc/quotes")return quotes(r,e);if(u.pathname==="/api/logout"){const s=getCookie(r);if(s)await e.VAULT_DB.prepare("DELETE FROM cmc_admin_sessions WHERE token_hash=?").bind(await sha(s)).run();return out({ok:true},200,{"set-cookie":C+"=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"});}}return out({ok:false,error:"not_found"},404);}};