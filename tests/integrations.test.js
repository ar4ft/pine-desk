import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {z} from 'zod';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pine-desk-integrations-'));process.env.PINE_DESK_DATA_DIR=dir;
const {validateEdgeConfig,validateEdgeResult,edgeCall,configureEdge}=await import('../core/edge-stats.js');
const {validateWhaleConfig,configureWhale,whaleCall}=await import('../core/whale-options.js');
const report={n:20,successes:10,estimate:.5,ci95:[.3,.7],query:{dsl:'gapFill',symbol:'TEST'},guards:{refused:false,lowSample:true},disclaimer:'Historical only.'};
test.after(async()=>fs.rm(dir,{recursive:true,force:true}));
test('local endpoints and statistical evidence reject misleading configuration/results',()=>{
 for(const endpoint of ['https://127.0.0.1/mcp','http://example.com/mcp','http://localhost/mcp?key=secret','http://user:pass@localhost/mcp'])assert.throws(()=>validateEdgeConfig({mode:'local',endpoint}));
 assert.equal(validateWhaleConfig({endpoint:'http://127.0.0.1:8788/mcp',source:'synthetic'}).source,'synthetic');
 assert.throws(()=>validateWhaleConfig({source:'live'}));
 assert.equal(validateEdgeResult(report).estimate,.5);
 assert.equal(validateEdgeResult({...report,n:2,successes:1,estimate:null,ci95:null,guards:{refused:true}}).estimate,null);
 assert.throws(()=>validateEdgeResult({...report,ci95:null}));
 assert.throws(()=>validateEdgeResult({...report,groups:[{n:10,estimate:.5,ci95:null}]}));
 assert.throws(()=>validateEdgeResult({...report,guards:{refused:true}}));
});
test('actual HTTP MCP forwarding preserves parameters, provenance and upstream errors',async()=>{
 const calls=[];const sessions=new Set();
 const httpServer=http.createServer(async(req,res)=>{
  const server=new McpServer({name:'fixture-upstream',version:'1'});
  const register=(name,schema,payload)=>server.registerTool(name,{inputSchema:schema},async args=>{calls.push({name,args});return {content:[{type:'text',text:JSON.stringify(payload(args))}]};});
  register('edge_query',{dsl:z.string(),symbol:z.string(),groupBy:z.string().optional()},args=>({...report,query:args}));
  register('whale_recent',{ticker:z.string(),min_premium:z.number()},args=>({count:1,events:[{id:'fixture',underlying:args.ticker,side:'unknown',cold_start:true}]}));
  server.registerTool('whale_event',{inputSchema:{id:z.string()}},async()=>({isError:true,content:[{type:'text',text:'no recorded event'}]}));
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined});sessions.add(server);
  try{await server.connect(transport);await transport.handleRequest(req,res);}catch(e){if(!res.headersSent)res.writeHead(500).end(e.message);}
  res.on('close',()=>{server.close();sessions.delete(server);});
 });
 await new Promise(resolve=>httpServer.listen(0,'127.0.0.1',resolve));
 const endpoint=`http://127.0.0.1:${httpServer.address().port}/mcp`;
 try{
  await configureEdge({mode:'local',endpoint});
  const result=await edgeCall('query',{dsl:'gapFill WHERE dayOfWeek = Tue',symbol:'TEST',groupBy:'dayOfWeek'});
  assert.equal(result.result.n,20);assert.equal(result.result.query.groupBy,'dayOfWeek');assert.equal(result.config.endpoint,endpoint);
  await configureWhale({endpoint,source:'synthetic'});
  const flow=await whaleCall('recent',{ticker:'NVDA',min_premium:100});
  assert.equal(flow.result.events[0].side,'unknown');assert.equal(flow.result.events[0].cold_start,true);assert.equal(flow.config.source,'synthetic');
  await assert.rejects(whaleCall('event',{id:'missing'}),/no recorded event/);
  await assert.rejects(whaleCall('rules'),/Unsupported/);
  await configureEdge({mode:'hosted',endpoint});
  await assert.rejects(edgeCall('query',{dsl:'gapFill',symbol:'TEST'}),/requires the local/);
  await assert.rejects(edgeCall('report',{preset:'gap-fill',symbol:'TEST',since:'2024-01-01'}),/fixed preset/);
  assert.equal(calls.length,2);
 }finally{for(const server of sessions)await server.close();httpServer.closeAllConnections();await new Promise(resolve=>httpServer.close(resolve));}
});
