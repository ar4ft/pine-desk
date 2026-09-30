const {app,BrowserWindow,ipcMain,shell,dialog,Menu}=require('electron');
const path=require('node:path');
const fs=require('node:fs/promises');
let win,updates;
app.setName('Pine Desk');
async function createWindow(){
  const {dispatch}=await import('../core/service.js');
  win=new BrowserWindow({width:1510,height:980,minWidth:1100,minHeight:740,title:'Pine Desk',backgroundColor:'#0b1018',titleBarStyle:'hiddenInset',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  const trusted=event=>{const url=event.senderFrame?.url??'';return event.sender===win.webContents&&(app.isPackaged?url.startsWith('file://'):url.startsWith('file://')||url.startsWith('http://127.0.0.1:5173/'));};
  ipcMain.removeHandler('desk:call');
  ipcMain.handle('desk:call',async(event,action,args)=>{if(!trusted(event))throw new Error('Untrusted window.');return dispatch(action,args);});
  ipcMain.removeHandler('desk:import');
  ipcMain.handle('desk:import',async(event)=>{if(!trusted(event))throw new Error('Untrusted window.');const selection=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'CSV',extensions:['csv']}]});if(selection.canceled)return null;const stat=await fs.stat(selection.filePaths[0]);if(stat.size>20_000_000)throw new Error('CSV must be smaller than 20 MB.');return fs.readFile(selection.filePaths[0],'utf8');});
  ipcMain.removeHandler('desk:export');
  ipcMain.handle('desk:export',async(event,name,text)=>{if(!trusted(event)||typeof text!=='string'||text.length>100_000_000)throw new Error('Invalid export.');const result=await dialog.showSaveDialog(win,{defaultPath:path.basename(name)});if(!result.canceled)await fs.writeFile(result.filePath,text);return !result.canceled;});
  ipcMain.removeHandler('desk:open');
  ipcMain.handle('desk:open',async(event,url)=>{if(!trusted(event)||!/^https:\/\/(www\.luxalgo\.com|docs\.luxalgo\.com|velacharts\.dev|github\.com)\//.test(url))throw new Error('Unsupported external link.');return shell.openExternal(url);});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  if(process.argv.includes('--dev'))await win.loadURL('http://127.0.0.1:5173');else await win.loadFile(path.join(__dirname,'../dist/index.html'));
}
app.whenReady().then(async()=>{
  await createWindow();
  const {createUpdates}=require('./updates.cjs');
  updates=createUpdates({app,dialog,getWindow:()=>win});
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform==='darwin'?[{role:'appMenu'}]:[{role:'fileMenu'}]),
    {role:'editMenu'},{role:'viewMenu'},{role:'windowMenu'},
    {role:'help',submenu:[{label:'Check for Updates…',click:()=>updates.check()}]},
  ]));
});
app.on('before-quit',()=>updates?.stop());
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
