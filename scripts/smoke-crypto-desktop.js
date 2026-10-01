// Opt-in production public API check through real Electron IPC.
import {_electron as electron,expect} from '@playwright/test';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pine-desk-crypto-electron-'));
const args=process.env.PINE_DESK_PACKAGED_PATH?[]:['.'];if(process.platform==='linux')args.push('--no-sandbox');
const app=await electron.launch({args,...(process.env.PINE_DESK_PACKAGED_PATH?{executablePath:process.env.PINE_DESK_PACKAGED_PATH}:{}),env:{...process.env,PINE_DESK_DATA_DIR:dir},timeout:30000});
try{
 const page=await app.firstWindow();await expect(page.locator('#pine-editor .cm-content')).toBeVisible();await page.locator('[data-page="education"]').click();await expect(page.locator('#learn-curve svg')).toBeVisible();await page.locator('[data-learn-greek="gamma"]').click();await page.screenshot({path:'test-results/greeks-lab.png',fullPage:true});
 await page.locator('[data-page="crypto"]').click();await page.locator('#crypto-currency').selectOption('ETH');await page.locator('#crypto-refresh').click();await expect(page.locator('[data-crypto-contract]').first()).toBeVisible({timeout:30000});
 const snapshot=await page.evaluate(()=>window.desk.call('deribitSnapshot'));
 const contract=snapshot.rows.filter(r=>r.expiry===snapshot.rows[0].expiry&&r.type==='call').sort((a,b)=>Math.abs(a.strike-snapshot.spot)-Math.abs(b.strike-snapshot.spot))[0];
 await page.locator(`[data-crypto-contract="${contract.instrument}"]`).click();await expect(page.locator('#crypto-ticker')).toContainText(contract.instrument);const previous=await page.evaluate(()=>window.desk.call('deribitSnapshot'));
 await page.locator('#crypto-start').click();await expect(page.locator('#crypto-status')).toContainText('streaming',{timeout:30000});await expect.poll(async()=>{const s=await page.evaluate(()=>window.desk.call('deribitSnapshot'));return s.ticker.timestamp;},{timeout:30000}).toBeGreaterThan(previous.ticker.timestamp);
 await page.screenshot({path:'test-results/deribit-options.png',fullPage:true});await page.locator('#crypto-stop').click();await expect(page.locator('#crypto-status')).toContainText('snapshot');
 console.log(JSON.stringify({desktop:'public Deribit REST/WS and interactive education passed',currency:snapshot.currency,contracts:snapshot.rows.length,instrument:contract.instrument}));
}finally{await app.close();await fs.rm(dir,{recursive:true,force:true});}
