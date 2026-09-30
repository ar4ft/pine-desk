import {randomUUID} from 'node:crypto';
import {runBacktest,validateSource,validateSettings,validateInputs} from './backtest.js';
import {validateBars,durations} from './data.js';
import * as store from './store.js';
export function parameterGrid(grid){
  if(!grid||typeof grid!=='object'||Array.isArray(grid)||!Object.keys(grid).length||Object.keys(grid).length>6)throw new Error('Grid must contain 1–6 input names with candidate arrays.');
  let rows=[{}];
  for(const [key,values] of Object.entries(grid)){
    if(!Array.isArray(values)||!values.length||values.length>25)throw new Error(`Provide 1–25 candidates for ${key}.`);
    const unique=[...new Set(values)];for(const value of unique)validateInputs({[key]:value});
    if(rows.length*unique.length>25)throw new Error('Grid is limited to 25 combinations.');
    rows=rows.flatMap(row=>unique.map(value=>({...row,[key]:value})));
  }
  return rows;
}
export function walkForwardWindows(length,{trainBars=200,testBars=100,folds=3}={}){
  if(![trainBars,testBars,folds].every(Number.isInteger)||trainBars<20||testBars<10||folds<1||folds>10)throw new Error('Use at least 20 training bars, 10 test bars, and 1–10 folds.');
  if(trainBars+testBars*folds>length)throw new Error('Not enough settled candles for these train/test windows. Reduce windows or import more history.');
  // Rolling training window; disjoint tests move strictly forward, starting at bar zero.
  return Array.from({length:folds},(_,i)=>({trainStart:i*testBars,trainEnd:i*testBars+trainBars,testStart:i*testBars+trainBars,testEnd:i*testBars+trainBars+testBars}));
}
export function rankCandidates(candidates,objective='netProfit'){
  if(!['netProfit','maxDrawdown'].includes(objective))throw new Error('Choose netProfit (maximize) or maxDrawdown (minimize).');
  return [...candidates].filter(c=>c.result?.metrics.totalTrades>0).sort((a,b)=>{
    const difference=a.result.metrics[objective]-b.result.metrics[objective];
    return (objective==='maxDrawdown'?difference:-difference)||a.index-b.index;
  });
}
export function validateResearchRequest(input){
  const dataset={...input.dataset,bars:validateBars(input.dataset?.bars)};
  if(!durations[dataset.timeframe])throw new Error('Unsupported research timeframe.');
  if(dataset.candleGaps?.length)throw new Error('Research requires continuous candle coverage. Reload or import a complete dataset.');
  const step=durations[dataset.timeframe];
  if(dataset.bars.some((bar,index)=>index&&bar.time-dataset.bars[index-1].time!==step))throw new Error('Research requires contiguous fixed-timeframe candles.');
  const source=validateSource(input.source),settings=input.settings??{},inputs=validateInputs(input.inputs??{});
  validateSettings(settings);
  const combinations=parameterGrid(input.grid),objective=input.objective??'netProfit';rankCandidates([],objective);
  if(!['sweep','walkForward'].includes(input.kind))throw new Error('Choose a parameter sweep or walk-forward study.');
  const windows=input.kind==='walkForward'?walkForwardWindows(dataset.bars.length,input.windows):[];
  const executions=windows.length?windows.length*(combinations.length+1):combinations.length;
  if(executions>100)throw new Error('Study is limited to 100 strategy executions.');
  return {kind:input.kind,dataset,source,settings,inputs,grid:input.grid,objective,combinations,windows,executions};
}
export class ResearchJobs {
  constructor({runner=runBacktest,persist=async job=>{await store.write('research',job,job.id);await store.write('research-index',{id:job.id,kind:job.kind,status:job.status,createdAt:job.createdAt},job.id);},timeoutMs=180000}={}){this.runner=runner;this.persist=persist;this.timeoutMs=timeoutMs;this.jobs=new Map();}
  start(input){
    if([...this.jobs.values()].some(job=>job.status==='running'))throw new Error('One research study can run at a time. Cancel or wait for the current study.');
    const request=validateResearchRequest(input),job={id:randomUUID(),createdAt:Date.now(),updatedAt:Date.now(),kind:request.kind,status:'running',completed:0,total:request.executions,request,result:null,error:null};
    this.jobs.set(job.id,job);const controller=new AbortController();job.controller=controller;
    this.execute(job).catch(error=>{job.status='failed';job.error=error.message;});
    return this.view(job);
  }
  view(job){const {controller,request,...visible}=job;return visible;}
  async get(id){const job=this.jobs.get(id);if(job)return this.view(job);const saved=await store.read('research',id);if(!saved)throw new Error('Research study not found.');if(saved.status==='running'){saved.status='unavailable';saved.error='This process cannot monitor the active study. It may still be running in another desktop/MCP process or may have been interrupted. Check its owner before starting a new study.';}return saved;}
  async cancel(id){const job=this.jobs.get(id);if(!job)throw new Error('No active study with that ID.');if(job.status==='running')job.controller.abort();return this.view(job);}
  stop(){for(const job of this.jobs.values())if(job.status==='running')job.controller.abort();}
  async execute(job){
    const {request:r,controller}=job,signal=controller.signal;
    const timer=setTimeout(()=>{job.timedOut=true;controller.abort();},this.timeoutMs);timer.unref?.();
    const progress=()=>{job.updatedAt=Date.now();};
    const run=async(dataset,inputs)=>{
      if(signal.aborted)throw new Error('Research job cancelled.');
      const result=await this.runner({...dataset,source:r.source,settings:r.settings,inputs:{...r.inputs,...inputs},signal});
      if(signal.aborted)throw new Error('Research job cancelled.');job.completed++;progress();return result;
    };
    try{
      await this.persist({...this.view(job),request:r});
      const candidates=async dataset=>{
        const cases=[];
        for(let index=0;index<r.combinations.length;index++){
          const inputs=r.combinations[index];
          try{cases.push({index,inputs,result:await run(dataset,inputs)});}catch(error){if(signal.aborted)throw error;job.completed++;progress();cases.push({index,inputs,error:error.message,diagnostic:error.diagnostic??null});}
        }
        return cases;
      };
      if(r.kind==='sweep'){
        const cases=await candidates(r.dataset),ranking=rankCandidates(cases,r.objective);
        job.result={...r,candidates:cases,bestIndex:ranking[0]?.index??null,ranking:ranking.map(c=>c.index),note:'In-sample optimization. Ranking excludes failed and zero-closed-trade cases. No holdout was used.'};
      }else{
        const folds=[];
        for(const [index,window] of r.windows.entries()){
          const train={...r.dataset,bars:r.dataset.bars.slice(window.trainStart,window.trainEnd)},test={...r.dataset,bars:r.dataset.bars.slice(window.testStart,window.testEnd)};
          const training=await candidates(train),best=rankCandidates(training,r.objective)[0];
          if(!best)throw new Error(`Fold ${index+1}: no valid training candidate with closed trades. Nothing was selected using test data.`);
          const testResult=await run(test,best.inputs);
          folds.push({index,window,trainFrom:train.bars[0].time,trainTo:train.bars.at(-1).time,testFrom:test.bars[0].time,testTo:test.bars.at(-1).time,inputs:best.inputs,training:training.map(({index,inputs,result,error})=>({index,inputs,metrics:result?.metrics??null,error})),trainingMetrics:best.result.metrics,testResult});
          job.foldPreview=folds.map(f=>({index:f.index,inputs:f.inputs,testMetrics:f.testResult.metrics}));
        }
        job.result={...r,folds,totalClosedNetProfit:folds.reduce((sum,f)=>sum+f.testResult.metrics.netProfit,0),totalClosedTrades:folds.reduce((sum,f)=>sum+f.testResult.metrics.totalTrades,0),unusedBars:r.dataset.bars.length-r.windows.at(-1).testEnd,note:'Parameters selected on training windows only. Test windows are disjoint and reset capital, indicators and positions, with no pre-test warmup. Open trades are reported, not force-closed. Sum of closed test P&L is descriptive; it is not a compounded continuous portfolio.'};
      }
      job.status='completed';
    }catch(error){job.status=signal.aborted?(job.timedOut?'timedOut':'cancelled'):'failed';job.error=job.timedOut?'Research exceeded the 180-second study limit.':error.message;job.diagnostic=error.diagnostic??null;}
    finally{clearTimeout(timer);progress();await this.persist({...this.view(job),request:r});
      // Bound process memory; completed studies remain on disk.
      const completed=[...this.jobs.values()].filter(j=>j.status!=='running');for(const old of completed.slice(0,-5))this.jobs.delete(old.id);
    }
  }
}
export function compareRuns(runs){
  if(!Array.isArray(runs)||runs.length<2||runs.length>6)throw new Error('Select 2–6 saved runs.');
  const signature=run=>JSON.stringify({symbol:run.dataset.symbol,timeframe:run.dataset.timeframe,bars:run.dataset.bars});
  const sameData=runs.every(run=>signature(run)===signature(runs[0]));
  return {sameData,note:sameData?'Same candle dataset. Inputs, costs and capital can still differ.':'Different datasets or markets: compare descriptive results, not a controlled strategy experiment.',runs:runs.map(run=>({id:run.id,title:run.result.title,symbol:run.dataset.symbol,timeframe:run.dataset.timeframe,from:run.dataset.bars[0].time,to:run.dataset.bars.at(-1).time,inputs:run.inputs??{},settings:run.settings,effectiveSettings:run.result.config,metrics:run.result.metrics,openPositions:run.result.openTrades.length,equity:run.result.equity.map(point=>({time:point.time,value:(point.value/run.result.metrics.initialCapital-1)*100}))}))};
}
