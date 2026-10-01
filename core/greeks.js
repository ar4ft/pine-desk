// Independent Black–Scholes–Merton implementation. Prices are quote units per
// underlying unit; derivatives use decimal volatility/rates internally.
const pdf=x=>Math.exp(-x*x/2)/Math.sqrt(2*Math.PI);
export function normalCDF(x){
  const a=Math.abs(x),t=1/(1+.2316419*a);
  const tail=pdf(a)*t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
  return x>=0?1-tail:tail;
}
export function validateModel(input={}){
  const p={spot:100,strike:100,days:30,volatility:30,rate:4,dividend:0,type:'call',...input};
  for(const [key,min,max] of [['spot',.01,1e9],['strike',.01,1e9],['days',.000001,3650],['volatility',.1,300],['rate',-20,50],['dividend',-20,50]])
    if(!Number.isFinite(p[key])||p[key]<min||p[key]>max)throw new Error(`${key} must be between ${min} and ${max}.`);
  if(!['call','put'].includes(p.type))throw new Error('Choose call or put.');
  return Object.fromEntries(['spot','strike','days','volatility','rate','dividend','type'].map(k=>[k,p[k]]));
}
export function calculateGreeks(input){
  const p=validateModel(input),S=p.spot,K=p.strike,T=p.days/365,v=p.volatility/100,r=p.rate/100,q=p.dividend/100;
  const root=Math.sqrt(T),d1=(Math.log(S/K)+(r-q+v*v/2)*T)/(v*root),d2=d1-v*root;
  const Q=Math.exp(-q*T),R=Math.exp(-r*T),n=pdf(d1),N=normalCDF,call=p.type==='call';
  const delta=Q*(call?N(d1):N(d1)-1),gamma=Q*n/(S*v*root),vegaRaw=S*Q*n*root;
  const price=call?S*Q*N(d1)-K*R*N(d2):K*R*N(-d2)-S*Q*N(-d1);
  const thetaRaw=-S*Q*n*v/(2*root)+(call?q*S*Q*N(d1)-r*K*R*N(d2):-q*S*Q*N(-d1)+r*K*R*N(-d2));
  const d1T=(2*(r-q)*T-d2*v*root)/(2*T*v*root);
  return {price:Math.max(0,price),delta,gamma,vega:vegaRaw/100,theta:thetaRaw/365,
    rho:(call?K*T*R*N(d2):-K*T*R*N(-d2))/100,
    vanna:-Q*n*d2/v/100,vomma:vegaRaw*d1*d2/v/10000,
    charm:(q*delta-Q*n*d1T)/365,
    speed:-gamma/S*(1+d1/(v*root)),color:gamma*(q+1/(2*T)+d1*d1T)/365,
    zomma:gamma*(d1*d2-1)/v/100,
    ultima:-vegaRaw/(v*v)*(d1*d2*(1-d1*d2)+d1*d1+d2*d2)/1e6,
    d1,d2,model:p};
}
export const greekLessons={
  price:['Premium','Quote units per underlying unit','The model value today. Compare it with intrinsic value at expiry.'],
  delta:['Delta','Premium change per +1 spot unit','Local price sensitivity. A call normally has positive delta; a put has negative delta. Delta is not a guaranteed exercise probability.'],
  gamma:['Gamma','Delta change per +1 spot unit','How quickly delta changes. Long calls and puts both have positive gamma in this model. Near expiry, at-the-money gamma becomes concentrated.'],
  vega:['Vega','Premium change per +1 IV percentage point','Sensitivity to implied volatility. Longer dated at-the-money options generally have more vega.'],
  theta:['Theta','Premium change per elapsed calendar day','Time decay holding everything else fixed. Theta can be positive for some deep in-the-money puts with positive rates.'],
  rho:['Rho','Premium change per +1 rate percentage point','Sensitivity to the annual risk-free rate. This is a local derivative, not a forecast of rate changes.'],
  vanna:['Vanna','Delta change per +1 IV percentage point','Connects spot and volatility sensitivity: volatility changes can change delta.'],
  vomma:['Vomma','Vega change per +1 IV percentage point','How the displayed vega changes with volatility. Also called volga.'],
  charm:['Charm','Delta change per elapsed calendar day','How delta drifts as expiry approaches, with spot and volatility fixed.'],
  speed:['Speed','Gamma change per +1 spot unit','How gamma changes across underlying prices.'],
  color:['Color','Gamma change per elapsed calendar day','How gamma changes as time passes. The sign uses elapsed time, rather than time remaining.'],
  zomma:['Zomma','Gamma change per +1 IV percentage point','How gamma changes with implied volatility.'],
  ultima:['Ultima','Vomma change per +1 IV percentage point','Third derivative of premium with respect to volatility, scaled to percentage-point units.']
};
export function greekCurve(input,{metric='delta',axis='spot',points=101}={}){
  const p=validateModel(input);if(!greekLessons[metric]||!['spot','days','volatility'].includes(axis)||!Number.isInteger(points)||points<2||points>201)throw new Error('Choose a Greek, axis and 2–201 points.');
  const [min,max]=axis==='spot'?[Math.max(.01,p.spot*.5),Math.min(1e9,p.spot*1.5)]:axis==='days'?[.1,Math.min(3650,Math.max(60,p.days*2))]:[.1,Math.min(300,Math.max(100,p.volatility*2))];
  return Array.from({length:points},(_,i)=>{const x=min+(max-min)*i/(points-1);return {x,y:calculateGreeks({...p,[axis]:x})[metric]};});
}
