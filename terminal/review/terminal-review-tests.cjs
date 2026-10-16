// Read-only application review: real source evaluated with isolated DOM/network doubles.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const results = [];
function env() {
  const elements = new Map(), handlers = {}, timers = [];
  const get = id => { if (!elements.has(id)) elements.set(id, {value: id==='btb-entry-input'?'0.21948':'',textContent:'',innerHTML:'',style:{},dataset:{},clientWidth:900,clientHeight:500,classList:{add(){},remove(){},toggle(){}},events:{},addEventListener(k,f){this.events[k]=f;},querySelector(){return null;},contains(){return false;}}); return elements.get(id); };
  const bus={on(k,f){(handlers[k]??=[]).push(f);},emit(k,x){for(const f of handlers[k]||[])f(x);}};
  const ctx=vm.createContext({console,Math,Date,Map,Promise,URLSearchParams,parseFloat,parseInt,isNaN,setTimeout:f=>{timers.push(f);},setInterval:f=>{timers.push(f);},clearInterval(){},clearTimeout(){},document:{getElementById:get,querySelectorAll:()=>[],addEventListener(){}},window:{location:{search:''},addEventListener(){}},EventBus:bus,ResizeObserver:class{observe(){}},BinanceAPI:{}});
  return {ctx,get,bus,timers};
}
function load(e,file,tail=''){vm.runInContext(fs.readFileSync(path.join(root,file),'utf8')+'\n'+tail,e.ctx,{filename:file});}
function record(name,observed,reproduced){results.push({name,reproduced,observed});}
async function flush(){await new Promise(r=>setImmediate(r));}
(async()=>{
  const e=env();
  ['ChartPlugin','SmartMoneyPlugin','DataChartsPlugin','VerdictPlugin'].forEach(k=>e.ctx[k]={init(){}});
  e.ctx.WebSocketManager={switchTo(){}};
  const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
  const inline=html.slice(html.indexOf('(function initAlphaTerminal()'),html.lastIndexOf('</script>')).replace('})();','globalThis.review={updatePositionUI,updateBinanceBarMetrics};})();');
  vm.runInContext(inline,e.ctx);
  e.ctx.review.updatePositionUI(84000);
  record('Hard-coded position and SYN thresholds on BTC', {pnl:e.get('btb-pnl-pill').textContent,badge:e.get('btb-decision-badge').textContent},e.get('btb-decision-badge').textContent.includes('HEDEF'));
  e.ctx.review.updateBinanceBarMetrics({quoteVolume:13400000000,volume:159000}); const rest=e.get('btb-vol-usdt').textContent;
  e.ctx.review.updateBinanceBarMetrics({volume:159000}); const ws=e.get('btb-vol-usdt').textContent;
  record('USDT volume overwritten by base quantity', {rest,ws},rest!==ws);

  function verdict(){const v=env();load(v,'public/plugins/verdict/verdict.plugin.js','VerdictPlugin.init();');v.bus.emit('coin:change',{symbol:'BTCUSDT',interval:'5m'});return v;}
  function bars(){return Array.from({length:35},(_,i)=>({openTime:i*300000,open:95,high:100,low:90,close:95,volume:1}));}
  const v=verdict();v.bus.emit('chart:klines',{symbol:'BTCUSDT',klines:bars()});v.bus.emit('smartmoney:data',{posRatio:{longShortRatio:'1'},globalLS:{longShortRatio:'1'},oiHist:[{sumOpenInterest:'100'},{sumOpenInterest:'90'}]});v.bus.emit('ws:ticker',{symbol:'BTCUSDT',lastPrice:101});
  record('Squeeze confirmation despite OI falling 10%, no volume evidence',{title:v.get('verdict-badge').textContent,text:v.get('verdict-text').innerHTML},v.get('verdict-badge').textContent.includes('TEYİT GELDİ'));
  const s=verdict();s.get('tac-trigger-input').value='100';s.get('tac-target-input').value='90';s.get('tac-stop-input').value='110';s.get('tac-update-btn').events.click();s.bus.emit('ws:ticker',{symbol:'BTCUSDT',lastPrice:99});
  record('Manual short prematurely stopped below trigger despite stop at 110',s.get('verdict-badge').textContent,s.get('verdict-badge').textContent.includes('STOP'));
  const a=verdict();a.bus.emit('smartmoney:data',{posRatio:{longShortRatio:'2'},globalLS:{longShortRatio:'0.5'}});a.bus.emit('ws:ticker',{symbol:'BTCUSDT',lastPrice:84000});
  record('Metrics before klines create SYN fallback levels on BTC',a.get('verdict-text').innerHTML,a.get('verdict-text').innerHTML.includes('0.225'));
  const m=env();load(m,'public/plugins/smart-money/smart-money.plugin.js','globalThis.smp=SmartMoneyPlugin;');m.ctx.BinanceAPI.getAllSmartMoney=async()=>({});m.ctx.smp.init();m.bus.emit('coin:change',{symbol:'BTCUSDT'});await flush();
  record('All missing metrics produce neutral 50 percent',m.get('smi-score').textContent,m.get('smi-score').textContent==='50%');

  const c=env(),pending=[],series=[];
  function makeSeries(){const s={sets:[],updates:[],setData(x){this.sets.push(x);},update(x){this.updates.push(x);},applyOptions(){},createPriceLine(){return {};},removePriceLine(){}};series.push(s);return s;}
  c.ctx.LightweightCharts={CrosshairMode:{Normal:0},LineStyle:{Dashed:1},createChart:()=>({addCandlestickSeries:makeSeries,addHistogramSeries:makeSeries,addLineSeries:makeSeries,subscribeCrosshairMove(){},applyOptions(){},timeScale:()=>({fitContent(){}})})};
  c.ctx.BinanceAPI.getKlines=(symbol,interval)=>new Promise(resolve=>pending.push({symbol,interval,resolve}));
  load(c,'public/plugins/chart/chart.plugin.js','ChartPlugin.init("chart");');
  const data=price=>Array.from({length:60},(_,i)=>[i*300000,String(price),String(price+1),String(price-1),String(price),'10']);
  c.bus.emit('coin:change',{symbol:'AAAUSDT',interval:'5m'});c.bus.emit('coin:change',{symbol:'BBBUSDT',interval:'5m'});
  pending[1].resolve(data(200));await flush();pending[0].resolve(data(100));await flush();
  record('Late old-coin REST response overwrites new coin chart',series[0].sets.at(-1).at(-1).close,series[0].sets.at(-1).at(-1).close===100);
  const emaSets=series[2].sets.length;
  c.bus.emit('ws:kline',{symbol:'BBBUSDT',interval:'5m',kline:{openTime:60*300000,open:200,high:210,low:199,close:209,volume:11,isClosed:false}});
  record('Live candle does not update EMA series',{candleUpdates:series[0].updates.length,emaUpdates:series[2].updates.length,newEmaSets:series[2].sets.length-emaSets},series[0].updates.length===1&&series[2].updates.length===0&&series[2].sets.length===emaSets);
  console.log(JSON.stringify({executed:results.length,reproduced:results.filter(r=>r.reproduced).length,results},null,2));
  if(results.some(r=>!r.reproduced))process.exitCode=1;
})();
