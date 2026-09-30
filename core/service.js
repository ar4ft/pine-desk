import {randomUUID} from 'node:crypto';
import {demoBars,fetchBinance,parseCSV,durations,validateBars,validateTrades} from './data.js';
import {examples} from './examples.js';
import {runBacktest,simulate,validateSource} from './backtest.js';
import {orderflow} from './orderflow.js';
import {libraryCall} from './library.js';
import {configureEdge,edgeConfig,edgeOverview,edgeCall} from './edge-stats.js';
import {whaleConfig,configureWhale,whaleCall} from './whale-options.js';
import * as store from './store.js';
export async function dispatch(action,args={}) {
  switch(action){
    case 'workspace':return {dataset:await store.read('bars')??{bars:demoBars(),symbol:'DEMO',timeframe:'1h',origin:'Synthetic demonstration'},scripts:[...examples,...await store.list('scripts')],runs:(await store.list('runs')).sort((a,b)=>b.createdAt-a.createdAt).slice(0,30),dataDir:store.dataDir};
    case 'loadMarket':{const bars=await fetchBinance(args);return store.write('bars',{bars,symbol:args.symbol,timeframe:args.timeframe,origin:'Binance • closed candles',loadedAt:Date.now()});}
    case 'importBars':{if(!durations[args.timeframe])throw new Error('Unsupported timeframe.');return store.write('bars',{bars:args.csv?parseCSV(args.csv):validateBars(args.bars),symbol:String(args.symbol||'CSV').slice(0,40),timeframe:args.timeframe,origin:'Imported OHLCV',loadedAt:Date.now()});}
    case 'saveScript':{const source=validateSource(args.source),id=args.id??randomUUID();const script={id,name:String(args.name||'Untitled').slice(0,100),source,provenance:args.provenance??null,updatedAt:Date.now()};return store.write('scripts',script,id);}
    case 'backtest':{const dataset=args.dataset??await store.read('bars')??{bars:demoBars(),symbol:'DEMO',timeframe:'1h',origin:'Synthetic demonstration'};const result=await runBacktest({...dataset,source:args.source,settings:args.settings});const run={id:randomUUID(),createdAt:Date.now(),source:args.source,settings:args.settings??{},dataset,result};await store.write('runs',run,run.id);return run;}
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
