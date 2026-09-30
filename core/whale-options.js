import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {validateEdgeConfig,decodeToolResult} from './edge-stats.js';
import * as store from './store.js';
export const defaultWhaleConfig={endpoint:'http://127.0.0.1:8788/mcp',source:'unverified'};
export function validateWhaleConfig(input){
  const {endpoint}=validateEdgeConfig({mode:'local',endpoint:input?.endpoint??defaultWhaleConfig.endpoint});
  if(!['unverified','synthetic','licensed','recording'].includes(input?.source))throw new Error('Choose the source configured in your Whale Options engine.');
  return {endpoint,source:input.source};
}
export async function whaleConfig(){return await store.read('whale-config')??defaultWhaleConfig;}
export async function configureWhale(input){return store.write('whale-config',validateWhaleConfig(input));}
const operations={status:'whale_status',recent:'whale_recent',top:'whale_top',event:'whale_event',gex:'whale_gex',oiDeltas:'whale_oi_deltas',maxPain:'whale_max_pain',ivRank:'whale_iv_rank',netFlow:'whale_net_flow'};
export async function whaleCall(operation,args={}){
  const name=operations[operation];if(!name)throw new Error('Unsupported Whale Options operation.');
  const config=validateWhaleConfig(await whaleConfig());
  const client=new Client({name:'pine-desk-whale-options',version:'0.1.0'});
  try{
    await client.connect(new StreamableHTTPClientTransport(new URL(config.endpoint)),{timeout:15000});
    const result=decodeToolResult(await client.callTool({name,arguments:args},undefined,{timeout:30000}));
    return {config,result,retrievedAt:Date.now()};
  }finally{await client.close();}
}
