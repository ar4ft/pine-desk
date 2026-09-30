import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
test('MCP handshake, shared persistence, strategy execution and tool errors',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pine-desk-mcp-'));
  const client=new Client({name:'test',version:'1'});
  try{
    await client.connect(new StdioClientTransport({command:process.execPath,args:['core/mcp.js'],env:{...process.env,PINE_DESK_DATA_DIR:dir},stderr:'pipe'}));
    const tools=await client.listTools();assert.equal(tools.tools.length,10);
    const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return JSON.parse(r.content[0].text);};
    await call('import_bars',{symbol:'FIXTURE',timeframe:'1h',csv:'time,open,high,low,close,volume\n1767225600,100,110,90,105,10\n1767229200,105,115,95,110,20\n1767232800,110,120,100,115,15'});
    const source='//@version=6\nstrategy("MCP test")\nif bar_index == 0\n    strategy.entry("Long", strategy.long, qty=1)';
    await call('save_script',{name:'MCP test',source});
    const run=await call('run_backtest',{source,settings:{initial_capital:1000,commission_value:.1,slippage:0}});assert.equal(run.dataset.symbol,'FIXTURE');
    const workspace=await call('workspace');assert.equal(workspace.runs.length,1);assert.ok(workspace.scripts.some(s=>s.name==='MCP test'));
    assert.equal(workspace.dataDir,dir);
    const missing=await client.callTool({name:'order_flow',arguments:{timeframe:'1h',tickSize:1}});assert.equal(missing.isError,true);
  }finally{await client.close();await fs.rm(dir,{recursive:true,force:true});}
});
