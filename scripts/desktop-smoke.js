import {_electron as electron} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pine-desk-electron-'));
const args=process.env.PINE_DESK_PACKAGED_PATH?[]:['.'];
if(process.platform==='linux')args.push('--no-sandbox');
const app=await electron.launch({args,...(process.env.PINE_DESK_PACKAGED_PATH?{executablePath:process.env.PINE_DESK_PACKAGED_PATH}:{}),env:{...process.env,PINE_DESK_DATA_DIR:dir},timeout:30000});
try{
  const page=await app.firstWindow();
  await page.waitForSelector('#source');
  const workspace=await page.evaluate(()=>window.desk.call('workspace'));
  assert.equal(workspace.dataset.bars.length,500);
  await page.locator('#run-chart').click();
  await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('Script rendered'));
  await page.locator('#run-backtest').click();
  await page.waitForSelector('#equity-plot',{timeout:30000});
  const saved=await page.evaluate(()=>window.desk.call('workspace'));
  assert.equal(saved.runs.length,1);assert.equal(saved.runs[0].result.metrics.totalTrades,5);
  console.log('Desktop smoke passed: context-isolated preload, Electron IPC, Pine worker, backtest worker, and persistence.');
}finally{await app.close();await fs.rm(dir,{recursive:true,force:true});}
