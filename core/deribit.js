import WebSocket from 'ws';
import {HttpsProxyAgent} from 'https-proxy-agent';
const origin='https://www.deribit.com/api/v2';
export const finite=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
function currencyOf(currency){if(!['BTC','ETH'].includes(currency))throw new Error('Choose BTC or ETH inverse options.');return currency;}
export async function publicRequest(method,params={},signal){
  const url=new URL(`${origin}/public/${method}`);for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
  const response=await fetch(url,{redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`Deribit HTTP ${response.status}. Check regional access and public API limits.`);
  const body=await response.json();if(body.error)throw new Error(`Deribit: ${body.error.message??body.error.code}`);
  if(body.result===undefined)throw new Error('Deribit response has no result.');return body.result;
}
export function normalizeChain(currency,instruments,summaries,now=Date.now()){
  currencyOf(currency);if(!Array.isArray(instruments)||!Array.isArray(summaries))throw new Error('Invalid Deribit chain response.');
  const quotes=new Map(summaries.map(row=>[row.instrument_name,row]));
  return instruments.filter(i=>i.kind==='option'&&i.is_active&&i.instrument_type==='reversed'&&i.base_currency===currency&&i.settlement_currency===currency&&i.expiration_timestamp>now).map(i=>{
    const s=quotes.get(i.instrument_name)??{};
    return {instrument:i.instrument_name,type:i.option_type,strike:finite(i.strike),expiry:i.expiration_timestamp,contractSize:finite(i.contract_size),currency,
      bid:finite(s.bid_price),ask:finite(s.ask_price),mark:finite(s.mark_price),iv:finite(s.mark_iv),oi:finite(s.open_interest),volume:finite(s.volume),underlying:finite(s.underlying_price),quoteAt:finite(s.creation_timestamp)};
  }).filter(r=>r.strike>0&&['call','put'].includes(r.type)).sort((a,b)=>a.expiry-b.expiry||a.strike-b.strike||a.type.localeCompare(b.type));
}
export function termStructure(rows,spot,now){
  const result=[];if(!(spot>0))return result;
  for(const expiry of [...new Set(rows.map(r=>r.expiry))].sort((a,b)=>a-b)){
    const valid=rows.filter(r=>r.expiry===expiry&&r.iv>0&&Math.abs(r.strike/spot-1)<=.1);
    if(!valid.length)continue;const strike=valid.reduce((best,r)=>Math.abs(r.strike-spot)<Math.abs(best-spot)?r.strike:best,valid[0].strike);
    const atm=valid.filter(r=>r.strike===strike),iv=atm.reduce((s,r)=>s+r.iv,0)/atm.length;
    const years=(expiry-now)/(365*86400000);if(years<=0)continue;
    const previous=result.at(-1);let forwardIV=null,forwardReason='First expiry has no prior interval.';
    if(previous){const variance=((iv/100)**2*years-(previous.iv/100)**2*previous.years)/(years-previous.years);if(variance>0){forwardIV=Math.sqrt(variance)*100;forwardReason=null;}else forwardReason='Non-positive forward variance; value withheld.';}
    result.push({expiry,days:years*365,years,strike,iv,observations:atm.length,forwardIV,forwardReason});
  }return result;
}
export function normalizeTrade(t,currency){
  const time=finite(t.timestamp),amount=finite(t.amount),price=finite(t.price),index=finite(t.index_price);
  if(!t.trade_id||!String(t.instrument_name).startsWith(currency+'-')||!time||!(amount>0)||!(price>=0))return null;
  return {id:String(t.trade_id),instrument:t.instrument_name,time,amount,price,index,iv:finite(t.iv),side:['buy','sell'].includes(t.direction)?t.direction:'unknown',premiumUSD:index>0?price*amount*index:null,currency};
}
export class DeribitOptions{
  constructor({request=publicRequest,createSocket,now=Date.now,clock=globalThis}={}){
    this.request=request;this.now=now;this.clock=clock;this.generation=0;this.state={status:'idle',rows:[],trades:[],gaps:[]};
    this.createSocket=createSocket??(url=>new WebSocket(url,{...(process.env.HTTPS_PROXY?{agent:new HttpsProxyAgent(process.env.HTTPS_PROXY)}:{}),handshakeTimeout:15000,maxPayload:2_000_000}));
  }
  snapshot(){return structuredClone({...this.state,active:!!this.active});}
  stop(){this.generation++;this.active=false;this.abort?.abort();this.socket?.terminate();this.socket=null;this.clock.clearTimeout(this.retryTimer);this.clock.clearTimeout(this.ackTimer);this.clock.clearInterval(this.watchdog);this.state.status=this.state.rows.length?'snapshot':'idle';return this.snapshot();}
  async refresh({currency='BTC'}={}){
    currencyOf(currency);this.stop();const generation=this.generation;this.abort=new AbortController();this.state.status='loading';
    try{
      const [instruments,summaries,index,trades]=await Promise.all([
        this.request('get_instruments',{currency,kind:'option',expired:false},this.abort.signal),
        this.request('get_book_summary_by_currency',{currency,kind:'option'},this.abort.signal),
        this.request('get_index_price',{index_name:currency.toLowerCase()+'_usd'},this.abort.signal),
        this.request('get_last_trades_by_currency',{currency,kind:'option',count:100},this.abort.signal)]);
      if(generation!==this.generation)throw new Error('Deribit refresh cancelled.');
      const spot=finite(index.index_price);if(!(spot>0))throw new Error('Deribit index price is missing.');
      const fetchedAt=this.now(),rows=normalizeChain(currency,instruments,summaries,fetchedAt);
      if(!rows.length)throw new Error('No active inverse option instruments returned.');
      this.state={status:'snapshot',currency,spot,fetchedAt,rows,term:termStructure(rows,spot,fetchedAt),trades:(trades.trades??[]).map(t=>normalizeTrade(t,currency)).filter(Boolean).sort((a,b)=>a.time-b.time).slice(-100),tradesHasMore:!!trades.has_more,
        tradeCoverage:'Latest 100 requested trades across all expiries; not a complete session or 24-hour history.',ticker:null,instrument:null,gaps:[],error:null,lastMessageAt:null,
        coverage:'Full REST instrument/summary snapshot; live Greeks cover one selected contract. Chain, IV curves and index remain snapshots until Refresh.'};
      return this.snapshot();
    }catch(e){if(generation===this.generation){this.abort.abort();this.state.status='error';this.state.error=e.message;}throw e;}
  }
  async select({instrument}={}){
    if(!this.state.rows.some(r=>r.instrument===instrument))throw new Error('Select a contract from the loaded Deribit chain.');
    this.stop();const generation=this.generation;this.abort=new AbortController();
    const ticker=await this.request('ticker',{instrument_name:instrument},this.abort.signal);
    if(generation!==this.generation)throw new Error('Contract selection cancelled.');
    if(ticker.instrument_name!==instrument||!Number.isFinite(ticker.timestamp))throw new Error('Invalid Deribit ticker response.');
    this.state.instrument=instrument;this.state.ticker=null;this.updateTicker(ticker);return this.snapshot();
  }
  updateTicker(ticker){
    if(ticker.instrument_name!==this.state.instrument||!Number.isFinite(ticker.timestamp))return;
    if(this.state.ticker?.timestamp>ticker.timestamp)return;
    this.state.ticker={instrument:ticker.instrument_name,timestamp:ticker.timestamp,mark:finite(ticker.mark_price),bid:finite(ticker.best_bid_price),ask:finite(ticker.best_ask_price),iv:finite(ticker.mark_iv),index:finite(ticker.index_price),underlying:finite(ticker.underlying_price),oi:finite(ticker.open_interest),greeks:Object.fromEntries(['delta','gamma','vega','theta','rho'].map(k=>[k,finite(ticker.greeks?.[k])]))};
  }
  start(){
    if(!this.state.instrument||!this.state.ticker)throw new Error('Load a contract ticker before starting live.');
    this.stop();this.active=true;this.state.lastMessageAt=null;this.connectedAt=this.now();this.retries=0;const generation=this.generation;
    this.watchdog=this.clock.setInterval(()=>{if(this.active&&this.now()-(this.state.lastMessageAt??this.connectedAt??this.now())>45000){this.state.error='Deribit connection heartbeat stalled.';this.socket?.terminate();}},10000);this.watchdog?.unref?.();
    this.connect(generation);return this.snapshot();
  }
  connect(generation){
    if(!this.active||generation!==this.generation)return;this.state.status='connecting';let socket;
    try{socket=this.createSocket('wss://www.deribit.com/ws/api/v2');}catch(e){this.state.error=e.message;this.retry(generation);return;}
    this.socket=socket;const current=()=>this.active&&generation===this.generation&&this.socket===socket;
    const channels=[`ticker.${this.state.instrument}.100ms`,`trades.option.${this.state.currency}.100ms`];
    const send=(id,method,params)=>socket.send(JSON.stringify({jsonrpc:'2.0',id,method,params}));
    socket.on('open',()=>{if(!current())return;this.connectedAt=this.now();this.state.lastMessageAt=this.now();send(1,'public/subscribe',{channels});send(2,'public/set_heartbeat',{interval:20});this.ackTimer=this.clock.setTimeout(()=>{if(current()&&this.state.status!=='streaming'){this.state.error='Deribit subscription was not acknowledged.';socket.terminate();}},20000);this.ackTimer?.unref?.();});
    socket.on('message',raw=>{
      if(!current())return;this.state.lastMessageAt=this.now();
      try{
        const m=JSON.parse(String(raw));if(m.error)throw new Error(`Deribit: ${m.error.message??m.error.code}`);
        if(m.id===1){if(!Array.isArray(m.result)||!channels.every(c=>m.result.includes(c)))throw new Error('Deribit did not acknowledge every channel.');this.clock.clearTimeout(this.ackTimer);this.state.status='streaming';this.state.error=null;this.retries=0;}
        if(m.method==='heartbeat'&&m.params?.type==='test_request')send(3,'public/test',{});
        if(m.method==='subscription'){
          if(m.params.channel===channels[0])this.updateTicker(m.params.data);
          if(m.params.channel===channels[1]&&Array.isArray(m.params.data)){
            const byId=new Map(this.state.trades.map(t=>[t.id,t]));for(const item of m.params.data){const t=normalizeTrade(item,this.state.currency);if(t)byId.set(t.id,t);}
            this.state.trades=[...byId.values()].sort((a,b)=>a.time-b.time).slice(-1000);
          }
        }
      }catch(e){this.state.error=e.message;socket.terminate();}
    });
    socket.on('error',e=>{if(current())this.state.error=`Deribit stream: ${e.message}`;});
    socket.on('close',()=>{if(!current())return;this.clock.clearTimeout(this.ackTimer);this.state.gaps.push({at:this.now(),reason:'Disconnected; missed option trades are not replayed. Selected Greeks retain their source timestamp.'});this.state.gaps=this.state.gaps.slice(-50);this.retry(generation);});
  }
  retry(generation){if(!this.active||generation!==this.generation)return;this.state.status='reconnecting';this.retryTimer=this.clock.setTimeout(()=>this.connect(generation),Math.min(30000,1000*2**Math.min(this.retries++,5)));this.retryTimer?.unref?.();}
}
