import {normalCDF} from './greeks.js';
// Hagan et al. (2002) lognormal SABR approximation, fixed beta. Decimal IV.
export function sabrIV(F,K,T,{alpha,beta,rho,nu}){
 if(![F,K,T,alpha,beta,rho,nu].every(Number.isFinite)||Math.min(F,K,T,alpha,nu)<=0||beta<0||beta>1||Math.abs(rho)>=1)throw Error('Invalid SABR parameters.');
 const b=1-beta,log=Math.log(F/K),fk=(F*K)**(b/2),z=nu/alpha*fk*log;
 const zx=Math.abs(z)<1e-5?1-rho*z/2+(2-3*rho*rho)*z*z/12:z/Math.log((Math.sqrt(1-2*rho*z+z*z)+z-rho)/(1-rho));
 const correction=1+T*(b*b*alpha*alpha/(24*fk*fk)+rho*beta*nu*alpha/(4*fk)+(2-3*rho*rho)*nu*nu/24);
 const result=alpha/(fk*(1+b*b*log*log/24+b**4*log**4/1920))*zx*correction;
 return result>0&&Number.isFinite(result)?result:NaN;
}
export function quoteUsable(row,at,{maxAgeMs=60000,maxSpread=.5,minOI=1,maxTimeSkewMs=5000}={}){
 if(!(row.bid>0)||!(row.ask>=row.bid)||!(row.iv>0&&row.iv<=300)||(!Number.isFinite(row.oi)||row.oi<minOI)||!Number.isFinite(row.quoteAt))return false;
 const mid=(row.bid+row.ask)/2;if((row.ask-row.bid)/mid>maxSpread||at-row.quoteAt>maxAgeMs||row.quoteAt-at>5000)return false;
 if(row.ivAt!==null&&row.ivAt!==undefined&&(!Number.isFinite(row.ivAt)||at-row.ivAt>maxAgeMs||row.ivAt-at>5000||Math.abs(row.ivAt-row.quoteAt)>maxTimeSkewMs))return false;
 return true;
}
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function nelderMead(loss,start){
 const bounds=[[-7,Math.log(3)],[-1.83,1.83],[Math.log(.01),Math.log(5)]],project=v=>v.map((x,i)=>clamp(x,...bounds[i])),point=v=>{const x=project(v);return {x,y:loss(x)};};
 let simplex=[point(start),...start.map((_,i)=>point(start.map((x,j)=>x+(i===j?.2:0))))],converged=false,iterations=0;
 for(;iterations<600;iterations++){
  simplex.sort((a,b)=>a.y-b.y);if(Math.max(...simplex.slice(1).map(p=>Math.max(...p.x.map((x,i)=>Math.abs(x-simplex[0].x[i])))))<1e-7){converged=true;break;}
  const centroid=start.map((_,i)=>simplex.slice(0,3).reduce((s,p)=>s+p.x[i],0)/3),worst=simplex[3],mix=f=>point(centroid.map((x,i)=>x+f*(x-worst.x[i]))),reflected=mix(1);
  if(reflected.y<simplex[0].y){const expanded=mix(2);simplex[3]=expanded.y<reflected.y?expanded:reflected;}
  else if(reflected.y<simplex[2].y)simplex[3]=reflected;
  else{const outside=reflected.y<worst.y,contracted=point(centroid.map((x,i)=>x+.5*((outside?reflected.x[i]:worst.x[i])-x)));if(contracted.y<(outside?reflected.y:worst.y))simplex[3]=contracted;else simplex=simplex.map((p,i)=>i?point(p.x.map((x,j)=>(x+simplex[0].x[j])/2)):p);}
 }
 simplex.sort((a,b)=>a.y-b.y);return {...simplex[0],converged,iterations};
}
export function fitSABR(snapshot,{expiry,beta=.5,maxAgeMs=60000,maxSpread=.5,minOI=1}={}){
 if(!Number.isFinite(expiry)||!Number.isFinite(beta)||beta<0||beta>1||!Number.isFinite(maxAgeMs)||maxAgeMs<1000||maxAgeMs>3600000||!Number.isFinite(maxSpread)||maxSpread<=0||maxSpread>2||!Number.isFinite(minOI)||minOI<0)throw Error('Invalid surface fit configuration.');
 const T=(expiry-snapshot.fetchedAt)/(365*86400000);if(!(T>0))throw Error('Expiry must follow the snapshot.');
 const all=snapshot.rows.filter(r=>r.expiry===expiry),eligible=all.filter(r=>quoteUsable(r,snapshot.fetchedAt,{maxAgeMs,maxSpread,minOI}));
 const forwards=eligible.map(r=>r.underlying).filter(f=>f>0).sort((a,b)=>a-b);if(!forwards.length)throw Error('Expiry forward prices are missing.');const F=forwards[Math.floor(forwards.length/2)];
 if(forwards.some(f=>Math.abs(f/F-1)>.002))throw Error('Forward observations differ by more than 0.2%; refresh aligned quotes.');
 const points=eligible.filter(r=>r.type==='call'?r.strike>=F:r.strike<F).sort((a,b)=>a.strike-b.strike);
 const unique=[...new Map(points.map(r=>[r.strike,r])).values()];if(unique.length<7)throw Error(`SABR needs at least 7 liquid, fresh OTM strikes; ${unique.length} qualified.`);if(unique.length>120)throw Error('More than 120 qualified strikes; narrow the research slice.');
 const holdout=unique.length>=12?unique.filter((_,i)=>i%4===1):[],training=unique.filter(r=>!holdout.includes(r)),atm=unique.reduce((a,b)=>Math.abs(a.strike-F)<Math.abs(b.strike-F)?a:b).iv/100;
 const decode=x=>({alpha:Math.exp(x[0])*F**(1-beta),beta,rho:Math.tanh(x[1]),nu:Math.exp(x[2])});
 const loss=x=>{const p=decode(x);let sum=0;for(const row of training){const v=sabrIV(F,row.strike,T,p);if(!Number.isFinite(v)||v>10)return 1e9;sum+=(v-row.iv/100)**2;}return sum/training.length;};
 const fits=[-.6,0,.6].map(r=>nelderMead(loss,[Math.log(clamp(atm,.001,3)),Math.atanh(r),Math.log(.5)])),best=fits.sort((a,b)=>a.y-b.y)[0],params=decode(best.x);
 if(!Number.isFinite(best.y)||best.y>=1e8)throw Error('SABR could not fit valid parameters.');
 const residuals=unique.map(r=>{const fitted=sabrIV(F,r.strike,T,params)*100,residual=r.iv-fitted,v=fitted/100,d1=(Math.log(F/r.strike)+v*v*T/2)/(v*Math.sqrt(T)),d2=d1-v*Math.sqrt(T),usd=r.type==='call'?F*normalCDF(d1)-r.strike*normalCDF(d2):r.strike*normalCDF(-d2)-F*normalCDF(-d1),fittedPremium=usd/(r.payoffType==='inverse'?snapshot.spot:1),outsideSpread=fittedPremium<r.bid||fittedPremium>r.ask;return {instrument:r.instrument,strike:r.strike,type:r.type,iv:r.iv,fitted,residual,fittedPremium,outsideSpread,edgeProxy:Math.max(fittedPremium-r.ask,r.bid-fittedPremium,0),usedFor:holdout.includes(r)?'held out':'training',bid:r.bid,ask:r.ask,quoteAt:r.quoteAt};});
 const rms=rows=>rows.length?Math.sqrt(rows.reduce((s,r)=>s+r.residual*r.residual,0)/rows.length):null,trainRMSE=rms(residuals.filter(r=>r.usedFor==='training')),holdoutRMSE=rms(residuals.filter(r=>r.usedFor==='held out'));
 const call=(K,v)=>{const d1=(Math.log(F/K)+v*v*T/2)/(v*Math.sqrt(T)),d2=d1-v*Math.sqrt(T);return F*normalCDF(d1)-K*normalCDF(d2);};
 const domain=[unique[0].strike,unique.at(-1).strike],curve=Array.from({length:61},(_,i)=>{const strike=domain[0]+(domain[1]-domain[0])*i/60,iv=sabrIV(F,strike,T,params);return {strike,iv:iv*100,callPrice:call(strike,iv)};}),slopes=curve.slice(1).map((r,i)=>(r.callPrice-curve[i].callPrice)/(r.strike-curve[i].strike));
 const warnings=[];if(!best.converged)warnings.push('Optimizer iteration limit reached.');if(holdoutRMSE===null)warnings.push('Fewer than 12 qualified strikes: no held-out diagnostic.');if(holdoutRMSE!==null&&holdoutRMSE>Math.max(2,trainRMSE*2))warnings.push('Held-out error is large relative to training fit.');if(Math.abs(params.rho)>.94||params.nu>4.95||params.nu<.0101)warnings.push('A parameter is near its bound.');if(slopes.some(v=>v>1e-5||v< -1-1e-5)||slopes.some((v,i)=>i&&v<slopes[i-1]-1e-5))warnings.push('Sampled model calls fail monotonicity/convexity checks in the fitted domain.');
 return {model:'Hagan 2002 lognormal SABR, fixed beta',expiry,F,T,params,trainRMSE,holdoutRMSE,converged:best.converged,iterations:best.iterations,qualified:unique.length,excluded:all.length-unique.length,domain,residuals,curve,warnings,sourceAt:snapshot.fetchedAt,config:{beta,maxAgeMs,maxSpread,minOI},interpretation:'IV residuals are descriptive calibration deviations, not profit probabilities. Timestamp quality is limited by the exchange observation fields.'};
}
export function deltaSkew(snapshot,{expiry,maxAgeMs=60000,maxSpread=.5,minOI=1}={}){
 const T=(expiry-snapshot.fetchedAt)/(365*86400000);if(!(T>0))throw Error('Invalid skew expiry.');
 const rows=snapshot.rows.filter(r=>r.expiry===expiry&&quoteUsable(r,snapshot.fetchedAt,{maxAgeMs,maxSpread,minOI})&&r.underlying>0);
 const interpolate=type=>{
  const points=rows.filter(r=>r.type===type).map(r=>{const v=r.iv/100,d1=(Math.log(r.underlying/r.strike)+v*v*T/2)/(v*Math.sqrt(T)),delta=type==='call'?normalCDF(d1):normalCDF(d1)-1;return {absDelta:Math.abs(delta),iv:r.iv,instrument:r.instrument,strike:r.strike};}).sort((a,b)=>a.absDelta-b.absDelta);
  const exact=points.find(p=>Math.abs(p.absDelta-.25)<1e-10);if(exact)return {iv:exact.iv,bracket:[exact,exact]};
  for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];if(a.absDelta<=.25&&b.absDelta>=.25&&b.absDelta>a.absDelta)return {iv:a.iv+(.25-a.absDelta)/(b.absDelta-a.absDelta)*(b.iv-a.iv),bracket:[a,b]};}return null;
 };
 const call=interpolate('call'),put=interpolate('put');return {expiry,call25:call,put25:put,riskReversal:call&&put?call.iv-put.iv:null,convention:'25Δ call IV minus 25Δ put IV; unadjusted forward Black delta, zero rates; linear interpolation in absolute delta, no extrapolation',qualified:rows.length};
}
export function gammaExposure(snapshot,{expiry,convention='gross'}={}){
 if(!['gross','call-positive-put-negative'].includes(convention))throw Error('Choose a gamma convention.');const at=snapshot.fetchedAt,S=snapshot.spot,all=snapshot.rows.filter(r=>r.expiry===expiry),rows=all.filter(r=>quoteUsable(r,at,{minOI:0})),T=(expiry-at)/(365*86400000);if(!(T>0))throw Error('Invalid gamma expiry.');if(rows.length>500)throw Error('Gamma research is limited to 500 qualified contracts per slice.');
 const gamma=(r,spot)=>{const v=r.iv/100,d1=(Math.log(spot/r.strike)+v*v*T/2)/(v*Math.sqrt(T));return Math.exp(-d1*d1/2)/Math.sqrt(2*Math.PI)/(spot*v*Math.sqrt(T));};
 const contribution=(r,spot)=>gamma(r,spot)*r.oi*spot*spot*.01*(convention==='call-positive-put-negative'&&r.type==='put'?-1:1),byStrike=new Map();
 for(const r of rows){const b=byStrike.get(r.strike)??{strike:r.strike,call:0,put:0,net:0};b[r.type]+=contribution(r,S);b.net=b.call+b.put;byStrike.set(r.strike,b);}
 const total=spot=>rows.reduce((sum,r)=>sum+contribution(r,spot),0),curve=Array.from({length:61},(_,i)=>{const spot=S*(.5+i/60);return {spot,gex:total(spot)};}),roots=[];
 if(convention!=='gross')for(let i=1;i<curve.length;i++){const a=curve[i-1],b=curve[i];if(a.gex*b.gex<0){let lo=a.spot,hi=b.spot,glo=a.gex;for(let j=0;j<40;j++){const mid=(lo+hi)/2,g=total(mid);if(glo*g<=0)hi=mid;else{lo=mid;glo=g;}}roots.push((lo+hi)/2);}}
 return {expiry,convention,rows:[...byStrike.values()].sort((a,b)=>a.strike-b.strike),curve,roots,qualified:rows.length,excluded:all.length-rows.length,units:'USD sensitivity per 1% spot move; underlying-denominated OI, no ×100 multiplier',method:'BS spot gamma at constant IV, zero rates/yield; reprice the qualified expiry slice over 50–150% of snapshot spot.',positioning:convention==='gross'?'Gross long-option gamma; both calls and puts positive.':'Hypothetical call-positive/put-negative positioning. Zero crossings are model scenario roots, not observed dealer zero gamma.'};
}
