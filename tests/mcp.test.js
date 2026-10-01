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
    const tools=await client.listTools();for(const name of ['workspace','edge_query','edge_session_bars','whale_event','whale_gex','whale_net_flow','live_status','research_start','compare_runs','options_snapshot','options_refresh','options_start','options_stop'])assert.ok(tools.tools.some(t=>t.name===name));
    const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return JSON.parse(r.content[0].text);};
    await call('import_bars',{symbol:'FIXTURE',timeframe:'1h',csv:'time,open,high,low,close,volume\n1767225600,100,110,90,105,10\n1767229200,105,115,95,110,20\n1767232800,110,120,100,115,15'});
    const source='//@version=6\nstrategy("MCP test")\nif bar_index == 0\n    strategy.entry("Long", strategy.long, qty=1)';
    await call('save_script',{name:'MCP test',source});
    const run=await call('run_backtest',{source,settings:{initial_capital:1000,commission_value:.1,slippage:0}});assert.equal(run.dataset.symbol,'FIXTURE');
    const workspace=await call('workspace');assert.equal(workspace.runs.length,1);assert.ok(workspace.scripts.some(s=>s.name==='MCP test'));
    assert.equal(workspace.dataDir,dir);
    const researchSource='//@version=6\nstrategy("MCP inputs")\nqty = input.int(1, "Qty")\nif bar_index == 0\n    strategy.entry("Long", strategy.long, qty=qty)';
    const study=await call('research_start',{kind:'sweep',source:researchSource,grid:{Qty:[1,2]}});
    let result;const deadline=Date.now()+5000;
    do{result=await call('research_status',{id:study.id});if(result.status==='running')await new Promise(resolve=>setTimeout(resolve,20));}while(result.status==='running'&&Date.now()<deadline);
    assert.equal(result.status,'completed');assert.equal(result.result.candidates[0].result.openTrades[0].size,1);assert.equal(result.result.candidates[1].result.openTrades[0].size,2);
    const candidate=await call('research_save_run',{id:study.id,index:0});
    const comparison=await call('compare_runs',{ids:[run.id,candidate.id]});assert.equal(comparison.sameData,true);
    assert.equal((await call('live_status')).active,false);assert.equal((await call('options_snapshot')).active,false);assert.ok(!tools.tools.some(t=>t.name==='saveCredentials'));
    const noOptionsKey=await client.callTool({name:'options_refresh',arguments:{ticker:'SPY'}});assert.ok(!noOptionsKey.isError);assert.match(JSON.parse(noOptionsKey.content[0].text).errors.gex,/API token/);
    const missing=await client.callTool({name:'order_flow',arguments:{timeframe:'1h',tickSize:1}});assert.equal(missing.isError,true);
  }finally{await client.close();await fs.rm(dir,{recursive:true,force:true});}
});
