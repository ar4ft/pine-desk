import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import * as store from './store.js';

export const defaultEdgeConfig={mode:'hosted',endpoint:'http://127.0.0.1:3344/mcp'};
const hostedEndpoint='https://mcp.luxalgo.com/mcp';
const context='Retrieving public session statistics to support desktop trading research while preserving sample sizes, confidence intervals, and the provenance of historical results.';
const tools={hosted:{coverage:'edge_symbols',presets:'edge_presets',report:'edge_report'},local:{coverage:'edge_freshness',presets:'edge_reports_list',report:'edge_report',query:'edge_query',fields:'edge_fields',sessions:'edge_sessions',sessionBars:'edge_session_bars'}};

export function validateEdgeConfig(input){
  if(!input||!['hosted','local'].includes(input.mode))throw new Error('Choose hosted or local Edge Stats.');
  let url;try{url=new URL(input.endpoint??defaultEdgeConfig.endpoint);}catch{throw new Error('Invalid local MCP URL.');}
  if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/mcp'||url.search||url.hash)throw new Error('Local Edge Stats must use http://localhost:PORT/mcp, without credentials or query parameters.');
  return {mode:input.mode,endpoint:url.href};
}
export async function configureEdge(input){return store.write('edge-config',validateEdgeConfig(input));}
export async function edgeConfig(){return await store.read('edge-config')??defaultEdgeConfig;}
export function decodeToolResult(result){
  const text=result.content?.filter(c=>c.type==='text').map(c=>c.text).join('\n')??'';
  if(result.isError)throw new Error(text||'Edge Stats request failed.');
  if(result.structuredContent)return result.structuredContent;
  try{return JSON.parse(text);}catch{throw new Error('Edge Stats returned an invalid JSON response.');}
}
export async function withEdgeClient(config,fn){
  config=validateEdgeConfig(config);
  const client=new Client({name:'pine-desk-edge-stats',version:'0.1.0'});
  try{
    await client.connect(new StreamableHTTPClientTransport(new URL(config.mode==='hosted'?hostedEndpoint:config.endpoint)),{timeout:15000});
    return await fn(async(operation,args={})=>{
      const name=tools[config.mode][operation];
      if(!name)throw new Error(`${operation} requires the local Edge Stats MCP server. Hosted access supports precomputed reports only.`);
      const result=await client.callTool({name,arguments:config.mode==='hosted'?{...args,context}:args},undefined,{timeout:30000});
      return decodeToolResult(result);
    });
  }finally{await client.close();}
}
export async function edgeOverview(){
  const config=await edgeConfig();
  return withEdgeClient(config,async call=>{
    const coverage=await call('coverage');
    const catalog=await call('presets');
    return {config,coverage,catalog,retrievedAt:Date.now()};
  });
}
export async function edgeCall(operation,args={}){
  if(!['coverage','presets','report','query','fields','sessions','sessionBars'].includes(operation))throw new Error('Unsupported Edge Stats operation.');
  const config=await edgeConfig();
  if(!tools[config.mode][operation])throw new Error(`${operation} requires the local Edge Stats MCP server.`);
  if(operation==='report'&&config.mode==='hosted'&&Object.keys(args).some(k=>!['preset','symbol'].includes(k)&&args[k]!==undefined))throw new Error('Hosted reports use fixed preset parameters. Select local mode for filters, parameters, dates, or grouping.');
  const result=await withEdgeClient(config,call=>call(operation,args));
  if(['report','query'].includes(operation)) validateEdgeResult(result);
  return {config,result,retrievedAt:Date.now()};
}
export function validateEdgeResult(r){
  // Never display a percentage if the upstream result lost its denominator or CI.
  if(!r||!Number.isInteger(r.n)||r.n<0||!Number.isInteger(r.successes)||r.successes<0||r.successes>r.n||!r.query||!r.guards||typeof r.disclaimer!=='string')throw new Error('Edge Stats result is missing its sample size, query, guards, or disclaimer.');
  const evidence=row=>{
    if(!Number.isInteger(row.n)||row.n<0)throw new Error('Edge Stats evidence is missing its sample size.');
    if(row.estimate!==null&&(!Number.isFinite(row.estimate)||row.estimate<0||row.estimate>1||!Array.isArray(row.ci95)||row.ci95.length!==2||!row.ci95.every(v=>Number.isFinite(v)&&v>=0&&v<=1)||row.ci95[0]>row.ci95[1]))throw new Error('Edge Stats estimate is missing a valid 95% confidence interval.');
  };
  [r,r.stability?.firstHalf,r.stability?.secondHalf,r.recency,...(r.groups??[])].filter(Boolean).forEach(evidence);
  if(r.guards.refused&&r.estimate!==null)throw new Error('Edge Stats refused this sample but returned an estimate.');
  return r;
}
