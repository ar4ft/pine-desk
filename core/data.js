import Papa from 'papaparse';
export const durations = { '1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000 };
export function timestamp(value) {
  const n = typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value)) ? Number(value) : Date.parse(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error('Invalid timestamp; use ISO dates or Unix seconds/milliseconds.');
  return n < 1e11 ? n * 1000 : n;
}
export function validateBars(input) {
  if (!Array.isArray(input) || input.length < 2 || input.length > 50000) throw new Error('Provide 2–50,000 OHLCV bars.');
  const bars = input.map(b => ({time:timestamp(b.time ?? b.openTime),open:Number(b.open),high:Number(b.high),low:Number(b.low),close:Number(b.close),volume:Number(b.volume ?? 0)})).sort((a,b)=>a.time-b.time);
  bars.forEach((b,i) => {
    if (![b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite) || Math.min(b.open,b.high,b.low,b.close)<=0 || b.volume<0 || b.high<Math.max(b.open,b.close,b.low) || b.low>Math.min(b.open,b.close,b.high)) throw new Error(`Invalid OHLCV at row ${i+1}.`);
    if (i && b.time===bars[i-1].time) throw new Error('Duplicate candle timestamps.');
  });
  return bars;
}
export function parseCSV(text, type='bars') {
  if (typeof text!=='string' || text.length>20_000_000) throw new Error('CSV must be smaller than 20 MB.');
  const result=Papa.parse(text,{header:true,skipEmptyLines:'greedy',transformHeader:h=>h.trim().toLowerCase()});
  if(result.errors.length) throw new Error(result.errors[0].message);
  return type==='trades' ? validateTrades(result.data) : validateBars(result.data);
}
export function validateTrades(input) {
  if(!Array.isArray(input)||!input.length||input.length>200000) throw new Error('Provide 1–200,000 trades.');
  return input.map((t,i)=>{
    const trade={time:timestamp(t.time),price:Number(t.price),size:Number(t.size),side:String(t.side).toLowerCase()};
    if(!Number.isFinite(trade.price)||trade.price<=0||!Number.isFinite(trade.size)||trade.size<=0||!['buy','sell'].includes(trade.side)) throw new Error(`Invalid trade at row ${i+1}: requires time, price, size, side (buy/sell aggressor).`);
    return trade;
  }).sort((a,b)=>a.time-b.time);
}
export function demoBars() {
  let price=64800, seed=42;
  const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  return Array.from({length:500},(_,i)=>{const open=price;price=Math.max(100,price+(random()-.48)*650+Math.sin(i/24)*110);return {time:Date.UTC(2026,0,1)+i*3600000,open,high:Math.max(open,price)+random()*210,low:Math.min(open,price)-random()*210,close:price,volume:20+random()*130};});
}
export async function fetchBinance({symbol='BTCUSDT',timeframe='1h',limit=1000}={}) {
  if(!/^[A-Z0-9]{3,24}$/.test(symbol)||!durations[timeframe]||!Number.isInteger(limit)||limit<2||limit>1000) throw new Error('Invalid Binance symbol, timeframe, or bar limit (2–1000).');
  const response=await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${timeframe}&limit=${limit}`,{signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw new Error(`Binance returned HTTP ${response.status}. Import CSV if unavailable in your region.`);
  const data=await response.json();
  // Exclude the forming bar, so all research runs use settled candles.
  return validateBars(data.filter(b=>b[6]<Date.now()).map(b=>({time:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]})));
}
