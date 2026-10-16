// Additional regression assertions. Exit 1 means application defects remain.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const harness = fs.readFileSync(path.join(__dirname, 'terminal-regression-tests.cjs'), 'utf8').split('(async () => {')[0];
vm.runInNewContext(harness + `
(async () => {
  function verdict(saved) {
    const e = env();
    if (saved) e.ctx.localStorage.setItem('alpha_levels_BTCUSDT', JSON.stringify(saved));
    load(e, 'public/plugins/verdict/verdict.plugin.js', 'VerdictPlugin.init();');
    e.bus.emit('coin:change', {symbol:'BTCUSDT', interval:'5m'});
    return e;
  }
  function manual(e, short=false) {
    e.get('tac-trigger-input').value='100';
    e.get('tac-target-input').value=short?'90':'120';
    e.get('tac-stop-input').value=short?'110':'90';
    e.get('tac-update-btn').events.click();
  }
  const tick=(e,p)=>e.bus.emit('ws:ticker',{symbol:'BTCUSDT',lastPrice:p});
  const oi=(a,b)=>[{sumOpenInterest:String(a)},{sumOpenInterest:String(b)}];
  const saved=verdict({trigger:100,target:120,stop:90,direction:'LONG'});
  assert('H11 saved trigger is restored to input', String(saved.get('tac-trigger-input').value)==='100', {actual:saved.get('tac-trigger-input').value});

  const short=verdict(); manual(short,true);
  short.bus.emit('smartmoney:data',{posRatio:{longShortRatio:'2'},globalLS:{longShortRatio:'0.5'},oiHist:oi(100,110)});
  tick(short,99);
  assert('H03 manual SHORT survives next smart-money update without false stop',!short.get('verdict-badge').textContent.includes('STOP'),{badge:short.get('verdict-badge').textContent});

  const missing=verdict(); manual(missing); tick(missing,101);
  assert('H02 missing OI does not produce confirmation',!missing.get('verdict-badge').textContent.includes('TEYİT GELDİ'),{badge:missing.get('verdict-badge').textContent});

  const adverse=verdict(); manual(adverse);
  adverse.bus.emit('smartmoney:data',{oiHist:oi(100,110)}); tick(adverse,101);
  const before=adverse.get('verdict-badge').textContent;
  adverse.bus.emit('smartmoney:data',{posRatio:{longShortRatio:'0.8'},oiHist:oi(100,90)});
  assert('H09 adverse data updates confirmed verdict',adverse.get('verdict-badge').textContent!==before,{before,after:adverse.get('verdict-badge').textContent});

  const m=env(); load(m,'public/plugins/smart-money/smart-money.plugin.js','SmartMoneyPlugin.init();');
  m.ctx.BinanceAPI.getAllSmartMoney=async()=>({posRatio:{longShortRatio:'2',longAccount:'0.666',shortAccount:'0.334'}});
  m.bus.emit('coin:change',{symbol:'BTCUSDT'}); await flush();
  m.ctx.BinanceAPI.getAllSmartMoney=async()=>({});
  m.bus.emit('coin:change',{symbol:'INVALIDUSDT'}); await flush();
  assert('H05 empty response clears previous coin ratio',m.get('ls-ratio-pos').textContent!=='2.00',{ratio:m.get('ls-ratio-pos').textContent,score:m.get('smi-score').textContent});

  const p=env();
  ['ChartPlugin','SmartMoneyPlugin','DataChartsPlugin','VerdictPlugin'].forEach(k=>p.ctx[k]={init(){}});
  p.ctx.WebSocketManager={switchTo(){}};
  const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
  const inline=html.slice(html.indexOf('(function initAlphaTerminal()'),html.lastIndexOf('</script>')).replace('})();','globalThis.review={updatePositionUI,updateOpenInterestUI,changeCoin};})();');
  vm.runInContext(inline,p.ctx); p.ctx.review.changeCoin('BTCUSDT');
  p.get('btb-entry-input').value='100';
  p.get('tac-trigger-input').value='100';p.get('tac-target-input').value='90';p.get('tac-stop-input').value='110';
  p.ctx.review.updatePositionUI(95);
  assert('SHORT price return has positive sign when price falls',p.get('btb-pnl-pill').textContent==='+5.00% PnL',{actual:p.get('btb-pnl-pill').textContent});
  p.ctx.review.updateOpenInterestUI([{sumOpenInterest:'100',sumOpenInterestValue:'10000'},{sumOpenInterest:'100',sumOpenInterestValue:'11000'}]);
  assert('H13 price-only notional change is not labelled money inflow',!p.get('btb-oi-tag').textContent.includes('Giriş'),{actual:p.get('btb-oi-tag').textContent});
  console.log(JSON.stringify({total:checks.length,passed:checks.filter(c=>c.passed).length,checks},null,2));
  if(checks.some(c=>!c.passed))process.exitCode=1;
})();
`, {require,__dirname,console,process,setImmediate,URLSearchParams});
