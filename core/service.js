import {watchlistQuotes} from './watchlist.js';
import {uiConfig,configureUI,importScriptFile,saveLayout,listLayouts,readLayout,deleteLayout} from './workspace-ui.js';
import {randomUUID} from 'node:crypto';
import {demoBars,fetchBinance,parseCSV,durations,validateBars,validateTrades} from './data.js';
import {examples} from './examples.js';
import {runBacktest,simulate,validateSource} from './backtest.js';
import {orderflow} from './orderflow.js';
import {libraryCall} from './library.js';
import {configureEdge,edgeConfig,edgeOverview,edgeCall} from './edge-stats.js';
import {whaleConfig,configureWhale,whaleCall} from './whale-options.js';
import {UnusualWhales} from './unusual-whales.js';
import {credentialStatus,saveCredentials} from './credentials.js';
import {WhaleRunner,engineConfig,configureEngine} from './whale-runner.js';
import {BinanceLive} from './live.js';
import {ResearchJobs,compareRuns} from './research.js';
import * as store from './store.js';
let liveWrite=Promise.resolve();
export const live=new BinanceLive({onClosed:dataset=>{const snapshot=structuredClone(dataset);liveWrite=liveWrite.catch(()=>{}).then(()=>store.write('bars',snapshot));liveWrite.catch(error=>console.warn('Could not persist settled live candles:',error.message));}});
export const optionsProvider=new UnusualWhales();
export const whaleRunner=new WhaleRunner();
export const researchJobs=new ResearchJobs();
export function shutdown(){live.stop();researchJobs.stop();optionsProvider.stop();whaleRunner.stop();}
async function datasetFor(args){return structuredClone(args.dataset??(live.active?live.snapshot().dataset:null)??await store.read('bars')??{bars:demoBars(),symbol:'DEMO',timeframe:'1h',origin:'Synthetic demonstration'});}
export async function dispatch(action,args={}) {
  switch(action){
    case 'watchlistQuotes':return watchlistQuotes(args.symbols);
    case 'uiConfig':return uiConfig();
    case 'uiConfigure':return configureUI(args);
    case 'importScriptFile':{const script=importScriptFile(args);return store.write('scripts',script,script.id);}
    case 'layoutSave':return saveLayout(args);
    case 'layoutList':return listLayouts();
    case 'layoutRead':return readLayout(args.id);
    case 'layoutActivate':{const saved=await readLayout(args.id);live.stop();optionsProvider.stop();await liveWrite;if(saved.snapshot.dataset){saved.snapshot.dataset={...saved.snapshot.dataset,origin:'Saved layout • '+saved.snapshot.dataset.origin};await store.write('bars',saved.snapshot.dataset);}return saved;}
    case 'layoutDelete':return deleteLayout(args.id);
    case 'workspace':return {dataset:await store.read('bars')??{bars:demoBars(),symbol:'DEMO',timeframe:'1h',origin:'Synthetic demonstration'},scripts:[...examples,...await store.list('scripts')],runs:(await store.list('runs')).sort((a,b)=>b.createdAt-a.createdAt).slice(0,30),savedStudies:(await store.list('research-index')).sort((a,b)=>b.createdAt-a.createdAt).slice(0,20).map(({id,kind,status,createdAt})=>({id,kind,status:status==='running'?(researchJobs.jobs.get(id)?.status??'unavailable'):status,createdAt})),dataDir:store.dataDir};
    case 'loadMarket':{live.stop();await liveWrite;const bars=await fetchBinance(args);return store.write('bars',{bars,symbol:args.symbol,timeframe:args.timeframe,origin:'Binance • closed candles',loadedAt:Date.now()});}
    case 'importBars':{live.stop();await liveWrite;if(!durations[args.timeframe])throw new Error('Unsupported timeframe.');return store.write('bars',{bars:args.csv?parseCSV(args.csv):validateBars(args.bars),symbol:String(args.symbol||'CSV').slice(0,40),timeframe:args.timeframe,origin:'Imported OHLCV',loadedAt:Date.now()});}
    case 'saveScript':{const source=validateSource(args.source),id=args.id??randomUUID();const script={id,name:String(args.name||'Untitled').slice(0,100),source,provenance:args.provenance??null,updatedAt:Date.now()};return store.write('scripts',script,id);}
    case 'backtest':{const dataset=await datasetFor(args);const result=await runBacktest({...dataset,source:args.source,settings:args.settings,inputs:args.inputs});const run={id:randomUUID(),createdAt:Date.now(),source:args.source,settings:args.settings??{},inputs:args.inputs??{},dataset,result};await store.write('runs',run,run.id);return run;}
    case 'liveStart':return live.start(args);
    case 'liveSnapshot':return live.snapshot();
    case 'liveStop':{const snapshot=live.stop();await liveWrite;return snapshot;}
    case 'liveFlow':return live.flow(args);
    case 'liveSaveTrades':return store.write('trades',live.tradeSnapshot());
    case 'researchStart':return researchJobs.start({...args,dataset:await datasetFor(args)});
    case 'researchGet':return researchJobs.get(args.id);
    case 'researchCancel':return researchJobs.cancel(args.id);
    case 'compareRuns':{if(!Array.isArray(args.ids)||new Set(args.ids).size!==args.ids.length)throw new Error('Choose distinct saved runs.');const runs=await Promise.all(args.ids.map(id=>store.read('runs',id)));if(runs.some(run=>!run))throw new Error('Saved run not found.');return compareRuns(runs);}
    case 'researchSaveRun':{
      const job=await researchJobs.get(args.id);if(job.status!=='completed')throw new Error('Study must complete before saving a run.');
      const r=job.result;let result,inputs,dataset=r.dataset;
      if(r.kind==='sweep'){const candidate=r.candidates.find(c=>c.index===args.index);if(!candidate?.result)throw new Error('Choose a completed candidate.');result=candidate.result;inputs=candidate.inputs;}
      else{const fold=r.folds.find(f=>f.index===args.fold);if(!fold)throw new Error('Choose an existing fold.');result=fold.testResult;inputs=fold.inputs;dataset={...dataset,bars:dataset.bars.slice(fold.window.testStart,fold.window.testEnd)};}
      const run={id:randomUUID(),createdAt:Date.now(),source:r.source,settings:r.settings,inputs:{...r.inputs,...inputs},dataset,result,researchId:job.id};return store.write('runs',run,run.id);
    }
    case 'simulate':return simulate(args.trades,args.options);
    case 'importTrades':return store.write('trades',{trades:args.csv?parseCSV(args.csv,'trades'):validateTrades(args.trades),symbol:String(args.symbol||'CSV').slice(0,40),importedAt:Date.now()});
    case 'orderflow':{const stored=await store.read('trades');if(!stored)throw new Error('Import trade CSV first. OHLCV candles do not contain aggressor-side data.');return {...orderflow(stored.trades,args),symbol:stored.symbol};}
    case 'libraryList':return libraryCall('library_list_indicators',{page:args.page??0,page_size:24,...args});
    case 'librarySearch':return libraryCall('library_search',{query:args.query,type:'indicators',limit:24});
    case 'librarySource':return libraryCall('library_get_source_code',{slug:args.slug});
    case 'libraryDetail':return libraryCall('library_get_indicator',{slug:args.slug});
    case 'edgeConfig':return edgeConfig();
    case 'edgeConfigure':return configureEdge(args);
    case 'edgeOverview':return edgeOverview();
    case 'edgeCoverage':return edgeCall('coverage');
    case 'edgePresets':return edgeCall('presets',args);
    case 'edgeReport':return edgeCall('report',args);
    case 'edgeQuery':return edgeCall('query',args);
    case 'edgeFields':return edgeCall('fields',args);
    case 'edgeSessions':return edgeCall('sessions',args);
    case 'edgeSessionBars':return edgeCall('sessionBars',args);
    case 'providerSettings':return {credentials:await credentialStatus(),engine:await engineConfig(),engineStatus:whaleRunner.status(),whale:await whaleConfig()};
    case 'saveCredentials':return saveCredentials(args);
    case 'engineConfigure':return configureEngine(args);
    case 'engineStart':return whaleRunner.start();
    case 'engineStop':return whaleRunner.stop();
    case 'optionsRefresh':return optionsProvider.refresh(args);
    case 'optionsStart':return optionsProvider.start(args);
    case 'optionsStop':return optionsProvider.stop();
    case 'optionsSnapshot':return optionsProvider.snapshot();
    case 'whaleConfig':return whaleConfig();
    case 'whaleConfigure':return configureWhale(args);
    case 'whaleStatus':return whaleCall('status');
    case 'whaleRecent':return whaleCall('recent',args);
    case 'whaleTop':return whaleCall('top',args);
    case 'whaleEvent':return whaleCall('event',args);
    case 'whaleGex':return whaleCall('gex',args);
    case 'whaleOiDeltas':return whaleCall('oiDeltas',args);
    case 'whaleMaxPain':return whaleCall('maxPain',args);
    case 'whaleIvRank':return whaleCall('ivRank',args);
    case 'whaleNetFlow':return whaleCall('netFlow',args);
    default:throw new Error('Unknown app operation.');
  }
}
