import {parentPort,workerData} from 'node:worker_threads';
import {PineTS,Indicator} from 'pinets';
import {executionDiagnostic} from './diagnostics.js';
let phase='compile';
try {
  const {bars,source,settings,inputs,timeframe,symbol}=workerData;
  const indicator=new Indicator(source+'\nplot(strategy.equity, "__PineDesk_equity", display=display.none)',inputs);
  if(indicator.getDeclarationType()!=='strategy') throw new Error('Backtesting requires a strategy(...) script. Indicators can run on the chart.');
  const metadata=indicator.getInputsMeta();
  for(const [key,value] of Object.entries(inputs)){
    const matches=metadata.filter(item=>[item.title,item.id,item.varId].includes(key));
    if(!matches.length)throw new Error(`Unknown Pine input: ${key}. Use an input title or ID from the script.`);
    if(matches.length>1)throw new Error(`Ambiguous Pine input: ${key}. Use a unique input ID.`);
    const input=matches[0];
    if((input.type==='int'&&!Number.isInteger(value))||(input.type==='float'&&(typeof value!=='number'||!Number.isFinite(value)))||(input.type==='bool'&&typeof value!=='boolean')||(input.type==='string'&&typeof value!=='string'))throw new Error(`Invalid ${input.type} value for Pine input ${key}.`);
    if((input.minval!==undefined&&value<input.minval)||(input.maxval!==undefined&&value>input.maxval)||(Array.isArray(input.options)&&!input.options.includes(value)))throw new Error(`Pine input ${key} violates its declared bounds or options.`);
  }
  for(const [key,value] of Object.entries(settings)) indicator.prop[key]=value;
  const data=bars.map((b,i)=>({...b,openTime:b.time,closeTime:(bars[i+1]?.time??b.time+(bars[1].time-bars[0].time))-1}));
  phase='execution';
  const context=await new PineTS(data,symbol,timeframe).run(indicator);
  const s=context.strategy;
  if(!s) throw new Error('No strategy state returned.');
  const equity=(context.plots.__PineDesk_equity?.data??[]).map(p=>({time:p.time,value:p.value})).filter(p=>Number.isFinite(p.value));
  const grossProfit=s.closedtrades.reduce((sum,t)=>sum+Math.max(0,t.profit??0),0),grossLoss=s.closedtrades.reduce((sum,t)=>sum+Math.max(0,-(t.profit??0)),0);
  parentPort.postMessage({ok:true,result:{title:s.config.title,config:s.config,trades:s.closedtrades,openTrades:s.opentrades,equity,metrics:{netProfit:grossProfit-grossLoss,accountNetProfit:s.netprofit,openEntryCommission:s.opentrades.reduce((sum,t)=>sum+(t.commission??0),0),openProfit:s.openprofit,equity:s.equity,initialCapital:s.initial_capital,totalTrades:s.closedtrades.length,winRate:s.closedtrades.length?s.closedtrades.filter(t=>t.profit>0).length/s.closedtrades.length*100:0,maxDrawdown:s.max_drawdown,maxDrawdownPercent:s.max_drawdown_percent_value,profitFactor:grossLoss>0?grossProfit/grossLoss:null,grossProfit,grossLoss},warnings:context.warnings}});
} catch(error) {parentPort.postMessage({ok:false,error:error.message,diagnostic:executionDiagnostic(error,phase)});}
