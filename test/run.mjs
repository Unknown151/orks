/* Engine regression suite for index.html.
 *
 * Runs the real app in headless Chromium against the fixture datasheets in
 * test/fixtures/data — deliberately fake units that exercise the mechanics the
 * guide calls out: escalating costs, multi-size pricing, leaders, the
 * Enhancement/Upgrade cap, multi-profile weapons, DP budgeting + unique groups,
 * persistence and share links. It never touches data/, so it keeps passing as
 * the real Ork data lands.
 *
 *   node test/run.mjs
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Use a local playwright if the repo has one, else fall back to a global install.
async function loadChromium(){
  const tries = ['playwright'];
  try { tries.push(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'playwright', 'index.mjs')).href); } catch {}
  for(const spec of tries){ try { return (await import(spec)).chromium; } catch {} }
  throw new Error('playwright not found — run `npm i -D playwright` or install it globally.');
}
const chromium = await loadChromium();

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = 8123;

// index.html comes from the repo; every data/* request is served from the
// fixtures, so the suite tests the real app against known-good data.
const TYPES = { '.html':'text/html', '.json':'application/json' };
const server = createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  if (p === '/' || p === '\\') p = '/index.html';
  const file = p.startsWith('/data/') ? join(HERE, 'fixtures', p) : join(ROOT, p);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[p.slice(p.lastIndexOf('.'))] || 'text/plain' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const B = `http://127.0.0.1:${PORT}/`;
const b=await chromium.launch(); const p=await b.newPage();
// cp-absent is fetched on purpose by the "missing datasheet" test — its 404 is expected.
const EXPECTED_404 = /cp-absent/;
const errs=[];
p.on('console',m=>{ if(m.type()==='error' && !EXPECTED_404.test(m.location()?.url||'')) errs.push(m.text()); });
p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
const ok=[],bad=[];
const t=(n,c)=>{
  if(typeof c!=='boolean'){ bad.push(`${n}  <-- BROKEN TEST (got ${typeof c}, expected boolean)`); return; }
  (c?ok:bad).push(n+(c?'':'  <-- FAIL'));
};

await p.goto(B,{waitUntil:'networkidle'});
await p.waitForTimeout(300);

// --- data load
t('data loaded: 3 units', await p.evaluate(()=>DATA.unitOrder.length)===3);
t('detachments loaded', await p.evaluate(()=>Object.keys(DATA.detachments).length)===3);
t('_note/_schema meta keys stripped', await p.evaluate(()=>!DATA.abilities._note && !DATA.enhancements._schema));

// --- detachment DP
await p.evaluate(()=>toggleDetachment('big-one'));
t('DP spent = 2', await p.evaluate(()=>dpSpent())===2);
t('unique group blocks sibling', await p.evaluate(()=>canAddDetachment('lil-one'))===false);
t('other det still addable (1 DP left)', await p.evaluate(()=>canAddDetachment('other'))===true);
await p.evaluate(()=>toggleDetachment('other'));
t('DP spent = 3, budget full', await p.evaluate(()=>dpSpent())===3);
t('DP chip shows 3/3', (await p.textContent('#dpChip'))==='3/3');
t('blocked cards dimmed', await p.evaluate(()=>document.querySelectorAll('.dcard.blocked').length)===1);

// --- add units + costing
await p.evaluate(()=>{addUnit('demo-boyz');addUnit('demo-boyz');addUnit('demo-boyz');});
t('3 instances', await p.evaluate(()=>armyList.length)===3);
t('copy 1 = 100', await p.evaluate(()=>instancePoints(armyList[0]))===100);
t('copy 3 escalated = 110', await p.evaluate(()=>instancePoints(armyList[2]))===110);
t('escalation flagged in UI', await p.evaluate(()=>document.querySelectorAll('#view-builder .esc').length)===1);
// size stepper snaps
await p.evaluate(()=>{armyList[0].models=20;renderAll();});
t('20 models = 185 (not 2x100)', await p.evaluate(()=>instancePoints(armyList[0]))===185);
t('army total', await p.evaluate(()=>armyPoints())===185+100+110);

// --- single-model escalation (escalationAfter 3)
await p.evaluate(()=>{for(let i=0;i<4;i++)addUnit('demo-buggy');});
t('buggy 3rd copy = 70', await p.evaluate(()=>instancePoints(armyList.filter(i=>i.unitId==='demo-buggy')[2]))===70);
t('buggy 4th copy = 80', await p.evaluate(()=>instancePoints(armyList.filter(i=>i.unitId==='demo-buggy')[3]))===80);

// --- leaders
await p.evaluate(()=>addUnit('demo-warboss'));
t('warboss offered as leader for boyz', await p.evaluate(()=>availableLeadersFor(armyList[0]).length)===1);
t('buggy has no leader option', await p.evaluate(()=>availableLeadersFor(armyList.find(i=>i.unitId==='demo-buggy')).length)===0);
await p.evaluate(()=>{const w=armyList.find(i=>i.unitId==='demo-warboss');armyList[0].leaderId=w.uid;renderAll();});
t('leader no longer offered to 2nd boyz', await p.evaluate(()=>availableLeadersFor(armyList[1]).length)===0);
t('merged card: leader band rendered', await p.evaluate(()=>document.querySelectorAll('#view-army .leader-band').length)===2);
t('attached leader not a separate army card',
  await p.evaluate(()=>[...document.querySelectorAll('#view-army .unit-hd h3')]
    .filter(h=>h.firstChild.textContent.includes('Warboss')).length)===0);
t('merged card shows combined leader+unit points',
  await p.evaluate(()=>{const c=[...document.querySelectorAll('#view-army .unit')]
    .find(x=>x.querySelector('.leader-band'));
    const l=armyList.find(i=>i.unitId==='demo-warboss');
    return parseInt(c.querySelector('.pts').textContent,10)===instancePoints(armyList[0])+instancePoints(l);}));
t('inherited ability badge on led unit melee', await p.evaluate(()=>document.querySelectorAll('#view-army .pill.inh').length)>0);
t('leaderBonus appliesTo respected (no inherit on ranged)',
   await p.evaluate(()=>inheritedAbilitiesFor(armyList[0],'ranged').length)===0);

// --- detachment-granted ability (MOB keyword)
t('granted ability shows on MOB unit', await p.evaluate(()=>getDetachmentGrantedAbilities(DATA.units['demo-boyz']).length)===1);
t('granted ability absent on non-MOB', await p.evaluate(()=>getDetachmentGrantedAbilities(DATA.units['demo-buggy']).length)===0);

// --- enhancements / upgrades
const wb=await p.evaluate(()=>armyList.find(i=>i.unitId==='demo-warboss').uid);
t('warboss eligible for both', await p.evaluate(u=>eligibleEnhancements(armyList.find(i=>i.uid===u)).map(e=>e.id).sort().join(),wb)==='extra-armour,shiny-bit');
t('boyz (non-character) eligible for upgrade only',
  await p.evaluate(()=>eligibleEnhancements(armyList[0]).map(e=>e.id).join())==='extra-armour');
await p.evaluate(u=>{armyList.find(i=>i.uid===u).enhancementId='shiny-bit';renderAll();},wb);
t('enhancement adds points', await p.evaluate(u=>instancePoints(armyList.find(i=>i.uid===u)),wb)===100);
t('★ on builder header', await p.evaluate(()=>document.querySelectorAll('#view-builder .star').length)===1);
t('2nd copy of an Enhancement blocked', await p.evaluate(()=>enhancementBlockReason('shiny-bit',armyList[0]))==='taken');
// upgrades: 3 copies allowed, only 1st counts toward cap
await p.evaluate(()=>{armyList[0].enhancementId='extra-armour';armyList[1].enhancementId='extra-armour';armyList[2].enhancementId='extra-armour';renderAll();});
t('3 upgrade copies allowed', await p.evaluate(()=>armyList.filter(i=>i.enhancementId==='extra-armour').length)===3);
t('upgrades charged per copy', await p.evaluate(()=>instancePoints(armyList[1]))===110);
t('cap counts distinct upgrade once (1 enh + 1 upg = 2)', await p.evaluate(()=>countArmyEnhancements())===2);
const bg=await p.evaluate(()=>armyList.filter(i=>i.unitId==='demo-buggy')[0].uid);
t('4th upgrade copy blocked', await p.evaluate(u=>enhancementBlockReason('extra-armour',armyList.find(i=>i.uid===u)),bg)==='max 3');

// --- multi-profile weapon summary
t('multi-profile merged in summary',
  (await p.evaluate(()=>weaponSummaryText(DATA.units['demo-boyz'],armyList[0]))).length>0);
t('  -> shoota appears once', (await p.evaluate(()=>weaponSummaryText(DATA.units['demo-boyz'],armyList[0]))).match(/Shoota/g).length===1);
t('  -> no profile suffix', !(await p.evaluate(()=>weaponSummaryText(DATA.units['demo-boyz'],armyList[0]))).includes('Burst'));
t('count:0 option excluded from summary (?? not ||)',
  !(await p.evaluate(()=>weaponSummaryText(DATA.units['demo-boyz'],armyList[0]))).includes('Rokkit'));
t('both profiles still rendered on battle card',
  await p.evaluate(()=>[...document.querySelectorAll('#view-army .unit')[0].querySelectorAll('.wn')]
    .filter(x=>x.textContent.includes('Shoota')).length)===2);
t('weaponGroup header shown once', await p.evaluate(()=>document.querySelectorAll('#view-army .wgrp').length)>0);

// --- stratagems
await p.click('nav button[data-tab="strats"]');
t('both strats shown (big-one active)', await p.evaluate(()=>document.querySelectorAll('#view-strats .strat').length)===2);
await p.click('.chip[data-phase="command"]');
t('phase filter narrows to 1', await p.evaluate(()=>document.querySelectorAll('#view-strats .strat').length)===1);
await p.click('.chip[data-phase="all"]'); await p.click('.chip[data-turn="opponent"]');
t('turn filter drops your-turn strat', await p.evaluate(()=>document.querySelectorAll('#view-strats .strat').length)===1);
await p.click('.chip[data-turn="all"]');

// --- detachment removal cleanup
await p.evaluate(()=>toggleDetachment('big-one'));
t('orphaned enhancement cleared', await p.evaluate(u=>armyList.find(i=>i.uid===u).enhancementId,wb)===null);
t('upgrade shared with "other" det survives', await p.evaluate(()=>armyList[0].enhancementId)==='extra-armour');
t('det strat hidden after removal', await p.evaluate(()=>document.querySelectorAll('#view-strats .strat').length)===1);
await p.evaluate(()=>toggleDetachment('big-one'));

// --- share link round trip
const before=await p.evaluate(()=>JSON.stringify([armyPoints(),armyList.length,selectedDetachments,armyList[0].leaderId!==null]));
const code=await p.evaluate(()=>encodeShare());
t('share uses deflate', code.startsWith('z'));
{ // fresh context: empty localStorage, so ONLY the link can supply the list
  const ctx=await b.newContext(); const p2=await ctx.newPage();
  const e2=[]; p2.on('pageerror',e=>e2.push(e.message));
  await p2.goto(B+'#l='+code,{waitUntil:'networkidle'}); await p2.waitForTimeout(400);
  const after=await p2.evaluate(()=>JSON.stringify([armyPoints(),armyList.length,selectedDetachments,armyList[0].leaderId!==null]));
  t('share round trip identical (clean profile)', before===after);
  t('hash cleared after load', await p2.evaluate(()=>location.hash)==='');
  t('share carries leader attachment', await p2.evaluate(()=>armyList[0].leaderId!==null));
  t('share carries enhancements', await p2.evaluate(()=>armyList.filter(i=>i.enhancementId).length)>0);
  t('no errors on share boot: '+e2.join('|'), e2.length===0);
  await ctx.close();
}

// --- persistence round trip
await p.reload({waitUntil:'networkidle'}); await p.waitForTimeout(300);
t('localStorage restores list', await p.evaluate(()=>JSON.stringify([armyPoints(),armyList.length,selectedDetachments]))===JSON.stringify(JSON.parse(before).slice(0,3)));
t('localStorage points match', await p.evaluate(()=>armyPoints())===JSON.parse(before)[0]);
t('leader link survives reload', await p.evaluate(()=>armyList[0].leaderId!==null));

// --- legacy single-detachment migration
await p.evaluate(()=>{localStorage.removeItem('orks.detachments');localStorage.setItem('orks.detachment','lil-one');});
await p.reload({waitUntil:'networkidle'}); await p.waitForTimeout(300);
t('legacy single det migrated to array', await p.evaluate(()=>JSON.stringify(selectedDetachments))==='["lil-one"]');

// --- text export
const txt=await p.evaluate(()=>exportText());
t('export has points line', /\d+ \/ \d+ pts/.test(txt));
t('export lists detachments', txt.includes('Lil One'));
t('export merges multi-profile weapon (no profile suffix, no dupes)',
  !/Shoota\s+[-–—]/.test(txt) && !txt.includes('Burst') && !txt.includes('Focused'));

// --- removal cleanup
await p.evaluate(()=>{const w=armyList.find(i=>i.unitId==='demo-warboss');removeInstance(w.uid);});
t('removing a leader clears dangling leaderId', await p.evaluate(()=>armyList.every(i=>i.leaderId===null)));

// ---------------------------- COMBAT PATROL ----------------------------
await p.evaluate(()=>{
  selectedDetachments.slice().forEach(toggleDetachment);   // clear (lil-one blocks big-one's unique group)
  toggleDetachment('big-one');                             // grants active for the leak test
});
t('cleared then re-selected: big-one active', await p.evaluate(()=>isDetachmentActive('big-one')));
t('nav has Combat Patrol, not Points',
  await p.evaluate(()=>[...document.querySelectorAll('nav button')].map(b=>b.dataset.tab).join(','))==='army,builder,strats,cp');
await p.click('nav button[data-tab="cp"]');
t('CP view is the visible one', await p.evaluate(()=>document.querySelector('#view-cp').classList.contains('on')));
t('DP control hidden on CP tab', await p.evaluate(()=>getComputedStyle(document.querySelector('#btnDp')).display)==='none');
t('CP force loaded', await p.evaluate(()=>DATA.combatPatrol.name)==='Demo Combat Patrol');
t('CP datasheets loaded from roster (incl. ledBy)',
  await p.evaluate(()=>Object.keys(DATA.cpUnits).sort().join())==='cp-boyz,cp-buggy,cp-nob');
t('CP units kept out of the matched-play pool', await p.evaluate(()=>DATA.units['cp-boyz']===undefined));
t('roster renders one card per entry', await p.evaluate(()=>document.querySelectorAll('#view-cp .unit').length)===3);
t('ledBy renders a merged card', await p.evaluate(()=>document.querySelectorAll('#view-cp .leader-band').length)===2);
t('roster count shown', await p.evaluate(()=>document.querySelector('#view-cp .unit-hd .muted').textContent.trim())==='×2');
t('missing datasheet flagged, not silent',
  await p.evaluate(()=>document.querySelector('#view-cp').textContent.includes('data/combat-patrol/units/cp-absent.json')));
t('unit totals line', await p.evaluate(()=>document.querySelector('#view-cp .totals').textContent.replace(/\s+/g,' ').includes('4 units')));
t('  (control: the same keyword DOES grant in matched play)',
  await p.evaluate(()=>document.querySelectorAll('#view-army .pill.grant').length)>0);
t('detachment grants do NOT leak into CP cards',
  await p.evaluate(()=>document.querySelectorAll('#view-cp .pill.grant').length)===0);
t('  ...and the CP unit really does carry the granted keyword',
  await p.evaluate(()=>DATA.cpUnits['cp-boyz'].keywords.includes('MOB')));
// CP panels
await p.click('[data-panel="cpRule"]');
t('faction ability rendered with its own badge',
  await p.evaluate(()=>document.querySelectorAll('#view-cp .pill.fac').length)===1);
t('faction ability sorts first in its abilities section',
  await p.evaluate(()=>{
    const pill=document.querySelector('#view-cp .pill.fac'), sec=pill.closest('.sec');
    return sec.querySelector('.sec-t').textContent==='Abilities' && sec.querySelector('.pill')===pill;}));
t('faction ability opens its popup',
  (await p.evaluate(()=>{document.querySelector('#view-cp .pill.fac').click();
    return document.querySelector('#mType').textContent;}))==='Faction Ability — Demo');
await p.click('#mClose');
t('CP rule panel opens', await p.evaluate(()=>document.querySelector('#cpRule').classList.contains('open')));
t('CP rule text shown', await p.evaluate(()=>document.querySelector('#cpRule .panel-bd').textContent.includes('Rule body')));
await p.click('[data-panel="cpStrat"]');
t('CP stratagem shown in its own panel', await p.evaluate(()=>document.querySelectorAll('#cpStrat .strat').length)===1);
t('CP stratagem absent from the Stratagems tab',
  await p.evaluate(()=>!document.querySelector('#view-strats').textContent.includes('Patrol Strat')));
t('builder panel state independent of CP panels',
  await p.evaluate(()=>document.querySelector('#pDet').classList.contains('open')));
// in-game tracker still reachable
await p.click('#btnMenu'); await p.click('#mTracker');
t('tracker reachable from menu', await p.evaluate(()=>document.querySelector('#view-points').classList.contains('on')));
t('tracker still increments',
  (await p.evaluate(()=>{
    document.querySelector('[data-g="cp:1"]').click();
    document.querySelector('[data-g="cp:1"]').click();
    return game.cp;
  }))===2);
await p.evaluate(()=>{game.cp=0;save();});

// -------------------------- FACTION CALL DOCK --------------------------
await p.evaluate(()=>{game.waaagh=false;save();setTab('cp');renderAll();}); await p.waitForTimeout(120);
t('dock is fixed to the screen',
  await p.evaluate(()=>getComputedStyle(document.querySelector('#dock')).position)==='fixed');
t('dock shown on Combat Patrol', await p.evaluate(()=>{
  setTab('cp'); return document.querySelector('#dock').style.display!=='none';}));
t('dock hidden on every other tab', await p.evaluate(()=>{
  const hidden=t=>{setTab(t);return document.querySelector('#dock').style.display==='none';};
  const r=['army','builder','strats','points'].every(hidden); setTab('cp'); return r;}));
t('hidden dock reclaims its page padding', await p.evaluate(()=>{
  setTab('builder'); const pad=parseInt(getComputedStyle(document.querySelector('main')).paddingBottom,10);
  setTab('cp'); return pad<30;}));
t('button labelled from data', await p.evaluate(()=>document.querySelector('#dockBtn').textContent)==='WAAAGH!');
t('no banner before it is called', await p.evaluate(()=>!document.querySelector('#dockBanner').classList.contains('on')));
t('page content is padded clear of the dock',
  await p.evaluate(()=>parseInt(getComputedStyle(document.querySelector('main')).paddingBottom,10))>60);

// press it
await p.click('#dockBtn');
t('press plays the visual effect', await p.evaluate(()=>
  document.querySelector('#dockBtn').classList.contains('fire') &&
  document.querySelector('#dockFlash').classList.contains('on')));
t('state set immediately on press', await p.evaluate(()=>game.waaagh)===true);
await p.waitForTimeout(500);
t('ongoing banner appears above the button', await p.evaluate(()=>document.querySelector('#dockBanner').classList.contains('on')));
t('banner sits above the button', await p.evaluate(()=>
  document.querySelector('#dockBanner').getBoundingClientRect().bottom <=
  document.querySelector('#dockBtn').getBoundingClientRect().top + 1));
t('banner states the gained effect', await p.evaluate(()=>
  document.querySelector('#dockBanner').textContent.includes('declare a charge')));
t('banner states the duration', await p.evaluate(()=>
  document.querySelector('#dockBanner').textContent.includes('Until the end of the next turn')));
t('button switches to its active look', await p.evaluate(()=>document.querySelector('#dockBtn').classList.contains('on')));
await p.waitForTimeout(500);   // animation classes are stripped at 800ms
t('effect animation cleaned up', await p.evaluate(()=>
  !document.querySelector('#dockBtn').classList.contains('fire') &&
  !document.querySelector('#dockFlash').classList.contains('on')));
t('padding grows to clear the taller dock',
  await p.evaluate(()=>parseInt(getComputedStyle(document.querySelector('main')).paddingBottom,10))>110);

// pressing again while active must not toggle it off by accident
await p.click('#dockBtn'); await p.waitForTimeout(400);
t('second press does not cancel the call', await p.evaluate(()=>game.waaagh)===true);

// survives a reload
await p.reload({waitUntil:'networkidle'}); await p.waitForTimeout(400);
t('call persists across reload', await p.evaluate(()=>game.waaagh)===true);
t('dock not shown on the default tab after reload',
  await p.evaluate(()=>document.querySelector('#dock').style.display)==='none');
await p.evaluate(()=>setTab('cp')); await p.waitForTimeout(150);
t('banner restored when returning to Combat Patrol',
  await p.evaluate(()=>document.querySelector('#dockBanner').classList.contains('on')));

// end it from the banner
await p.click('#dockEnd'); await p.waitForTimeout(150);
t('End clears the call', await p.evaluate(()=>game.waaagh)===false);
t('banner hidden after End', await p.evaluate(()=>!document.querySelector('#dockBanner').classList.contains('on')));

// stays in sync with the in-game tracker (which lives on another tab)
await p.evaluate(()=>setTab('points'));
await p.click('#btnWaaagh'); await p.waitForTimeout(120);
t('tracker toggle sets the call', await p.evaluate(()=>game.waaagh)===true);
await p.evaluate(()=>setTab('cp')); await p.waitForTimeout(150);
t('tracker toggle drives the dock banner',
  await p.evaluate(()=>document.querySelector('#dockBanner').classList.contains('on')));
await p.evaluate(()=>setTab('points'));
await p.click('#btnResetGame'); await p.waitForTimeout(120);
await p.evaluate(()=>setTab('cp')); await p.waitForTimeout(150);
t('reset game clears the dock', await p.evaluate(()=>!document.querySelector('#dockBanner').classList.contains('on')));

// data-driven: no call* keys => no dock at all
t('adding a tab to FACTION_CALL_TABS is all it takes', await p.evaluate(()=>{
  FACTION_CALL_TABS.push('army'); setTab('army');
  const shown=document.querySelector('#dock').style.display!=='none';
  FACTION_CALL_TABS.pop(); setTab('cp'); return shown;}));
t('dock hides when the ability has no call data', await p.evaluate(()=>{
  const keep=DATA.abilities.waaagh; delete DATA.abilities.waaagh; renderDock();
  const hidden=document.querySelector('#dock').style.display==='none';
  DATA.abilities.waaagh=keep; renderDock(); return hidden;}));
await p.waitForTimeout(120);

// ---------------------------- COLLAPSING -----------------------------
await p.evaluate(()=>{collapsed={};setTab('cp');renderAll();}); await p.waitForTimeout(150);
t('every unit card has a chevron',
  await p.evaluate(()=>document.querySelectorAll('#view-cp .unit-hd .ucv').length)>0);
t('cards start expanded',
  await p.evaluate(()=>document.querySelectorAll('#view-cp .unit.collapsed').length)===0);
await p.click('#view-cp .unit-hd');
t('tapping the header collapses the card',
  await p.evaluate(()=>document.querySelectorAll('#view-cp .unit')[0].classList.contains('collapsed')));
t('collapsed body is hidden',
  await p.evaluate(()=>getComputedStyle(document.querySelectorAll('#view-cp .unit')[0].querySelector('.unit-bd')).display)==='none');
t('header stays visible when collapsed',
  await p.evaluate(()=>document.querySelectorAll('#view-cp .unit')[0].querySelector('h3').offsetParent!==null));
t('collapsing one card leaves its neighbour alone',
  await p.evaluate(()=>!document.querySelectorAll('#view-cp .unit')[1].classList.contains('collapsed')));
await p.click('#view-cp .unit-hd');
t('tapping again expands it',
  await p.evaluate(()=>!document.querySelectorAll('#view-cp .unit')[0].classList.contains('collapsed')));

// survives a re-render and a reload
await p.click('#view-cp .unit-hd');
t('state survives a full re-render', await p.evaluate(()=>{
  renderAll(); return document.querySelectorAll('#view-cp .unit')[0].classList.contains('collapsed');}));
await p.reload({waitUntil:'networkidle'}); await p.waitForTimeout(400);
await p.evaluate(()=>setTab('cp')); await p.waitForTimeout(150);
t('state survives a reload',
  await p.evaluate(()=>document.querySelectorAll('#view-cp .unit')[0].classList.contains('collapsed')));
await p.click('#view-cp .unit-hd');   // tidy up

// merged leader cards collapse whole (an earlier test removed the leader, so re-attach)
await p.evaluate(()=>{
  addUnit('demo-warboss');
  armyList[0].leaderId = armyList[armyList.length-1].uid;
  setTab('army'); renderAll();
}); await p.waitForTimeout(150);
t('merged card present for the collapse check',
  await p.evaluate(()=>document.querySelectorAll('#view-army .leader-band').length)===2);
const mk = await p.evaluate(()=>{const c=[...document.querySelectorAll('#view-army .unit')]
  .find(x=>x.querySelector('.leader-band')); c.querySelector('.unit-hd').click();
  return [...c.querySelectorAll('.leader-band,.unit-bd')].every(e=>getComputedStyle(e).display==='none');});
t('merged card hides leader AND unit sections', mk);
await p.evaluate(()=>{const c=[...document.querySelectorAll('#view-army .unit')]
  .find(x=>x.querySelector('.leader-band')); c.querySelector('.unit-hd').click();});

// builder cards too, and independently of the army view
await p.evaluate(()=>setTab('builder')); await p.waitForTimeout(150);
await p.click('#view-builder .unit-hd');
t('builder cards collapse',
  await p.evaluate(()=>document.querySelectorAll('#view-builder .unit')[0].classList.contains('collapsed')));
t('builder collapse is keyed separately from the army view',
  await p.evaluate(()=>{const uid=armyList[0].uid; return !!collapsed['b:'+uid] && !collapsed['a:'+uid];}));
await p.click('#view-builder .unit-hd');
await p.evaluate(()=>{collapsed={};localStorage.removeItem('orks.collapsed');renderAll();});

t('no console/page errors: '+errs.join(' | '), errs.length===0);
await b.close();
server.close();
console.log(ok.map(x=>'  ok  '+x).join('\n'));
if(bad.length){console.log('\n'+bad.map(x=>'  XX  '+x).join('\n'));}
console.log(`\n${ok.length} passed, ${bad.length} failed`);
process.exit(bad.length?1:0);
