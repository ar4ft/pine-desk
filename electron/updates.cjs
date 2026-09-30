const fs=require('node:fs');
const path=require('node:path');
function createUpdates({app,dialog,getWindow,platform=process.platform,resourcesPath=process.resourcesPath,updater,clock=globalThis,readFile=fs.readFileSync,logger=console}){
  let enabled=false;
  try{
    const channel=JSON.parse(readFile(path.join(resourcesPath||'','release-channel.json'),'utf8'));
    enabled=app.isPackaged&&platform==='darwin'&&channel.channel==='stable'&&channel.provider==='github'&&channel.owner==='ar4ft'&&channel.repo==='pine-desk';
  }catch{}
  const show=options=>{const window=getWindow();return window&&!window.isDestroyed()?dialog.showMessageBox(window,options):dialog.showMessageBox(options);};
  let checking=false,downloading=false,ready=null,manual=false,stopped=false,failureReported=false;
  let startup,interval;
  const unavailable=()=>show({type:'info',title:'Updates',message:'Automatic updates are available in signed Mac releases.',detail:'Development builds and unsigned CI packages do not check for updates.'});
  if(!enabled)return {check:unavailable,stop(){},enabled:false};
  updater??=require('electron-updater').autoUpdater;
  updater.autoDownload=true;
  updater.autoInstallOnAppQuit=false;
  updater.allowPrerelease=false;
  updater.allowDowngrade=false;
  updater.logger=logger;
  const restart=async()=>{
    if(stopped)return;
    const choice=await show({type:'info',title:'Pine Desk update ready',message:`Pine Desk ${ready.version} is ready to install.`,detail:'Save your script edits and exports before restarting. Your local datasets and saved runs stay in place.',buttons:['Restart and install','Later'],defaultId:1,cancelId:1});
    if(choice.response===0&&!stopped)updater.quitAndInstall();
  };
  const failure=async error=>{
    downloading=false;
    if(failureReported)return;
    failureReported=true;
    logger.warn('Update check or download failed:',error.message);
    const notify=manual;manual=false;
    if(notify&&!stopped)await show({type:'error',title:'Update unavailable',message:'Pine Desk could not check or download an update.',detail:'Check your connection and try Help → Check for Updates again. Your installed version remains available.'});
  };
  const listeners={
    'update-available':()=>{downloading=true;},
    'update-not-available':async()=>{if(manual&&!stopped)await show({type:'info',title:'Updates',message:'You are using the latest published stable release.'});},
    'update-downloaded':async info=>{downloading=false;ready=info;await restart();},
    error:failure,
  };
  for(const [event,fn] of Object.entries(listeners))updater.on(event,fn);
  async function check(userRequested=true){
    if(stopped)return;
    if(ready){if(userRequested)await restart();return;}
    if(checking||downloading){if(userRequested)await show({type:'info',title:'Updates',message:downloading?'An update is downloading. You will be prompted when it is ready.':'An update check is already running.'});return;}
    checking=true;manual=userRequested;failureReported=false;
    try{await updater.checkForUpdates();}catch(error){await failure(error);}finally{checking=false;if(!downloading)manual=false;}
  }
  startup=clock.setTimeout(()=>check(false),20000);
  interval=clock.setInterval(()=>check(false),6*60*60*1000);
  return {enabled:true,check,stop(){stopped=true;clock.clearTimeout(startup);clock.clearInterval(interval);for(const [event,fn] of Object.entries(listeners))updater.removeListener(event,fn);}};
}
module.exports={createUpdates};
