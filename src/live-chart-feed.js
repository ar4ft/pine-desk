// Public Vela MarketDataFeed port; its orchestrator owns streaming chart/engine updates.
export function makeLiveChartFeed(getSnapshot){
 const listeners=new Set();let tail=0;
 const answer=(cfg,range={})=>{
  const s=getSnapshot(),dataset=s.dataset;
  const tf={'1':'1m','5':'5m','15':'15m','60':'1h','240':'4h','D':'1d','1D':'1d'}[cfg.timeframe]??cfg.timeframe;
  if(!dataset||cfg.symbol!==dataset.symbol||tf!==dataset.timeframe)return [];
  let bars=s.forming?[...dataset.bars,s.forming]:dataset.bars;
  if(range.from!==undefined)bars=bars.filter(bar=>bar.time>=range.from);
  if(range.to!==undefined)bars=bars.filter(bar=>bar.time<=range.to);
  if(range.limit)bars=bars.slice(-range.limit);return bars;
 };
 return {
  async load(cfg){const bars=answer(cfg);tail=bars.at(-1)?.time??0;return bars;},
  async loadRange(cfg,range){return answer(cfg,range);},
  subscribe(cfg,onBar){listeners.add(onBar);return ()=>listeners.delete(onBar);},
  push(snapshot){
    const last=snapshot.dataset?.bars.at(-1);
    if(last&&last.time>=tail){for(const listener of listeners)listener(last);tail=last.time;}
    if(snapshot.forming&&snapshot.forming.time>=tail){for(const listener of listeners)listener(snapshot.forming);tail=snapshot.forming.time;}
  },
  destroy(){listeners.clear();},
 };
}
