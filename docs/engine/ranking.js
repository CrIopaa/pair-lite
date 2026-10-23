/* Display-only relative ranking. Search membership, signals and saved results are never changed. */
(function(root){
  'use strict';
  const criterion=(label,path,direction='high')=>({label,path,direction});
  const native=criterion('Existing setup score','score');
  const gap=criterion('Signal gap','score');
  const profiles={
    recovery35:{label:'Frozen-range recovery near 35%',contextOnly:true,ignoreExecution:true,criteria:[criterion('Fresh completed 35% cross','metrics.recovery35Confirmed'),criterion('Current distance from 35%','metrics.distanceFrom35Pct','low'),criterion('Clean swing efficiency','metrics.swingEfficiencyMedian'),criterion('Boundary irregularity','metrics.boundaryIrregularity','low'),criterion('Formation days','metrics.formationBars')]},
    daily_confirmed_range:{label:'Confirmed daily turns nearest the edge',contextOnly:true,ignoreExecution:true,criteria:[criterion('Distance from chosen edge %','metrics.locationPct','low'),criterion('Clean swing efficiency','metrics.swingEfficiencyMedian'),criterion('Boundary irregularity','metrics.boundaryIrregularity','low'),criterion('Formation days','metrics.formationBars')]},
    clean_drive:{label:'Clean completed range drives',contextOnly:true,ignoreExecution:true,criteria:[criterion('Cleanliness limits pass','metrics.driveCleanPass'),criterion('No backward daily steps','metrics.driveZeroBacktrack'),criterion('Worst drive backtracking %','metrics.driveWorstBacktrackPct','low'),criterion('Aggregate backtracking %','metrics.driveBacktrackPct','low'),criterion('Worst continuous giveback %','metrics.driveWorstGivebackPct','low'),criterion('Completed drives','metrics.driveCompletedLegs'),criterion('Formation days','metrics.formationBars')]},
    ticker_extremes:{label:'Daily RSI extremity',criteria:[criterion('RSI distance from 50','metrics.extremity')]},
    alt_strk:{label:'ALT/STRK entry similarity',criteria:[criterion('Distance from original entry template','metrics.referenceDistance','low')]},
    clean_bases:{label:'Clean base/high similarity',criteria:[criterion('Longer daily context','metrics.longDailyContext'),criterion('Strict range passes','metrics.strictRangePass'),criterion('Passing windows','metrics.matchingWindows'),criterion('Boundary shift plus extrema MAD','metrics.boundaryIrregularity','low'),criterion('Median swing efficiency','metrics.swingEfficiencyMedian'),criterion('Formation days','metrics.formationBars')]},
    consistent_channels:{label:'Channel consistency',criteria:[criterion('Boundary shift','metrics.boundaryShiftWidths','low'),criterion('Turning point MAD','metrics.extremaMADWidths','low'),criterion('Crossing efficiency','metrics.swingEfficiencyMedian'),criterion('Formation days','metrics.formationBars')]},
    clear_daily:{label:'Clear daily edge turns',criteria:[criterion('Median completed swing efficiency','metrics.swingEfficiencyMedian'),criterion('Fitted range shape','metrics.rangeQualityScore'),criterion('Distance from chosen edge %','metrics.locationPct','low'),criterion('Formation days','metrics.formationBars')]},
    opposing_bias:{label:'Opposing net coin bias',criteria:[criterion('Balanced net-vote strength','metrics.balancedNetVotes'),criterion('Combined net-vote strength','metrics.combinedNetVotes'),criterion('Minimum directional agreement %','metrics.minimumAgreementPct')]},
    first20:{label:'First 20 setup families',criteria:[criterion('Confirmed 4h turn','metrics.structureConfirmed'),criterion('Strict range evidence','metrics.strictRangePass'),criterion('Range shape quality','metrics.rangeQualityScore')]},
    core:{label:'Selective bounce',criteria:[gap]},
    channel:{label:'Channel signal',criteria:[gap]},
    range:{label:'Range quality',criteria:[native]},
    edge:{label:'Range edge quality',criteria:[native]},
    ultra:{label:'Repeated-range quality',criteria:[native]},
    new:{label:'New range quality',criteria:[native]},
    moderate:{label:'Range recovery',criteria:[criterion('Timing passes','metrics.timingPass'),native]},
    reversal:{label:'Reversal setup',criteria:[native]},
    extreme:{label:'Extreme reversal setup',criteria:[native]},
    consistent:{label:'Consistent oscillation',criteria:[criterion('Matching windows','metrics.matchingWindows'),criterion('Formation bars','metrics.formationBars'),native]},
    trend_range:{label:'Daily uptrend then range',criteria:[criterion('In lower40% of range','metrics.nearRangeBottom'),native]},
    daily_trend:{label:'Daily trend consistency',criteria:[criterion('Minimum daily trend R²','metrics.dailyTrendR2Min'),criterion('360-day ratio drawdown %','metrics.dailyDrawdown360Pct','low'),criterion('Recent leg tail p95 %','metrics.dailyTailP95Pct','low')]},
    slow_grind:{label:'Short recovery consistency',criteria:[criterion('Directional efficiency','metrics.directionalEfficiency'),criterion('Prior equal-notional drawdown %','metrics.equalNotionalDrawdownPct','low'),criterion('Prior gain retained %','metrics.equalNotionalRetainedPct')]},
    pump:{label:'Pump reversal confirmation',criteria:[criterion('Both legs favourable over 4h','metrics.bothGreen4h'),criterion('Ratio rebound %','metrics.ratioReboundPct'),criterion('Short fade %','metrics.shortFadePct')]},
    osc:{label:'Oscillation quality',criteria:[criterion('Completed band transitions','metrics.transitions'),criterion('Formation drift','metrics.drift','low')]},
    missing:{label:'Unlisted oscillator quality',criteria:[criterion('Completed band transitions','metrics.transitions'),criterion('Formation drift','metrics.drift','low')]},
    regime:{label:'Oscillator quality in current context',criteria:[criterion('Completed band transitions','metrics.transitions'),criterion('Formation drift','metrics.drift','low')]},
    fingerprint:{label:'Indicator-match oscillation',criteria:[criterion('Completed band transitions','score')]},
    confluence:{label:'Strength of relative coin bias',criteria:[criterion('Absolute net vote count','score')]},
    weekend:{label:'Largest weekend volatility contrast',criteria:[criterion('Weekend / weekday volatility','metrics.weekendVsWeekdaySD')]}
  };
  // v2 makes family criteria and available evidence explicit; no signal gate changes.
  const VERSION='setup-priority-v2';
  const edge=criterion('Distance from nearest range edge %','@edgeDistance','low');
  const turns=criterion('Repeated low/high cycles','@repeatedTurns');
  const shape=[criterion('Boundary shift / width','metrics.boundaryShiftWidths','low'),criterion('Extrema irregularity / width','metrics.extremaMADWidths','low'),turns];
  for(const engine of ['range','edge','new','ultra'])profiles[engine]={label:engine==='ultra'?'Repeated range fit':'Range setup fit',criteria:[...shape,edge,criterion('Formation days','metrics.daysCovered'),native]};
  profiles.consistent={label:'Multi-window range consistency',criteria:[criterion('Passing windows','metrics.matchingWindows'),...shape,edge,criterion('Formation bars','metrics.formationBars'),native]};
  profiles.clean_bases={label:'Repeated base/high quality',criteria:[criterion('Longer daily context','metrics.longDailyContext'),criterion('Strict range evidence','metrics.strictRangePass'),criterion('Boundary + extrema irregularity','metrics.boundaryIrregularity','low'),criterion('Clean swing efficiency','metrics.swingEfficiencyMedian'),edge,criterion('Passing windows','metrics.matchingWindows'),criterion('Formation days','metrics.formationBars')]};
  profiles.consistent_channels={label:'Channel consistency and location',criteria:[criterion('Boundary shift / width','metrics.boundaryShiftWidths','low'),criterion('Extrema irregularity / width','metrics.extremaMADWidths','low'),criterion('Clean swing efficiency','metrics.swingEfficiencyMedian'),edge,criterion('Formation days','metrics.formationBars')]};
  profiles.reversal={label:'Confirmed range reversal fit',criteria:[criterion('Turn confirmed','@confirmation'),native,edge]};
  profiles.extreme={label:'Confirmed extreme recovery fit',criteria:[criterion('Turn confirmed','@confirmation'),native]};
  for(const engine of ['osc','missing','regime'])profiles[engine]={label:'Oscillator quality and prior-window evidence',criteria:[criterion('Prior formation also passed','metrics.priorWindowPass'),criterion('Completed band crossings','metrics.transitions'),criterion('Formation drift / SD','metrics.drift','low')]};
  profiles.core={label:'Original signal setup fit',criteria:[criterion('Original signal score','score')]};
  profiles.channel={label:'Original channel signal fit',criteria:[criterion('Original signal score','score')]};
  const historyProfile={label:'Prior dip/recovery resemblance',criteria:[criterion('Previous/current floor log-distance','@floorDistance','low'),criterion('Completed prior recoveries','metrics.priorRecoveryCount'),criterion('Original entry-template distance','metrics.referenceDistance','low')]};
  for(const e of ['ticker_extremes','confluence','weekend'])profiles[e].contextOnly=true;
  const explanation='Ranking v2 is a descriptive review priority within this saved search, not expected profit or trade approval. Complete setup ranking inputs and synchronized snapshot marks come first; known chart/turn cautions and partial evidence are labelled and placed lower. Within each tier use the listed family criteria, then tighter maximum spread and higher minimum turnover across both legs when known. Missing values never become zero or a pass. Ranks stay fixed under display filtering and manual sorting. Equal evidence is marked as tied. Extreme-ticker, coin-bias and weekend-volatility overviews retain descriptive metric ordering; they are not opportunity recommendations. Raw saved results and their original order remain unchanged. Funding, total costs and future profitability are not cleared by this ranking.';
  const cache=new WeakMap();
  const numeric=v=>typeof v==='number'&&Number.isFinite(v);
  const at=(o,path)=>path.split('.').reduce((v,k)=>v?.[k],o);
  function profile(definition,result){return definition?.engine==='alt_strk'&&(result?.options?.altStrkPriorRecovery||result?.rows?.some(r=>r.metrics?.priorDipRecovery))?historyProfile:profiles[definition?.engine]||null}
  function legValues(row,key){const legs=row.context?.legs;if(!Array.isArray(legs))return null;const wanted=row.long===row.short?legs.slice(0,1):legs.slice(0,2);if(wanted.length!==(row.long===row.short?1:2)||wanted.some(l=>!numeric(l[key])))return null;return wanted.map(l=>l[key])}
  function value(row,c){
    const m=row.metrics||{};let v;
    if(c.path==='@edgeDistance'){const pos=numeric(m.channelMarkPositionPct)?m.channelMarkPositionPct:m.locationPct;v=numeric(pos)?Math.min(Math.abs(pos),Math.abs(100-pos)):null}
    else if(c.path==='@repeatedTurns'){const lo=m.confirmedLows??m.lows,hi=m.confirmedHighs??m.highs;v=numeric(lo)&&numeric(hi)?Math.min(lo,hi):null}
    else if(c.path==='@floorDistance'){v=numeric(m.priorLowDifferencePct)&&m.priorLowDifferencePct>-100?Math.abs(Math.log1p(m.priorLowDifferencePct/100)):null}
    else if(c.path==='@confirmation'){v=m.timingUnavailable?null:typeof m.structureConfirmed==='boolean'?m.structureConfirmed:typeof m.timingPass==='boolean'?m.timingPass:typeof m.bothGreen4h==='boolean'?m.bothGreen4h:null}
    else if(c.path==='@maxSpread'){const vls=legValues(row,'spreadPct');v=vls&&vls.every(v=>v>=0)?Math.max(...vls):null}
    else if(c.path==='@minVolume'){const vls=legValues(row,'volume30USDT');v=vls&&vls.every(v=>v>=0)?Math.min(...vls):null}
    else v=at(row,c.path);
    if(['metrics.bothGreen4h','metrics.structureConfirmed','metrics.timingPass'].includes(c.path)&&m.timingUnavailable)return null;
    if(typeof v==='boolean')v=v?1:0;
    return numeric(v)?v:null;
  }
  function cautions(row,engine){
    const m=row.metrics||{},out=[];
    const rangeEngines=['range','edge','ultra','new','consistent','clean_bases','consistent_channels','clear_daily','moderate','reversal','trend_range','first20'];
    if(m.markOutside===true||m.channelMarkOutside===true||m.channelLatestOutside===true||(rangeEngines.includes(engine)&&numeric(m.locationPct)&&(m.locationPct<0||m.locationPct>100)))out.push('Outside fitted range/channel');
    if(m.horizonDirectionsConflict===true||m.channelDirectionConflict===true)out.push('Conflicting horizon directions');
    if(!m.timingUnavailable&&(m.structureConfirmed===false||m.timingPass===false||(engine==='pump'&&m.bothGreen4h===false)||(engine==='opposing_bias'&&m.directSetupConfirmed===false)))out.push('Turn not confirmed');
    if(Array.isArray(m.legCautions)&&m.legCautions.length)out.push('Individual-leg candle caution');
    const spread=value(row,{path:'@maxSpread'}),volume=value(row,{path:'@minVolume'});
    if(spread!==null&&spread>.15)out.push('Snapshot spread above 0.15%');
    if(volume!==null&&volume<2000000)out.push('Leg turnover below 2m USDT/day');
    return out;
  }
  function snapshotReady(row,result){
    const legs=row.context?.legs,n=row.long===row.short?1:2;
    if(!Array.isArray(legs)||legs.length<n||!numeric(result.quoteAsOf))return false;
    const selected=legs.slice(0,n);
    return selected.every(l=>numeric(l.mark)&&l.mark>0&&numeric(l.markTime)&&Math.abs(l.markTime-result.quoteAsOf)<=120000)&&(n===1||Math.abs(selected[0].markTime-selected[1].markTime)<=15000);
  }
  function compareValues(a,b,c){if(a===null||b===null)return a===b?0:a===null?1:-1;const delta=a-b;return delta?(c.direction==='low'?Math.sign(delta):-Math.sign(delta)):0}
  function compare(a,b,criteria){
    if(a.tier!==b.tier)return a.tier-b.tier;
    if(a.cautions.length!==b.cautions.length)return a.cautions.length-b.cautions.length;
    for(let i=0;i<criteria.length;i++){const cmp=compareValues(a.values[i],b.values[i],criteria[i]);if(cmp)return cmp}
    for(let i=0;i<execution.length;i++){const cmp=compareValues(a.execution[i],b.execution[i],execution[i]);if(cmp)return cmp}
    return 0;
  }
  const execution=[criterion('Maximum leg spread %','@maxSpread','low'),criterion('Minimum leg 30-day turnover USDT','@minVolume')];
  function rank(result,definition=result.definition){
    const p=profile(definition,result),key=(definition?.engine||'')+'|'+(p===historyProfile?'history':'base');
    const previous=cache.get(result);if(previous?.key===key)return previous.value;
    const criteria=p?.criteria||[],tierNames=['Ranking inputs complete','Chart/turn caution','Limited ranking data','No usable setup measurements'];
    const records=(result.rows||[]).map((row,index)=>{
      const values=criteria.map(c=>value(row,c)),flags=p?.contextOnly?[]:cautions(row,definition?.engine),quotes=snapshotReady(row,result),known=values.filter(v=>v!==null).length;
      const missing=criteria.filter((c,i)=>values[i]===null).map(c=>c.label);if(!p?.contextOnly){if(!quotes)missing.push('Synchronized snapshot marks');for(const c of execution)if(value(row,c)===null)missing.push(c.label);}
      const tier=!criteria.length||known===0?3:missing.length?2:flags.length?1:0;
      return{row,index,values,cautions:flags,quotes,missing,tier,execution:execution.map(c=>p?.ignoreExecution?null:value(row,c))};
    });
    const pairCompare=(a,b)=>String(a.row.pair).localeCompare(String(b.row.pair))||a.index-b.index;
    records.sort((a,b)=>compare(a,b,criteria)||pairCompare(a,b));
    const usable=records.filter(r=>r.tier<3).length;
    for(let i=0;i<records.length;){
      let j=i+1;while(j<records.length&&compare(records[i],records[j],criteria)===0)j++;
      const score=i>=usable?null:usable===1?50:100*(1-(i+j-1)/2/(usable-1));
      for(let k=i;k<j;k++){
        const r=records[k],ex=execution.map((c,n)=>({...c,value:r.execution[n]}));
        r.ranking={version:VERSION,rank:i>=usable?null:i+1,position:k+1,score,total:records.length,ranked:usable,originalIndex:r.index,profile:p?.label||'Unavailable setup ranking',criteria:criteria.map((c,n)=>({...c,value:r.values[n]})),execution:ex,ties:j-i,evidenceTier:tierNames[r.tier],tier:r.tier,missing:r.missing,cautions:r.cautions};
      }
      i=j;
    }
    const out={version:VERSION,profile:p,explanation,ranked:usable,total:records.length,complete:records.filter(r=>r.tier<2).length,limited:records.filter(r=>r.tier>=2).length,rows:records.map(r=>({...r.row,_ranking:r.ranking}))};
    cache.set(result,{key,value:out});return out;
  }
  root.SetupRanking={rank,profile,profiles,historyProfile,explanation,version:VERSION,value};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.SetupRanking;
})(typeof window!=='undefined'?window:globalThis);
