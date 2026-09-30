import {Worker} from 'node:worker_threads';
import {validateBars,durations} from './data.js';
export function validateSource(source) {
  if(typeof source!=='string'||source.length>200000||!/^\s*\/\/@version=[56]\b/m.test(source)) throw new Error('Provide native Pine v5/v6 source (maximum 200 KB).');
  return source;
}
export function validateSettings(settings={}) {
  const bounds={initial_capital:[1,1e9],default_qty_value:[.01,100],commission_value:[0,10],slippage:[0,10000],pyramiding:[0,20]};
  for(const [key,value]of Object.entries(settings)){
    if(!bounds[key]||!Number.isFinite(value)||value<bounds[key][0]||value>bounds[key][1]||(['slippage','pyramiding'].includes(key)&&!Number.isInteger(value))) throw new Error(`Invalid strategy setting: ${key}`);
  }
  return {...settings,default_qty_type:'percent_of_equity',commission_type:'percent',process_orders_on_close:false};
}
export function runBacktest({bars,source,settings={},timeframe='1h',symbol='CSV',timeoutMs=30000}) {
  bars=validateBars(bars);source=validateSource(source);settings=validateSettings(settings);
  if(!durations[timeframe])throw new Error('Unsupported timeframe.');
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./backtest-worker.js',import.meta.url),{execArgv:[],workerData:{bars,source,settings,timeframe,symbol},resourceLimits:{maxOldGenerationSizeMb:512}});
    const timer=setTimeout(()=>{worker.terminate();reject(new Error('Script exceeded the 30-second execution limit.'));},timeoutMs);
    worker.once('message',msg=>{clearTimeout(timer);worker.terminate();msg.ok?resolve(msg.result):reject(new Error(msg.error));});
    worker.once('error',err=>{clearTimeout(timer);reject(err);});
    worker.once('exit',code=>{clearTimeout(timer);reject(new Error(`Script worker stopped without a result (${code}).`));});
  });
}
export function simulate(trades,{initialCapital=10000,paths=200,seed=42}={}) {
  if(!trades.length)throw new Error('Simulation requires closed trades.');
  if(!Number.isInteger(paths)||paths<1||paths>1000||!Number.isFinite(initialCapital)||initialCapital<=0||!Number.isInteger(seed))throw new Error('Invalid simulation settings.');
  let state=seed>>>0;
  const random=()=>{state=(1664525*state+1013904223)>>>0;return state/4294967296;};
  const outcomes=Array.from({length:paths},()=>{let equity=initialCapital,peak=equity,maxDrawdown=0;const curve=[equity];for(let i=0;i<trades.length;i++){equity+=trades[Math.floor(random()*trades.length)].profit;peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,peak-equity);curve.push(equity);}return {curve,profit:equity-initialCapital,maxDrawdown};});
  const sorted=outcomes.map(o=>o.profit).sort((a,b)=>a-b),q=p=>sorted[Math.floor((sorted.length-1)*p)];
  return {seed,paths,p05:q(.05),median:q(.5),p95:q(.95),lossProbability:outcomes.filter(o=>o.profit<0).length/paths,ruinProbability:outcomes.filter(o=>Math.min(...o.curve)<=0).length/paths,outcomes};
}
