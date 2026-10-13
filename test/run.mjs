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
// Fetched on purpose: the "missing datasheet" and "missing gif" tests both
// provoke a 404 to prove the app degrades quietly.
const EXPECTED_404 = /cp-absent|definitely-not-here/;
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

// --- battle size (core rules 25.03): the points limit picks the size, the size
//     sets the DP budget, the Enhancement limit and the unit limit
t('2000 pts is Strike Force: 3 DP, 4 enhancements',
  await p.evaluate(()=>battleSize().name==='Strike Force' && dpBudget()===3 && enhancementLimit()===4));
const sizeAt=n=>p.evaluate(n=>{const keep=pointsLimit; pointsLimit=n;
  const r=[battleSize().name,dpBudget(),enhancementLimit()].join(); pointsLimit=keep; return r;},n);
t('1000 pts is Incursion: 2 DP, 2 enhancements', (await sizeAt(1000))==='Incursion,2,2');
t('500 pts is still Incursion', (await sizeAt(500))==='Incursion,2,2');
t('1001 pts is already Strike Force', (await sizeAt(1001))==='Strike Force,3,4');
t('no limit (0) plays as the largest size', (await sizeAt(0))==='Strike Force,3,4');
t('a list that was legal at Strike Force is flagged at Incursion, not trimmed', await p.evaluate(()=>{
  const keep=pointsLimit; pointsLimit=1000; renderAll();
  const chip=document.querySelector('#dpChip');
  const r=dpOverBudget() && selectedDetachments.length===2 && chip.textContent==='3/2' && chip.classList.contains('over')
       && !!document.querySelector('#pDet .rulewarn');
  pointsLimit=keep; renderAll();
  return r && !dpOverBudget() && !chip.classList.contains('over') && !document.querySelector('#pDet .rulewarn');}));
t('changing the points limit in the Builder refreshes the DP chip', await p.evaluate(()=>{
  const set=v=>{const i=document.querySelector('#limitIn'); i.value=v; i.dispatchEvent(new Event('change',{bubbles:true}));};
  set('1000'); const small=document.querySelector('#dpChip').textContent;
  set('2000'); return small==='3/2' && document.querySelector('#dpChip').textContent==='3/3' && pointsLimit===2000;}));
t('Incursion: one 3 DP detachment is allowed, but only on its own', await p.evaluate(()=>{
  const keepL=pointsLimit, keepS=selectedDetachments.slice(), d=DATA.detachments['big-one'], keepDp=d.dp;
  pointsLimit=1000; d.dp=3;
  selectedDetachments=[];          const alone=canAddDetachment('big-one');      // 3 > 2, but it would be the only one
  selectedDetachments=['other'];   const second=canAddDetachment('big-one');     // not alongside another
  selectedDetachments=['big-one']; const legal=!dpOverBudget(), full=!canAddDetachment('other');
  d.dp=keepDp; pointsLimit=keepL; selectedDetachments=keepS;
  return alone && !second && legal && full;}));
t('Strike Force has no lone-detachment exception', await p.evaluate(()=>{
  const keepS=selectedDetachments.slice(), d=DATA.detachments['big-one'], keepDp=d.dp;
  d.dp=4; selectedDetachments=[]; const r=canAddDetachment('big-one');
  d.dp=keepDp; selectedDetachments=keepS; return r===false;}));

// --- a detachment can carry two Force Dispositions (War Horde does)
t('two Force Dispositions: both named, bar split between their colours', await p.evaluate(()=>{
  const d=DATA.detachments['other'], keep=d.category;
  d.category=['Take and Hold','Purge the Foe']; renderBuilder();
  const card=document.querySelector('[data-det="other"]');
  const r=card.querySelector('.m').textContent.includes('Take and Hold / Purge the Foe')
       && card.querySelector('.bar').style.background.includes('gradient');
  d.category=keep; renderBuilder();
  return r && !document.querySelector('[data-det="other"] .bar').style.background.includes('gradient');}));

// --- a datasheet's own name is a keyword too (core rules 02.01.01)
t("a datasheet's name counts as a keyword without being listed",
  await p.evaluate(()=>unitHasKeyword(DATA.units['demo-boyz'],'DEMO BOYZ') && !DATA.units['demo-boyz'].keywords.includes('DEMO BOYZ')));
t('...the whole name only, not a word inside it',
  await p.evaluate(()=>unitHasKeyword(DATA.units['demo-boyz'],'BOYZ'))===false);
t('...whichever apostrophe the name is typed with',
  await p.evaluate(()=>unitHasKeyword({name:'’Ard Ladz'},"'ARD LADZ")));
t('...and it can gate an enhancement', await p.evaluate(()=>{
  const e=DATA.enhancements['extra-armour'], was=e.restrictedToKeyword; e.restrictedToKeyword='DEMO BUGGY';
  const a=eligibleEnhancements({unitId:'demo-buggy'}).map(x=>x.id).includes('extra-armour');
  const b=eligibleEnhancements({unitId:'demo-boyz'}).map(x=>x.id).includes('extra-armour');
  e.restrictedToKeyword=was; return a && !b;}));

// --- a grant can ask for any one of several keywords ("MEGANOBZ/NOBZ units")
t('anyKeyword on an ability grant is OR', await p.evaluate(()=>{
  const d=DATA.detachments['big-one'], keep=d.grants;
  d.grants=[{anyKeyword:['NOPE','VEHICLE'],abilityId:'stealth'}];
  const r=getDetachmentGrantedAbilities(DATA.units['demo-buggy']).length===1
       && getDetachmentGrantedAbilities(DATA.units['demo-boyz']).length===0;
  d.grants=keep; return r;}));
t('anyKeyword on a weapon grant is OR', await p.evaluate(()=>{
  const d=DATA.detachments['big-one'], keep=d.grantsWeaponAbilities;
  d.grantsWeaponAbilities=[{anyKeyword:['MOB','NOPE'],appliesTo:'melee',abilityId:'lethal-hits'}];
  const r=getDetachmentWeaponGrants(DATA.units['demo-boyz'],'melee').length===1
       && getDetachmentWeaponGrants(DATA.units['demo-buggy'],'melee').length===0;
  d.grantsWeaponAbilities=keep; return r;}));

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

// --- unit limit (25.03): flagged on the card, never blocked
t('unit limit: 3 at Strike Force, doubled for Battleline',
  await p.evaluate(()=>unitLimitFor(DATA.units['demo-buggy'])===3 && unitLimitFor(DATA.units['demo-boyz'])===6));
t('unit limit: 2 at Incursion, doubled for Battleline', await p.evaluate(()=>{
  const keep=pointsLimit; pointsLimit=1000;
  const r=unitLimitFor(DATA.units['demo-buggy'])===2 && unitLimitFor(DATA.units['demo-boyz'])===4;
  pointsLimit=keep; return r;}));
t('unit limit: an Epic Hero is always 1, a Dedicated Transport is doubled', await p.evaluate(()=>
  unitLimitFor({name:'a',isEpicHero:true})===1 && unitLimitFor({name:'b',keywords:['EPIC HERO']})===1
  && unitLimitFor({name:'c',keywords:['DEDICATED TRANSPORT']})===6));
t('a keyword granted by a detachment counts towards the limit', await p.evaluate(()=>{
  DATA.detachments['big-one'].grantsKeywords=[{keyword:'VEHICLE',add:'BATTLELINE'}];
  const r=unitLimitFor(DATA.units['demo-buggy']);
  delete DATA.detachments['big-one'].grantsKeywords; return r===6;}));
t('the 4th buggy is over the limit, the 3rd is not', await p.evaluate(()=>{
  const b=armyList.filter(i=>i.unitId==='demo-buggy');
  return b.length===4 && !isOverUnitLimit(b[2]) && isOverUnitLimit(b[3]);}));
t('...and only that card carries the warning', await p.evaluate(()=>{
  renderBuilder();
  const cards=[...document.querySelectorAll('#view-builder .unit')].filter(c=>c.querySelector('h3').textContent.includes('Demo Buggy'));
  return cards.map(c=>(c.querySelector('.rulewarn')?1:0)+(c.querySelector('.unit-hd .rulemark')?1:0)).join()==='0,0,0,2';}));
t('data without a unit limit never warns', await p.evaluate(()=>{
  const keep=DATA.battleSizes; DATA.battleSizes=[{name:'Strike Force',dp:3,enhancements:4}];
  const r=unitLimitFor(DATA.units['demo-buggy'])===Infinity && dpBudget()===3 && enhancementLimit()===4;
  DATA.battleSizes=keep; return r;}));

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

// --- compound keyword restrictions ("ORKS INFANTRY model only" is two keywords)
t('single keyword still matches', await p.evaluate(()=>unitHasKeyword(DATA.units['demo-boyz'],'MOB'))===true);
t('array requires every keyword',
  await p.evaluate(()=>unitHasKeyword(DATA.units['demo-boyz'],['ORKS','INFANTRY']))===true);
t('array fails when one keyword is missing',
  await p.evaluate(()=>unitHasKeyword(DATA.units['demo-buggy'],['ORKS','INFANTRY']))===false);
t('array is AND, not OR',
  await p.evaluate(()=>unitHasKeyword(DATA.units['demo-buggy'],['ORKS','NOPE']))===false);
t('empty array matches everything, like no restriction',
  await p.evaluate(()=>unitHasKeyword(DATA.units['demo-buggy'],[]))===true);
// --- detachment-granted keywords (Rollin' Deff gives WAGON to BATTLEWAGON etc.)
t('unit does not have the granted keyword before the grant exists',
  await p.evaluate(()=>unitHasKeyword(DATA.units['demo-buggy'],'WAGON'))===false);
t('granted keyword matches once the detachment is active', await p.evaluate(()=>{
  DATA.detachments['big-one'].grantsKeywords=[{anyKeyword:['VEHICLE','NOPE'],add:'WAGON'}];
  return unitHasKeyword(DATA.units['demo-buggy'],'WAGON');
}));
t('granted keyword does not leak to non-matching units',
  await p.evaluate(()=>unitHasKeyword(DATA.units['demo-boyz'],'WAGON'))===false);
t('a granted keyword cannot feed another grant (no recursion)', await p.evaluate(()=>{
  DATA.detachments['big-one'].grantsKeywords.push({keyword:'WAGON',add:'CHAINED'});
  const out = unitHasKeyword(DATA.units['demo-buggy'],'CHAINED');   // must be false, not a stack overflow
  DATA.detachments['big-one'].grantsKeywords.pop();
  return out===false;
}));
t('an Upgrade restricted to the granted keyword becomes selectable', await p.evaluate(()=>{
  const e=DATA.enhancements['extra-armour']; const was=e.restrictedToKeyword;
  e.restrictedToKeyword='WAGON';
  const ok=eligibleEnhancements(armyList.find(i=>i.unitId==='demo-buggy')).map(x=>x.id).includes('extra-armour');
  e.restrictedToKeyword=was; return ok;
}));
t('granted keyword shows on the card, labelled as from the detachment', await p.evaluate(()=>{
  renderAll();
  return [...document.querySelectorAll('#view-army .kwrow')]
    .some(r=>r.textContent.includes('From detachment') && r.textContent.includes('WAGON'));
}));
t('granted keyword disappears with its detachment', await p.evaluate(()=>{
  delete DATA.detachments['big-one'].grantsKeywords; renderAll();
  return !unitHasKeyword(DATA.units['demo-buggy'],'WAGON')
      && !document.querySelector('#view-army').textContent.includes('From detachment');
}));

// --- excludesKeyword ("INFANTRY WARBOSS only, excluding MEGA ARMOUR models")
t('exclusion removes an otherwise eligible unit', await p.evaluate(()=>{
  const e=DATA.enhancements['shiny-bit'];
  const before=eligibleEnhancements(armyList.find(i=>i.unitId==='demo-warboss')).map(x=>x.id).includes('shiny-bit');
  e.excludesKeyword='CHARACTER';
  const after=eligibleEnhancements(armyList.find(i=>i.unitId==='demo-warboss')).map(x=>x.id).includes('shiny-bit');
  delete e.excludesKeyword;
  return before===true && after===false;
}));
t('exclusion leaves units without that keyword alone', await p.evaluate(()=>{
  const e=DATA.enhancements['extra-armour'];
  e.excludesKeyword='CHARACTER';
  const boyz=eligibleEnhancements(armyList.find(i=>i.unitId==='demo-boyz')).map(x=>x.id).includes('extra-armour');
  const wb  =eligibleEnhancements(armyList.find(i=>i.unitId==='demo-warboss')).map(x=>x.id).includes('extra-armour');
  delete e.excludesKeyword;
  return boyz===true && wb===false;
}));
t('exclusion accepts a list', await p.evaluate(()=>{
  const e=DATA.enhancements['extra-armour'];
  e.excludesKeyword=['NOPE','MOB'];
  const boyz=eligibleEnhancements(armyList.find(i=>i.unitId==='demo-boyz')).map(x=>x.id).includes('extra-armour');
  delete e.excludesKeyword;
  return boyz===false;
}));

// ...and the OR counterpart: "BIG MEK or PAINBOY model only".
t('any-keyword matches on the first', await p.evaluate(()=>unitHasAnyKeyword(DATA.units['demo-buggy'],['VEHICLE','NOPE']))===true);
t('any-keyword matches on the last', await p.evaluate(()=>unitHasAnyKeyword(DATA.units['demo-buggy'],['NOPE','VEHICLE']))===true);
t('any-keyword fails when none match', await p.evaluate(()=>unitHasAnyKeyword(DATA.units['demo-buggy'],['NOPE','ALSO-NOPE']))===false);
t('any-keyword is OR, not AND',
  await p.evaluate(()=>unitHasAnyKeyword(DATA.units['demo-buggy'],['VEHICLE','INFANTRY']))===true);
t('AND and OR disagree on the same input, proving they are distinct', await p.evaluate(()=>
  unitHasAnyKeyword(DATA.units['demo-buggy'],['VEHICLE','INFANTRY'])===true &&
  unitHasKeyword(DATA.units['demo-buggy'],['VEHICLE','INFANTRY'])===false));
t('restrictedToAnyKeyword gates enhancement eligibility', await p.evaluate(()=>{
  const e=DATA.enhancements['extra-armour'];
  e.restrictedToAnyKeyword=['VEHICLE','MOB'];
  const boyz=eligibleEnhancements(armyList.find(i=>i.unitId==='demo-boyz')).map(x=>x.id);
  const bug =eligibleEnhancements(armyList.find(i=>i.unitId==='demo-buggy')).map(x=>x.id);
  e.restrictedToAnyKeyword=['CHARACTER'];
  const boyz2=eligibleEnhancements(armyList.find(i=>i.unitId==='demo-boyz')).map(x=>x.id);
  delete e.restrictedToAnyKeyword;
  // MOB and VEHICLE between them cover both units; CHARACTER covers neither.
  return boyz.includes('extra-armour') && bug.includes('extra-armour') && !boyz2.includes('extra-armour');
}));
t('compound restriction narrows enhancement eligibility', await p.evaluate(()=>{
  const was=DATA.enhancements['extra-armour'].restrictedToKeyword;
  DATA.enhancements['extra-armour'].restrictedToKeyword=['ORKS','INFANTRY'];
  const boyz=eligibleEnhancements(armyList.find(i=>i.unitId==='demo-boyz')).map(e=>e.id);
  const bug =eligibleEnhancements(armyList.find(i=>i.unitId==='demo-buggy')).map(e=>e.id);
  DATA.enhancements['extra-armour'].restrictedToKeyword=was;
  return boyz.includes('extra-armour') && !bug.includes('extra-armour');
}));

// --- enhancements / upgrades
const wb=await p.evaluate(()=>armyList.find(i=>i.unitId==='demo-warboss').uid);
t('warboss eligible for both', await p.evaluate(u=>eligibleEnhancements(armyList.find(i=>i.uid===u)).map(e=>e.id).sort().join(),wb)==='extra-armour,shiny-bit');
t('boyz (non-character) eligible for upgrade only',
  await p.evaluate(()=>eligibleEnhancements(armyList[0]).map(e=>e.id).join())==='extra-armour');
await p.evaluate(u=>{armyList.find(i=>i.uid===u).enhancementId='shiny-bit';renderAll();},wb);
t('enhancement adds points', await p.evaluate(u=>instancePoints(armyList.find(i=>i.uid===u)),wb)===100);
t('★ on builder header', await p.evaluate(()=>document.querySelectorAll('#view-builder .star').length)===1);
t('2nd copy of an Enhancement blocked', await p.evaluate(()=>enhancementBlockReason('shiny-bit',armyList[0]))==='taken');
// grantsAbilities entries are either a plain id, or {id,display} when the
// datasheet wording carries something the ability's own name doesn't (Scouts 9").
// The warboss is attached, so its Enhancement renders inside the merged card.
const grantPills=()=>p.evaluate(()=>{
  const c=[...document.querySelectorAll('#view-army .unit')].find(x=>x.querySelector('.leader-band'));
  return [...c.querySelectorAll('.pill.grant')].map(x=>({txt:x.textContent, ab:x.dataset.ab}));
});
t('string grant renders the ability name',
  (await grantPills()).some(x=>x.txt==='Lethal Hits' && x.ab==='lethal-hits'));
await p.evaluate(()=>{
  DATA.enhancements['shiny-bit'].grantsAbilities=[{id:'lethal-hits',display:'Lethal Hits 9"'}];
  renderAll();
});
t('object grant renders its display text instead',
  (await grantPills()).some(x=>x.txt==='Lethal Hits 9"'));
t('object grant still resolves to its ability id',
  (await grantPills()).some(x=>x.txt==='Lethal Hits 9"' && x.ab==='lethal-hits'));
t('object grant does not leave the plain name behind',
  !(await grantPills()).some(x=>x.txt==='Lethal Hits'));
await p.evaluate(()=>{DATA.enhancements['shiny-bit'].grantsAbilities=['lethal-hits'];renderAll();});
// upgrades: 3 copies allowed, only 1st counts toward cap
await p.evaluate(()=>{armyList[0].enhancementId='extra-armour';armyList[1].enhancementId='extra-armour';armyList[2].enhancementId='extra-armour';renderAll();});
t('3 upgrade copies allowed', await p.evaluate(()=>armyList.filter(i=>i.enhancementId==='extra-armour').length)===3);
t('upgrades charged per copy', await p.evaluate(()=>instancePoints(armyList[1]))===110);
t('cap counts distinct upgrade once (1 enh + 1 upg = 2)', await p.evaluate(()=>countArmyEnhancements())===2);
const bg=await p.evaluate(()=>armyList.filter(i=>i.unitId==='demo-buggy')[0].uid);
t('4th upgrade copy blocked', await p.evaluate(u=>enhancementBlockReason('extra-armour',armyList.find(i=>i.uid===u)),bg)==='max 3');

// --- one Enhancement per unit, Attached units included (25.04). At this point the
//     warboss (Shiny Bit) leads armyList[0], which was handed Extra Armour directly.
const ONE='attached unit already has one';
t('a unit led by an enhanced leader cannot take an Upgrade of its own', await p.evaluate(()=>{
  const keep=armyList[0].enhancementId; armyList[0].enhancementId=null;
  const r=enhancementBlockReason('extra-armour',armyList[0]); armyList[0].enhancementId=keep; return r;})===ONE);
t('...and the leader cannot take one while its unit has one', await p.evaluate(u=>{
  const w=armyList.find(i=>i.uid===u), keep=w.enhancementId; w.enhancementId=null;
  const r=enhancementBlockReason('shiny-bit',w); w.enhancementId=keep; return r;},wb)===ONE);
t('...but either can once the other gives its own up', await p.evaluate(u=>{
  const w=armyList.find(i=>i.uid===u), kw=w.enhancementId, k0=armyList[0].enhancementId;
  w.enhancementId=null; armyList[0].enhancementId=null;
  const r=enhancementBlockReason('shiny-bit',w)===null && enhancementBlockReason('extra-armour',armyList[0])===null;
  w.enhancementId=kw; armyList[0].enhancementId=k0; return r;},wb));
t('a clash already in the list is flagged on both cards, not removed', await p.evaluate(u=>{
  renderBuilder();
  const n=[...document.querySelectorAll('#view-builder .rulewarn')].filter(x=>x.textContent.includes('only one Enhancement')).length;
  return n===2 && armyList[0].enhancementId==='extra-armour' && armyList.find(i=>i.uid===u).enhancementId==='shiny-bit';},wb));
t('the Led by control refuses an attachment that would double up', await p.evaluate(u=>{
  armyList[0].leaderId=null; renderAll();                       // detach, so the leader is on offer again
  const sel=document.querySelector(`[data-leader="${armyList[0].uid}"]`);
  const disabled=[...sel.options].find(o=>o.value===u).disabled;
  sel.value=u; sel.dispatchEvent(new Event('change',{bubbles:true}));   // push past the disabled option
  const refused=armyList[0].leaderId===null;
  armyList[0].leaderId=u; renderAll();
  return disabled && refused;},wb));
t('the Enhancement control refuses a pick the rules block', await p.evaluate(u=>{
  const k0=armyList[0].enhancementId; armyList[0].enhancementId=null; renderAll();
  const sel=document.querySelector(`[data-enhsel="${armyList[0].uid}"]`);
  const disabled=[...sel.options].find(o=>o.value==='extra-armour').disabled;
  sel.value='extra-armour'; sel.dispatchEvent(new Event('change',{bubbles:true}));
  const refused=armyList[0].enhancementId===null;
  armyList[0].enhancementId=k0; renderAll();
  return disabled && refused;},wb));
t('the Enhancement limit follows the battle size', await p.evaluate(u=>{
  const keep=pointsLimit, bug=armyList.find(i=>i.uid===u);
  DATA.enhancements['tmp-upg']={name:'Tmp',points:1,upgrade:true,detachment:'other'};
  const strike=enhancementBlockReason('tmp-upg',bug);            // 2 in use + 1 = 3 of 4
  pointsLimit=1000; const incursion=enhancementBlockReason('tmp-upg',bug);   // 3 of 2
  pointsLimit=keep; delete DATA.enhancements['tmp-upg'];
  return strike===null && incursion==='cap';},bg));
t('the overview shows the limit for the current battle size', await p.evaluate(()=>{
  renderBuilder(); const a=document.querySelector('#pEnh .tag').textContent;
  const keep=pointsLimit; pointsLimit=1000; renderBuilder(); const b=document.querySelector('#pEnh .tag').textContent;
  pointsLimit=keep; renderBuilder(); return a==='2/4 used' && b==='2/2 used';}));
t('an enhancement that carries a weapon shows its profile', await p.evaluate(()=>{
  const el=document.createElement('div');
  el.innerHTML=enhancementWeaponHtml({weapon:{name:'Boomstick',range:'24"',a:'6',bs:'4+',s:'7',ap:'-2',d:'2',
    abilities:[{id:'rapid-fire',display:'Rapid Fire 6'},'lethal-hits']}});
  return el.querySelector('.wn').textContent==='Boomstick' && el.querySelectorAll('.wst').length===6
      && [...el.querySelectorAll('.pill')].map(x=>x.textContent).join()==='Rapid Fire 6,Lethal Hits'
      && enhancementWeaponHtml({})==='';}));

// --- Support units (core rules 19.01): a Bodyguard unit takes one Leader AND one
//     Support unit. Here armyList[0] is still led by the warboss.
await p.evaluate(()=>{
  DATA.units['tmp-doc']={id:'tmp-doc',name:'Tmp Doc',keywords:['INFANTRY','CHARACTER','ORKS'],isSupport:true,points:45,models:1,
    stats:{},weapons:{melee:[{name:'Saw',count:1,a:'1',ws:'3+',s:'4',ap:'0',d:'1',abilities:[]}]},canLead:['demo-boyz'],
    unitWeaponAbilities:[{appliesTo:'melee',abilityId:'lethal-hits',display:'Lethal Hits (doc)'}]};
  addUnit('tmp-doc');
});
const doc=await p.evaluate(()=>armyList.find(i=>i.unitId==='tmp-doc').uid);
t('a Support unit is offered in its own slot, not as a leader', await p.evaluate(u=>
  availableLeadersFor(armyList[0],'supportId').map(x=>x.uid).join()===u
  && !availableLeadersFor(armyList[0]).some(x=>x.uid===u)
  && availableLeadersFor(armyList.find(i=>i.unitId==='demo-buggy'),'supportId').length===0,doc));
t('an unattached Support unit is flagged', await p.evaluate(u=>{
  renderBuilder();
  return isLooseSupport(armyList.find(x=>x.uid===u))
      && [...document.querySelectorAll('#view-builder .rulewarn')].some(x=>x.textContent.includes('Support unit must be attached'));},doc));
t('a unit can have a Leader and a Support unit at once', await p.evaluate(u=>{
  renderAll();
  const sel=document.querySelector(`[data-support="${armyList[0].uid}"]`);
  sel.value=u; sel.dispatchEvent(new Event('change',{bubbles:true}));
  return armyList[0].supportId===u && armyList[0].leaderId!==null && !isLooseSupport(armyList.find(x=>x.uid===u))
      && ![...document.querySelectorAll('#view-builder .rulewarn')].some(x=>x.textContent.includes('Support unit must be attached'));},doc));
const merged3=`[...document.querySelectorAll('#view-army .unit')].find(x=>x.querySelectorAll('.leader-band').length===3)`;
t('the merged card has a section each for Leader, Support and Unit', await p.evaluate(sel=>{
  renderArmy(); const c=eval(sel);
  return !!c && [...c.querySelectorAll('.leader-band')].map(b=>b.textContent.split(' — ')[0]).join()==='Leader,Support,Unit';},merged3));
t('...and its points are the sum of all three', await p.evaluate(([sel,u])=>{
  const c=eval(sel), l=armyList.find(i=>i.uid===armyList[0].leaderId), s=armyList.find(i=>i.uid===u);
  return parseInt(c.querySelector('.pts').textContent,10)===instancePoints(armyList[0])+instancePoints(l)+instancePoints(s);},[merged3,doc]));
t('an attached Support unit is not a card of its own', await p.evaluate(()=>
  ![...document.querySelectorAll('#view-army .unit-hd h3')].some(h=>h.firstChild.textContent.includes('Tmp Doc'))));
t('a unit-wide weapon ability reaches every weapon row in the Attached unit', await p.evaluate(sel=>{
  const rows=[...eval(sel).querySelectorAll('.wrow.melee')];
  const hit=rows.filter(r=>[...r.querySelectorAll('.pill.inh')].some(p=>p.textContent==='Lethal Hits (doc)')).length;
  return rows.length>=3 && hit===rows.length;},merged3));
t('the one-Enhancement rule reaches the Support unit too', await p.evaluate(u=>{
  DATA.enhancements['tmp-upg']={name:'Tmp',points:1,upgrade:true,detachment:'other'};
  const r=enhancementBlockReason('tmp-upg',armyList.find(i=>i.uid===u));
  delete DATA.enhancements['tmp-upg']; return r;},doc)==='attached unit already has one');
t('share pack and instance shape carry the Support attachment', await p.evaluate(u=>
  packList().a[0].S===armyList.findIndex(i=>i.uid===u)
  && normalizeInstance({unitId:'demo-boyz',supportId:'x'}).supportId==='x'
  && normalizeInstance({unitId:'demo-boyz'}).supportId===null,doc));
t('a share link restores the Support attachment', await p.evaluate(async u=>{
  const keepA=JSON.stringify(armyList), keepD=selectedDetachments.slice(), keepN=listName, keepL=pointsLimit;
  const ok=unpackList(await decodeShare(await encodeShare()));
  const s=armyList[0].supportId, r=ok && s!==null && armyList.find(i=>i.uid===s)?.unitId==='tmp-doc';
  armyList=JSON.parse(keepA); selectedDetachments=keepD; listName=keepN; pointsLimit=keepL; save(); renderAll();
  return r;},doc));
t('text export names the Support unit', await p.evaluate(()=>exportText().includes('Support: Tmp Doc')));
t('duplicating a unit does not copy its Support attachment', await p.evaluate(()=>{
  duplicateInstance(armyList[0].uid); const copy=armyList[1];
  const r=copy.unitId==='demo-boyz' && copy.supportId===null && copy.leaderId===null;
  removeInstance(copy.uid); return r;}));
t('removing a Support unit clears the link and leaves the leader', await p.evaluate(u=>{
  removeInstance(u); delete DATA.units['tmp-doc']; renderAll();
  return armyList[0].supportId===null && armyList[0].leaderId!==null && !armyList.some(i=>i.unitId==='tmp-doc');},doc));

// --- wargear options: one decision each, the loadout is derived from the picks
t('a wargear option swaps weapons instead of adding them', await p.evaluate(()=>{
  const u={id:'x',name:'X',weapons:{ranged:[
      {name:'Gun',count:1,abilities:[]},
      {name:'Kombi - A',count:1,abilities:[],weaponGroup:'Kombi'},{name:'Kombi - B',count:1,abilities:[],weaponGroup:'Kombi'}],
    melee:[{name:'Choppa',count:1,abilities:[]},{name:'Klaw',count:1,abilities:[]},{name:'Fist',count:1,abilities:[]}]},
    wargearOptions:[
      {id:'r',label:'Gun',choices:[{id:'gun',name:'Gun',weapons:['Gun']},{id:'kombi',name:'Kombi',weapons:['Kombi']}]},
      {id:'m',label:'Choppa',choices:[{id:'choppa',name:'Choppa',weapons:['Choppa']},{id:'klaw',name:'Klaw',weapons:['Klaw']}]},
      {id:'x',label:'Also',choices:[{id:'none',name:'none'},{id:'ff',name:'Field',abilities:['stealth']}]}]};
  const sum=slots=>weaponSummaryText(u,{slots});
  return sum({})==='Gun, Choppa, Fist'                       // printed loadout; Fist is in no option, so always carried
      && sum({r:'kombi'})==='Kombi, Choppa, Fist'            // a weaponGroup swaps in as one item
      && sum({r:'kombi',m:'klaw'})==='Kombi, Klaw, Fist'
      && sum({r:'nonsense'})==='Gun, Choppa, Fist'           // an unknown pick falls back to the default
      && optionAbilities(u,{slots:{x:'ff'}}).join()==='stealth' && optionAbilities(u,{slots:{}}).length===0
      && nonDefaultChoices(u,{slots:{m:'klaw'}}).map(c=>c.name).join()==='Klaw'
      && nonDefaultChoices(u,{slots:{}}).length===0;}));
t('the Builder has one picker per option; only a non-default pick is stored', await p.evaluate(()=>{
  DATA.units['tmp-boss']={id:'tmp-boss',name:'Tmp Boss',keywords:['INFANTRY','ORKS'],points:10,models:1,stats:{},fixedWeapons:true,
    weapons:{melee:[{name:'Choppa',count:1,abilities:[]},{name:'Klaw',count:1,abilities:[]}]},
    wargearOptions:[{id:'m',label:'Choppa',choices:[{id:'choppa',name:'Choppa',weapons:['Choppa']},{id:'klaw',name:'Klaw',weapons:['Klaw']}]}]};
  addUnit('tmp-boss'); const i=armyList[armyList.length-1];
  const pick=v=>{const s=document.querySelector(`[data-opt="${i.uid}:m"]`); s.value=v; s.dispatchEvent(new Event('change',{bubbles:true}));};
  const card=()=>[...document.querySelectorAll('#view-army .unit')].find(c=>c.querySelector('h3').textContent.includes('Tmp Boss'));
  const before=[...card().querySelectorAll('.wn')].map(x=>x.textContent).join();
  pick('klaw');
  const stored=JSON.stringify(i.slots), sum=weaponSummaryText(DATA.units['tmp-boss'],i);
  const after=[...card().querySelectorAll('.wn')].map(x=>x.textContent).join(), exp=exportText().includes('Options: Klaw');
  pick('choppa'); const cleared=JSON.stringify(i.slots);
  removeInstance(i.uid); delete DATA.units['tmp-boss']; renderAll();
  return before==='Choppa' && stored==='{"m":"klaw"}' && sum==='Klaw' && after==='Klaw' && exp && cleared==='{}';}));

// --- squads: the model mix follows the unit's size, and wargear options are
//     decided per model ("any number of Nobz can each...", "1 Boy per 10 models...")
const SQUAD=`({id:'tmp-mob',name:'Tmp Mob',keywords:['INFANTRY','ORKS'],points:80,models:10,stats:{},fixedWeapons:true,
  costing:{escalationAfter:3,tiers:[[{models:10,points:80},{models:20,points:160}],[{models:10,points:90},{models:20,points:170}]]},
  composition:{'10':{Nob:1,Boy:9},'20':{Nob:2,Boy:18}},
  modelProfiles:[{name:'Boy',plural:'Boyz',stats:{}},{name:'Nob',plural:'Nobz',stats:{}}],
  weapons:{ranged:[{name:'Shoota',carriedBy:'Boy',abilities:[]},{name:'Slugga',carriedBy:['Nob','Boy'],abilities:[]},
                   {name:'Big Shoota',abilities:[]},
                   {name:'Kombi - A',weaponGroup:'Kombi',abilities:[]},{name:'Kombi - B',weaponGroup:'Kombi',abilities:[]}],
           melee:[{name:'Choppa',carriedBy:'Boy',abilities:[]},{name:'Klaw',carriedBy:'Nob',abilities:[]},{name:'Big Choppa',abilities:[]}]},
  wargearOptions:[
    {id:'nob',label:'Nob',model:'Nob',choices:[{id:'klaw',name:'Klaw',weapons:['Klaw']},
      {id:'klaw-kombi',name:'Klaw + Kombi',weapons:['Klaw','Kombi']},{id:'big',name:'Big Choppa',weapons:['Big Choppa']}]},
    {id:'big-shoota',label:'Big Shoota',per:10,choices:[{id:'shoota',name:'Shoota',weapons:['Shoota']},
      {id:'big-shoota',name:'Big Shoota',weapons:['Big Shoota']}]}]})`;
t('a squad starts with one of each weapon per model that carries it', await p.evaluate(s=>{
  const u=eval(s), sum=models=>weaponSummaryText(u,{models,slots:{}});
  return sum(10)==='9× Shoota, 10× Slugga, 9× Choppa, Klaw' && sum(20)==='18× Shoota, 20× Slugga, 18× Choppa, 2× Klaw';},SQUAD));
t('a "1 per 10 models" option is a count, and each one swaps a single weapon', await p.evaluate(s=>{
  const u=eval(s), sum=(models,slots)=>weaponSummaryText(u,{models,slots});
  return sum(10,{'big-shoota':1})==='8× Shoota, 10× Slugga, Big Shoota, 9× Choppa, Klaw'
      && sum(20,{'big-shoota':2})==='16× Shoota, 20× Slugga, 2× Big Shoota, 18× Choppa, 2× Klaw'
      && sum(10,{'big-shoota':2})==='8× Shoota, 10× Slugga, Big Shoota, 9× Choppa, Klaw';}, SQUAD));   // only one model may at 10
t('an "any number of models can each" option is one pick per model', await p.evaluate(s=>{
  const u=eval(s), sum=(models,slots)=>weaponSummaryText(u,{models,slots});
  return sum(20,{nob:['big','klaw-kombi']})==='18× Shoota, 20× Slugga, Kombi, 18× Choppa, Klaw, Big Choppa'
      && sum(20,{nob:'big'})==='18× Shoota, 20× Slugga, 18× Choppa, Klaw, Big Choppa'      // a lone id is the first model's pick
      && sum(10,{nob:['klaw','big']})==='9× Shoota, 10× Slugga, 9× Choppa, Klaw';}, SQUAD)); // the second Nob is not there at 10
t('the model mix and the option labels follow the size', await p.evaluate(s=>{
  const u=eval(s);
  return breakdownText(u,{models:10})==='1 Nob + 9 Boyz' && breakdownText(u,{models:20})==='2 Nobz + 18 Boyz'
      && modelCount(u,{models:20},'Boy')===18 && modelCount({},{},'x')===null
      && breakdownText({modelBreakdown:'1 Warboss'},{})==='1 Warboss'
      && nonDefaultChoices(u,{models:20,slots:{'big-shoota':2,nob:['big','big']}}).map(c=>c.name).join()==='2× Big Choppa,2× Big Shoota';},SQUAD));
t('Builder: a stepper for a counted option, a picker per model, and resizing keeps the loadout legal', (await p.evaluate(s=>{
  DATA.units['tmp-mob']=eval(s); addUnit('tmp-mob'); const i=armyList[armyList.length-1], u=DATA.units['tmp-mob'];
  const q=sel=>document.querySelector(sel), step=d=>q(`[data-optn="${i.uid}:big-shoota:${d}"]`).click();
  const size=d=>q(`[data-size="${i.uid}:${d}"]`).click();
  const pickers=()=>document.querySelectorAll(`[data-opt="${i.uid}:nob"]`).length;
  const r={};
  r.at10=pickers()===1 && instancePoints(i)===80;
  step(1); step(1); r.cap10=i.slots['big-shoota']===1;                       // 1 per 10 models
  size(1); r.at20=i.models===20 && pickers()===2 && instancePoints(i)===160;
  step(1); r.two=i.slots['big-shoota']===2;
  const s2=document.querySelectorAll(`[data-opt="${i.uid}:nob"]`)[1]; s2.value='big'; s2.dispatchEvent(new Event('change',{bubbles:true}));
  r.second=JSON.stringify(i.slots.nob)==='["klaw","big"]' && weaponSummaryText(u,i).includes('Big Choppa');
  size(-1); r.shrunk=i.models===10 && i.slots['big-shoota']===1 && i.slots.nob===undefined && !weaponSummaryText(u,i).includes('Big Choppa');
  step(-1); r.cleared=JSON.stringify(i.slots)==='{}';
  const card=[...document.querySelectorAll('#view-army .unit')].find(c=>c.querySelector('h3').textContent.includes('Tmp Mob'));
  r.card=[...card.querySelectorAll('.prof-n')].map(x=>x.textContent).join()==='Boy ×9,Nob ×1' && card.querySelector('.sub').textContent.includes('1 Nob + 9 Boyz');
  removeInstance(i.uid); delete DATA.units['tmp-mob']; renderAll();
  return Object.entries(r).filter(([,v])=>!v).map(([k])=>k).join()||true;},SQUAD))===true);

// --- wargear that costs points, fixed pools ("up to 4"), weapons carried several to
//     a model, and options that share one weapon between them
const MEGA=`({id:'tmp-mega',name:'Tmp Mega',keywords:['INFANTRY','ORKS'],points:70,models:2,stats:{},fixedWeapons:true,
  costing:{escalationAfter:2,tiers:[[{models:2,points:70},{models:3,points:105}],[{models:2,points:110},{models:3,points:145}]]},
  composition:{'2':{Mega:2},'3':{Mega:3}},
  weapons:{ranged:[{name:'Shoota',carriedBy:'Mega',abilities:[]},{name:'Kombi',abilities:[]},
                   {name:'Pistol',carriedBy:{Mega:2},abilities:[]},{name:'Big Shoota',abilities:[]}],
           melee:[{name:'Klaw',carriedBy:'Mega',abilities:[]},{name:'Saw',abilities:[]},{name:'Twin Saws',abilities:[]}]},
  wargearOptions:[
    {id:'saw',label:'Saw',per:1,choices:[{id:'klaw',name:'Klaw',weapons:['Klaw']},{id:'saw',name:'Saw',weapons:['Saw'],points:5}]},
    {id:'kombi',label:'Kombi',per:1,choices:[{id:'shoota',name:'Shoota',weapons:['Shoota']},{id:'kombi',name:'Kombi',weapons:['Kombi']}]},
    {id:'twin',label:'Twin Saws',per:1,choices:[{id:'both',name:'Klaw + Shoota',weapons:['Klaw','Shoota']},
      {id:'twin',name:'Twin Saws',weapons:['Twin Saws'],points:5}]},
    {id:'big',label:'Big Shoota',pool:4,choices:[{id:'none',name:'none'},{id:'big',name:'Big Shoota',weapons:['Big Shoota']}]},
    {id:'pistol',label:'Pistol',pool:1,choices:[{id:'none',name:'none'},{id:'pistol',name:'Extra Pistol',weapons:['Pistol']}]}]})`;
t('a model can carry several of a weapon, and add-ons stack on top up to their pool', await p.evaluate(s=>{
  const u=eval(s), sum=(models,slots)=>weaponSummaryText(u,{models,slots});
  return sum(2,{})==='2× Shoota, 4× Pistol, 2× Klaw' && sum(3,{})==='3× Shoota, 6× Pistol, 3× Klaw'
      && sum(2,{pistol:1,big:3})==='2× Shoota, 5× Pistol, 3× Big Shoota, 2× Klaw'
      && sum(2,{big:9})==='2× Shoota, 4× Pistol, 4× Big Shoota, 2× Klaw';},MEGA));   // "up to 4"
t('wargear that costs points is paid by every model that takes it', await p.evaluate(s=>{
  const u=eval(s), pts=slots=>optionPoints(u,{models:3,slots});
  return pts({})===0 && pts({saw:2})===10 && pts({saw:1,twin:1})===10 && pts({kombi:3})===0;},MEGA));
t('Builder: options that swap out the same weapon share it, and wargear costs are added', (await p.evaluate(s=>{
  DATA.units['tmp-mega']=eval(s); addUnit('tmp-mega'); const i=armyList[armyList.length-1], u=DATA.units['tmp-mega'];
  const q=sel=>document.querySelector(sel), step=(o,d)=>q(`[data-optn="${i.uid}:${o}:${d}"]`).click();
  const size=d=>q(`[data-size="${i.uid}:${d}"]`).click();
  const r={};
  r.base=instancePoints(i)===70;
  step('saw',1); step('saw',1); r.two=i.slots.saw===2 && instancePoints(i)===80;
  step('twin',1); r.blocked=i.slots.twin===undefined && instancePoints(i)===80;          // both Klaws are Saws already
  step('saw',-1); step('twin',1); r.shared=i.slots.saw===1 && i.slots.twin===1 && instancePoints(i)===80;
  step('kombi',1); step('kombi',1); r.kombi=i.slots.kombi===1;                           // one Shoota went with the Twin Saws
  r.summary=weaponSummaryText(u,i)==='Kombi, 4× Pistol, Saw, Twin Saws';
  r.hint=[...document.querySelectorAll('#view-builder .unit')].some(c=>c.textContent.includes('Tmp Mega') && c.textContent.includes('+5 pts each'));
  r.exported=exportText().includes('Saw (+5 pts), Kombi, Twin Saws (+5 pts)');
  size(1); r.grown=i.models===3 && instancePoints(i)===115;
  step('saw',1); r.three=i.slots.saw===2 && instancePoints(i)===120;
  size(-1); r.pruned=i.models===2 && i.slots.saw===2 && i.slots.twin===undefined && i.slots.kombi===1 && instancePoints(i)===80;
  removeInstance(i.uid); delete DATA.units['tmp-mega']; renderAll();
  return Object.entries(r).filter(([,v])=>!v).map(([k])=>k).join()||true;},MEGA))===true);
t('the add-a-unit list groups datasheets by kind', await p.evaluate(()=>{
  const ids=['tmp-trukk','tmp-jet','tmp-rig','tmp-kan'];
  const mk=(id,kw)=>{DATA.units[id]={id,name:id,keywords:kw,points:10,models:1,stats:{},weapons:{}}; DATA.unitOrder.push(id);};
  mk(ids[0],['VEHICLE','DEDICATED TRANSPORT','TRANSPORT']); mk(ids[1],['VEHICLE','AIRCRAFT','FLY']); mk(ids[2],['MONSTER','TRANSPORT']); mk(ids[3],['VEHICLE','WALKER']);
  const h=addUnitControl(), grp=id=>{const m=h.slice(0,h.indexOf(`value="${id}"`)).match(/optgroup label="([^"]+)"/g); return m[m.length-1].slice(16,-1);};
  const ok=grp(ids[0])==='Dedicated Transports' && grp(ids[1])==='Aircraft' && grp(ids[2])==='Monsters' && grp(ids[3])==='Vehicles';
  ids.forEach(id=>{delete DATA.units[id]; DATA.unitOrder.splice(DATA.unitOrder.indexOf(id),1);});
  return ok;}));

// --- datasheet abilities that reach the weapon rows, and permanent calls
t('a core ability can carry its printed value', await p.evaluate(()=>{
  const el=document.createElement('div');
  el.innerHTML=unitBody({id:'x',name:'X',stats:{},coreAbilities:['stealth',{id:'deadly-demise',display:'Deadly Demise D3'}]},null,{noGrants:true});
  return [...el.querySelectorAll('.pill.core')].map(x=>x.textContent).join()==='Stealth,Deadly Demise D3';}));
t('a unit-wide weapon ability shows on its own rows; a riled-up one only under the call', await p.evaluate(()=>{
  const keep=game.waaagh;
  const u={id:'x',name:'X',stats:{},factionAbilities:['waaagh'],
    weapons:{ranged:[{name:'gun',count:1,abilities:[]}],melee:[{name:'fist',count:1,abilities:[]}]},
    unitWeaponAbilities:[{appliesTo:'ranged',abilityId:'ignores-cover',display:'Ignores Cover'},
                         {appliesTo:'ranged',abilityId:'sustained-hits',display:'Sustained Hits 1',whileCalled:true}]};
  const pills=()=>{const el=document.createElement('div'); el.innerHTML=unitBody(u,null,{noGrants:true});
    return [...el.querySelectorAll('.wrow')].map(r=>[...r.querySelectorAll('.pill.inh')]
      .map(p=>p.textContent+(p.classList.contains('call')?'*':'')).join('+')).join('|');};
  game.waaagh=false; const off=pills(); game.waaagh=true; const on=pills(); game.waaagh=keep;
  return off==='Ignores Cover|' && on==='Ignores Cover+Sustained Hits 1*|';}));
t('a granted ability is hidden only when the weapon already says the same thing', await p.evaluate(()=>{
  const u={id:'x',name:'X',_callWeaponAbilities:[{abilityId:'sustained-hits',display:'Sustained Hits 1'}],
    weapons:{melee:[{name:'a',count:1,abilities:[{id:'sustained-hits',display:'Sustained Hits 2: Monster'}]},
                    {name:'b',count:1,abilities:[{id:'sustained-hits',display:'Sustained Hits 1'}]}]}};
  const el=document.createElement('div'); el.innerHTML=weaponRows(u,null,'melee',{noGrants:true});
  return [...el.querySelectorAll('.wrow')].map(r=>r.querySelectorAll('.pill.call').length).join()==='1,0';}));
t('an always-riled-up datasheet or Enhancement shows the call without the button', await p.evaluate(()=>{
  const keep=game.waaagh; game.waaagh=false;
  const u={id:'x',name:'X',factionAbilities:['waaagh'],invulnerableSave:'6+'};
  const marked=applyCallEffects({...u,alwaysCalled:true}).invulnerableSave, plain=applyCallEffects(u).invulnerableSave;
  DATA.enhancements['tmp-riled']={name:'R',points:1,alwaysCalled:true,detachment:'other'};
  const viaEnh=applyCallEffects(u,{},{enhancementId:'tmp-riled'}).invulnerableSave;
  delete DATA.enhancements['tmp-riled']; game.waaagh=keep;
  return marked==='5+' && plain==='6+' && viaEnh==='5+';}));
t('...and a marked leader covers the unit it leads, but no other', await p.evaluate(()=>{
  DATA.units['demo-warboss'].alwaysCalled=true;
  const led=alwaysUnderCall(DATA.units['demo-boyz'],armyList[0]), other=alwaysUnderCall(DATA.units['demo-boyz'],armyList[1]);
  delete DATA.units['demo-warboss'].alwaysCalled; return led===true && other===false;}));
t("a datasheet's own riled-up clause is listed in the card note", await p.evaluate(()=>{
  const keep=game.waaagh; game.waaagh=true;
  const d=applyCallEffects({id:'x',name:'X',factionAbilities:['waaagh'],whileCalled:[{text:'Move 5 inches',from:'Kunnin'}]});
  game.waaagh=keep; return d._callNotes.some(n=>n.text==='Move 5 inches' && n.from==='Kunnin');}));
t('Epic Heroes get their own group in the unit picker', await p.evaluate(()=>{
  DATA.units['tmp-epic']={id:'tmp-epic',name:'Tmp Epic',keywords:['CHARACTER'],isEpicHero:true,points:1,models:1,stats:{}};
  DATA.unitOrder.push('tmp-epic'); renderBuilder();
  const g=l=>[...(document.querySelector(`#addSel optgroup[label="${l}"]`)?.querySelectorAll('option')||[])].map(o=>o.value).join();
  const r=g('Epic Heroes')==='tmp-epic' && g('Characters')==='demo-warboss';
  DATA.unitOrder.splice(-1); delete DATA.units['tmp-epic']; renderBuilder();
  return r;}));

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
t('phase bar offers All + the five phases', await p.evaluate(()=>
  [...document.querySelectorAll('#view-strats .phbar button')].map(b=>b.dataset.phase).join())==='all,command,movement,shooting,charge,fight');
t('all eligible stratagems shown (2 core + 1 detachment)',
  await p.evaluate(()=>document.querySelectorAll('#view-strats .scard').length)===3);
t('CP force detachment counts as active without the DP picker',
  await p.evaluate(()=>!isDetachmentActive('fixture-det') && isContentDetachmentActive(DATA.stratagems['cp-det-strat'])));
t('grouped by source, Core first', await p.evaluate(()=>
  [...document.querySelectorAll('#view-strats .egroup')].map(x=>x.firstChild.textContent.trim())[0])==='Core');
t('detachment group is named, not shown as a raw id', await p.evaluate(()=>
  [...document.querySelectorAll('#view-strats .egroup')].some(x=>x.textContent.includes('Fixture Detachment'))));
await p.click('#view-strats .phbar button[data-phase="command"]');
t('phase tab narrows the grid', await p.evaluate(()=>document.querySelectorAll('#view-strats .scard').length)===1);
t('selected phase tab is marked', await p.evaluate(()=>
  document.querySelector('#view-strats .phbar button.on').dataset.phase)==='command');
await p.click('#view-strats .phbar button[data-phase="shooting"]');
t('shooting shows the detachment stratagem', await p.evaluate(()=>
  document.querySelector('#view-strats').textContent.includes('CP Det Strat')));
t('cards carry cost and turn badges', await p.evaluate(()=>{
  const c=document.querySelector('#view-strats .scard');
  return !!c.querySelector('.sb.cost') && !!c.querySelector('[class*="sb t-"]');}));
t('turn badge colours differ by turn', await p.evaluate(()=>{
  const g=t=>{const e=document.querySelector('.sb.t-'+t);return e?getComputedStyle(e).color:null;};
  ui.stratPhase='all'; renderStrats();
  return g('either')!==g('opponent');}));
await p.click('#view-strats .scard');
t('tapping a card opens the full text', await p.evaluate(()=>
  document.querySelector('#modal').classList.contains('on') &&
  document.querySelector('#mBody').textContent.includes('WHEN:')));
await p.click('#mClose');
await p.click('#view-strats .phbar button[data-phase="all"]');

// --- detachment removal cleanup
await p.evaluate(()=>toggleDetachment('big-one'));
t('orphaned enhancement cleared', await p.evaluate(u=>armyList.find(i=>i.uid===u).enhancementId,wb)===null);
t('upgrade shared with "other" det survives', await p.evaluate(()=>armyList[0].enhancementId)==='extra-armour');
t('det strat hidden after its detachment is removed', await p.evaluate(()=>{
  ui.stratPhase='all'; renderStrats();
  const names=[...document.querySelectorAll('#view-strats .scard .sn')].map(x=>x.textContent);
  return !names.includes('Det Strat') && names.includes('Core Strat');}));
t('the CP detachment stratagem is unaffected by the DP picker', await p.evaluate(()=>
  [...document.querySelectorAll('#view-strats .scard .sn')].map(x=>x.textContent).includes('CP Det Strat')));
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
// The rule scroll is the only way to read a detachment rule that grants nothing,
// so it must survive on Army — but stay out of Combat Patrol, which has its own.
const scrollShown=()=>p.evaluate(()=>getComputedStyle(document.querySelector('#btnDetInfo')).display!=='none');
t('rule scroll hidden on CP tab', (await scrollShown())===false);
await p.evaluate(()=>setTab('army'));
t('rule scroll shown on Army with a detachment', (await scrollShown())===true);
await p.evaluate(()=>setTab('builder'));
t('rule scroll shown on Builder', (await scrollShown())===true);
// Dropping every detachment also orphans the Enhancements hung off them, so
// stash and restore the list — later tests still expect those points.
const dets=await p.evaluate(()=>selectedDetachments.slice());
const enhs=await p.evaluate(()=>armyList.map(i=>i.enhancementId));
await p.evaluate(()=>{selectedDetachments.slice().forEach(id=>toggleDetachment(id));});
t('rule scroll hidden when no detachment is selected', (await scrollShown())===false);
await p.evaluate(([d,e])=>{
  d.forEach(id=>toggleDetachment(id));
  armyList.forEach((i,n)=>i.enhancementId=e[n]);
  renderAll();
},[dets,enhs]);
t('rule scroll returns with the detachment', (await scrollShown())===true);
t('detachments restored', await p.evaluate(d=>selectedDetachments.slice().sort().join()===d.slice().sort().join(),dets));
t('enhancements restored', await p.evaluate(e=>armyList.map(i=>i.enhancementId).join()===e.join(),enhs));
await p.click('#btnDetInfo');
t('rule scroll opens the Detachment Rules modal',
  await p.evaluate(()=>document.querySelector('#modal').classList.contains('on')
    && document.querySelector('#mTitle').textContent==='Detachment Rules'));
t('modal carries the active rule text',
  await p.evaluate(()=>document.querySelector('#mBody').textContent.includes('Rule text.')));
t('modal shows a disposition colour dot',
  await p.evaluate(()=>document.querySelectorAll('#mBody .cdot').length)===dets.length);
await p.click('#mClose');
await p.evaluate(()=>setTab('cp'));
t('CP force loaded', await p.evaluate(()=>DATA.combatPatrol.name)==='Demo Combat Patrol');
t('CP datasheets loaded from roster (incl. ledBy)',
  await p.evaluate(()=>Object.keys(DATA.cpUnits).sort().join())==='cp-boyz,cp-buggy,cp-nob');
t('CP units kept out of the matched-play pool', await p.evaluate(()=>DATA.units['cp-boyz']===undefined));
t('roster renders one card per entry', await p.evaluate(()=>document.querySelectorAll('#view-cp .unit').length)===4);
t('roster count shown', await p.evaluate(()=>document.querySelector('#view-cp .unit-hd .muted').textContent.trim())==='×2');
t('detachment shown with its DP and category', await p.evaluate(()=>{
  const d=document.querySelector('#cpRule');
  return d.textContent.includes('Fixture Detachment') && d.textContent.includes('1 DP')
      && d.textContent.includes('Purge the Foe') && d.textContent.includes('Detachment rule body');}));
t('missing datasheet flagged, not silent',
  await p.evaluate(()=>document.querySelector('#view-cp').textContent.includes('data/combat-patrol/units/cp-absent.json')));
t('unit totals line', await p.evaluate(()=>document.querySelector('#view-cp .totals').textContent.replace(/\s+/g,' ').includes('5 units')));

// ---- detachment weapon grants
t('keyword match sees the Faction Keywords line, not just the shared list',
  await p.evaluate(()=>unitHasKeyword(DATA.cpUnits['cp-buggy'],'FIXTURE FACTION')
                    && !DATA.cpUnits['cp-buggy'].keywords.includes('FIXTURE FACTION')));
t('keyword match sees a profile-only keyword',
  await p.evaluate(()=>unitHasKeyword(DATA.cpUnits['cp-buggy'],'DRIVER')));
t('a weapon grant is scoped to its weapon type', await p.evaluate(()=>{
  const u=DATA.cpUnits['cp-buggy'];
  return getDetachmentWeaponGrants(u,'melee').length===1 && getDetachmentWeaponGrants(u,'ranged').length===0;}));
t('a unit without the keyword gets no weapon grant',
  await p.evaluate(()=>getDetachmentWeaponGrants(DATA.cpUnits['cp-boyz'],'melee').length)===0);
t('the grant is suppressed on Combat Patrol cards', await p.evaluate(()=>
  !document.querySelector('#view-cp').innerHTML.includes('Lethal Hits (det)')));
t('  ...but reaches matched-play weapon rows', await p.evaluate(()=>{
  DATA.units['demo-boyz'].factionKeywords=['FIXTURE FACTION'];
  setTab('army'); renderArmy();
  const hit=document.querySelector('#view-army .wrow.melee .pill.inh');
  const ok=!!hit && hit.textContent==='Lethal Hits (det)';
  delete DATA.units['demo-boyz'].factionKeywords; renderArmy(); setTab('cp'); return ok;}));

// ---- scoped keywords
const buggyCard = () => p.evaluate(()=>{
  const c=[...document.querySelectorAll('#view-cp .unit')].find(x=>x.querySelector('h3').textContent.includes('CP Buggy'));
  const sec=[...c.querySelectorAll('.sec')].find(x=>x.querySelector('.sec-t')?.textContent==='Keywords');
  return [...sec.querySelectorAll('.kwrow')].map(r=>
    r.querySelector('.kwlab').textContent + ': ' + [...r.querySelectorAll('.pill.kw')].map(k=>k.textContent).join(','));});
t('keywords are scoped by row', JSON.stringify(await buggyCard())===JSON.stringify([
  'All models: VEHICLE,ORKS', 'Driver: DRIVER,FIXTURE HERO', 'Faction keywords: FIXTURE FACTION']));
t('a profile with no keywords gets no row', await p.evaluate(()=>{
  const c=[...document.querySelectorAll('#view-cp .unit')].find(x=>x.querySelector('h3').textContent.includes('CP Buggy'));
  return !c.textContent.includes('Gunner:');}));
t('a unit with a flat keyword list renders unlabelled as before', await p.evaluate(()=>{
  const c=[...document.querySelectorAll('#view-cp .unit')].find(x=>x.querySelector('h3').textContent.includes('CP Boyz'));
  const sec=[...c.querySelectorAll('.sec')].find(x=>x.querySelector('.sec-t')?.textContent==='Keywords');
  return sec.querySelectorAll('.kwrow').length===0 && sec.querySelectorAll('.pill.kw').length>0;}));

// ---- per-model-profile invulnerable saves
t('each profile shows its own invulnerable save', await p.evaluate(()=>{
  const c=[...document.querySelectorAll('#view-cp .unit')].find(x=>x.querySelector('h3').textContent.includes('CP Buggy'));
  return [...c.querySelectorAll('.inv')].map(e=>e.textContent.match(/\d\+/)[0]).join()==='4+,6+';}));
t('a profile-level footnote is rendered', await p.evaluate(()=>{
  const c=[...document.querySelectorAll('#view-cp .unit')].find(x=>x.querySelector('h3').textContent.includes('CP Buggy'));
  return c.textContent.includes('Fixture footnote about this save');}));
t('the call improves only the profiles that are worse', await p.evaluate(()=>{
  const keep=game.waaagh; game.waaagh=true;   // effects only apply while called
  const u={id:'x',factionAbilities:['waaagh'],modelProfiles:[
    {name:'a',count:1,stats:{},invulnerableSave:'4+'},
    {name:'b',count:1,stats:{},invulnerableSave:'6+'},
    {name:'c',count:1,stats:{}}]};
  const d=applyCallEffects(u); game.waaagh=keep;
  return d.modelProfiles.map(p=>p.invulnerableSave+(p._invulnFromCall?'*':'')).join()==='4+,5+*,5+*';}));
t('a unit-level save still works when no profile carries one', await p.evaluate(()=>{
  const keep=game.waaagh; game.waaagh=true;
  const u={id:'x',factionAbilities:['waaagh'],invulnerableSave:'6+',modelProfiles:[{name:'a',count:1,stats:{}}]};
  const r=applyCallEffects(u).invulnerableSave; game.waaagh=keep;
  return r==='5+';}));
t('each unit answers to the call ability it carries, not a global one', await p.evaluate(()=>{
  const keep=game.waaagh; game.waaagh=true;
  DATA.abilities['other-call']={name:'Other',callEffects:{invulnerableSave:'3+',
    weaponAbilities:[{appliesTo:'ranged',abilityId:'assault',display:'Assault'}]}};
  const a=applyCallEffects({id:'a',factionAbilities:['waaagh'],invulnerableSave:'6+'});
  const b=applyCallEffects({id:'b',factionAbilities:['other-call'],invulnerableSave:'6+'});
  const c=applyCallEffects({id:'c',factionAbilities:['fixture-faction'],invulnerableSave:'6+'});
  delete DATA.abilities['other-call']; game.waaagh=keep;
  return a.invulnerableSave==='5+' && !a._callWeaponAbilities
      && b.invulnerableSave==='3+' && b._callWeaponAbilities.length===1
      && c.invulnerableSave==='6+';}));
t('a called weapon ability lands on matching rows only, and never twice', await p.evaluate(()=>{
  const u={id:'x',name:'X',_callWeaponAbilities:[{appliesTo:'ranged',abilityId:'assault',display:'Assault'}],
    weapons:{ranged:[{name:'gun',count:1,abilities:[]},{name:'fast gun',count:1,abilities:['assault']}],
             melee:[{name:'fist',count:1,abilities:[]}]}};
  const el=document.createElement('div');
  el.innerHTML=weaponRows(u,null,'ranged',{noGrants:true})+weaponRows(u,null,'melee',{noGrants:true});
  return [...el.querySelectorAll('.wrow')].map(r=>r.querySelectorAll('.pill.call').length).join()==='1,0,0';}));
t('a leader can name units whose datasheets are missing', await p.evaluate(()=>
  unitDisplayName('breaka-boyz')==='Breaka Boyz' && unitDisplayName('cp-boyz')==='CP Boyz'));

// ---- force choices: one enhancement, one attached leader
await p.evaluate(()=>{cpChoice={enh:null,leader:null,target:null};save();renderCombatPatrol();});
t('choices start empty', await p.evaluate(()=>document.querySelectorAll('#view-cp .leader-band').length)===0);
t('picker offers exactly the force enhancements', await p.evaluate(()=>
  [...document.querySelectorAll('[data-cpenhpick]')].map(b=>b.dataset.cpenhpick).join()==='fix-enh,fix-upg'));
t('every option shows its rule BEFORE selection', await p.evaluate(()=>
  [...document.querySelectorAll('[data-cpenhpick]')].every(b =>
    b.querySelector('.d') && b.querySelector('.d').textContent.trim().length > 0)));
t('nothing is selected yet, so the rules are visible unselected', await p.evaluate(()=>
  cpChoice.enh===null && document.querySelectorAll('[data-cpenhpick].on').length===0));
t('each option says what it goes on', await p.evaluate(()=>
  [...document.querySelectorAll('[data-cpenhpick]')].every(b =>
    /WARBOSS|BUGGY|NOB/i.test(b.textContent))));
t('an Upgrade is tagged as one before selection', await p.evaluate(()=>
  !!document.querySelector('[data-cpenhpick="fix-upg"] .tag.up')));

// enhancement -> star on the right card, and its effects applied
await p.click('[data-cpenhpick="fix-upg"]'); await p.waitForTimeout(150);
t('the chosen card is marked selected', await p.evaluate(()=>
  document.querySelector('[data-cpenhpick="fix-upg"]').classList.contains('on') &&
  document.querySelector('[data-cpenhpick="fix-upg"]').getAttribute('aria-pressed')==='true'));
t('the other stays readable and unselected', await p.evaluate(()=>{
  const o=document.querySelector('[data-cpenhpick="fix-enh"]');
  return !o.classList.contains('on') && o.querySelector('.d').textContent.trim().length>0;}));
t('enhancement stored', await p.evaluate(()=>cpChoice.enh)==='fix-upg');
t('star lands on the restricted unit only', await p.evaluate(()=>{
  const stars=[...document.querySelectorAll('#view-cp .unit')].filter(c=>c.querySelector('.unit-hd .star'));
  return stars.length===1 && stars[0].querySelector('h3').textContent.includes('CP Buggy');}));
t('effects change the displayed Sv', await p.evaluate(()=>{
  const c=[...document.querySelectorAll('#view-cp .unit')].find(x=>x.querySelector('h3').textContent.includes('CP Buggy'));
  return [...c.querySelectorAll('.stat')].find(x=>x.querySelector('b').textContent==='SV').querySelector('span').textContent==='3+';}));
t('changed stat is highlighted', await p.evaluate(()=>{
  const c=[...document.querySelectorAll('#view-cp .unit')].find(x=>x.querySelector('h3').textContent.includes('CP Buggy'));
  return c.querySelector('.stat.mod b').textContent==='SV';}));
t('effects add the invulnerable save', await p.evaluate(()=>{
  const c=[...document.querySelectorAll('#view-cp .unit')].find(x=>x.querySelector('h3').textContent.includes('CP Buggy'));
  return c.querySelector('.inv').textContent.includes('4+');}));
t('the underlying datasheet is not mutated', await p.evaluate(()=>DATA.cpUnits['cp-buggy'].stats.sv)==='4+');
t('enhancement badge opens its popup', await p.evaluate(()=>{
  document.querySelector('#view-cp [data-cpenhinfo]').click();
  return document.querySelector('#mBody').textContent.includes('CP BUGGY unit only');}));
await p.click('#mClose');
await p.click('[data-cpenhpick="fix-upg"]'); await p.waitForTimeout(150);
t('tapping the selected card clears it', await p.evaluate(()=>cpChoice.enh)===null);
t('clearing the enhancement restores the datasheet Sv', await p.evaluate(()=>{
  const c=[...document.querySelectorAll('#view-cp .unit')].find(x=>x.querySelector('h3').textContent.includes('CP Buggy'));
  return [...c.querySelectorAll('.stat')].find(x=>x.querySelector('b').textContent==='SV').querySelector('span').textContent==='4+';}));

// leader choice -> merged card, leader removed from its own slot
await p.selectOption('#cpLeadSel','cp-nob'); await p.waitForTimeout(150);
t('single legal target auto-selected', await p.evaluate(()=>cpChoice.target)!==null);
// Picking a leader has to say what the leader actually brings, or the dropdown
// is two names with no way to choose between them.
// Always returns a shape, so a missing block fails the assertions below instead
// of throwing and taking the rest of the suite down with it.
const perk=()=>p.evaluate(()=>{
  const b=document.querySelector('#cpChoice .lperk');
  if(!b) return { missing:true, txt:'', pills:[] };
  return { missing:false, txt:b.innerText, pills:[...b.querySelectorAll('.pill')].map(x=>
    ({txt:x.textContent, ab:x.dataset.ab, grant:x.classList.contains('grant')})) };
});
t('leader summary appears once a leader is chosen', (await perk()).missing===false);
t('summary names the leader\'s own datasheet ability',
  (await perk()).pills.some(x=>x.txt==='Fights First' && x.ab==='fights-first' && !x.grant));
t('summary carries that ability\'s rules text',
  (await perk()).txt.includes('fights in the Fights First step'));
t('summary lists what the leader gives the unit it leads',
  (await perk()).pills.some(x=>x.txt==='Lethal Hits (led)' && x.ab==='lethal-hits' && x.grant));
t('the injected ability is labelled with its weapon scope',
  (await perk()).txt.includes('Gives the unit it leads (melee weapons)'));
t('both kinds of perk are shown, not just one', (await perk()).pills.length===2);
t('every perk pill opens its ability', (await perk()).pills.every(x=>x.ab));
await p.selectOption('#cpLeadSel','cp-buggy'); await p.waitForTimeout(150);
t('a leader with no abilities says so rather than showing an empty box',
  (await perk()).txt.includes('no datasheet ability of its own'));
t('  ...and shows no perk pills', (await perk()).pills.length===0);
await p.selectOption('#cpLeadSel','cp-nob'); await p.waitForTimeout(150);
t('summary follows the dropdown back', (await perk()).pills.length===2);
t('attaching merges the cards', await p.evaluate(()=>document.querySelectorAll('#view-cp .leader-band').length)===2);
t('attached leader loses its own card', await p.evaluate(()=>
  [...document.querySelectorAll('#view-cp .unit-hd h3')].filter(h=>h.firstChild.textContent.includes('CP Nob')).length)===0);
t('one card fewer while attached', await p.evaluate(()=>document.querySelectorAll('#view-cp .unit').length)===3);
t('header says who is leading', await p.evaluate(()=>
  document.querySelector('#view-cp .unit-hd .sub').textContent.includes('led by CP Nob')));
// An Attached unit is one unit on the table, so the unit count drops by one
// while the model count must not move.
t('attaching counts leader+bodyguard as one unit', await p.evaluate(()=>
  document.querySelector('#view-cp .totals').textContent.replace(/\s+/g,' ').includes('4 units')));
t('model total unchanged by attaching', await p.evaluate(()=>
  document.querySelector('#view-cp .totals').textContent.replace(/\s+/g,' ').includes('23 models')));
t('an enhancement on the attached leader stars the merged card', await p.evaluate(()=>{
  cpChoice.enh='fix-enh'; renderCombatPatrol();
  const c=[...document.querySelectorAll('#view-cp .unit')].find(x=>x.querySelector('.leader-band'));
  const ok=!!c.querySelector('.unit-hd .star') && c.textContent.includes('Fix Enh');
  cpChoice.enh=null; renderCombatPatrol(); return ok;}));
// choices survive a reload
await p.reload({waitUntil:'networkidle'}); await p.waitForTimeout(400);
await p.evaluate(()=>setTab('cp')); await p.waitForTimeout(150);
t('leader choice persists across reload', await p.evaluate(()=>cpChoice.leader)==='cp-nob');
t('merged card restored after reload', await p.evaluate(()=>document.querySelectorAll('#view-cp .leader-band').length)===2);
t('a choice the data no longer offers is dropped', await p.evaluate(()=>{
  cpChoice.enh='no-such-enh'; validateCpChoice(); return cpChoice.enh===null;}));
await p.selectOption('#cpLeadSel',''); await p.waitForTimeout(150);
t('detaching restores the leader card', await p.evaluate(()=>document.querySelectorAll('#view-cp .unit').length)===4);
t('  (control: the same keyword DOES grant in matched play)',
  await p.evaluate(()=>document.querySelectorAll('#view-army .pill.grant').length)>0);
// Scoped to unit cards on purpose: the Force Choices panel legitimately shows a
// grant pill for what an attached leader injects, which is not a leak.
t('detachment grants do NOT leak into CP cards',
  await p.evaluate(()=>document.querySelectorAll('#view-cp .unit .pill.grant').length)===0);
t('  ...and the CP unit really does carry the granted keyword',
  await p.evaluate(()=>DATA.cpUnits['cp-boyz'].keywords.includes('MOB')));
// CP panels
await p.click('[data-panel="cpRule"]');
t('faction abilities rendered with their own badge',
  await p.evaluate(()=>document.querySelectorAll('#view-cp .pill.fac').length)===2);
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
t('Combat Patrol has no stratagem panel of its own',
  await p.evaluate(()=>!document.querySelector('#cpStrat')));
t('no stratagem cards anywhere on the Combat Patrol tab',
  await p.evaluate(()=>document.querySelectorAll('#view-cp .strat').length)===0);
t('stratagems live on their own tab',
  await p.evaluate(()=>document.querySelectorAll('#view-strats .scard').length)>0);
t('builder panel state independent of the CP rule panel',
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
t('dock shown on Army too', await p.evaluate(()=>{
  setTab('army'); const r=document.querySelector('#dock').style.display!=='none'; setTab('cp'); return r;}));
t('dock hidden on every other tab', await p.evaluate(()=>{
  const hidden=t=>{setTab(t);return document.querySelector('#dock').style.display==='none';};
  const r=['builder','strats','points'].every(hidden); setTab('cp'); return r;}));
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

// ---- live effects while the call is active
await p.evaluate(()=>{game.waaagh=false;save();setTab('cp');renderAll();
  document.querySelectorAll('#view-cp .unit').forEach(c=>c.classList.remove('collapsed'));});
await p.waitForTimeout(150);
const meleeOf = id => p.evaluate(u=>{
  const c=[...document.querySelectorAll('#view-cp .unit')].find(x=>x.querySelector('h3').textContent.includes(u));
  const row=c.querySelector('.wrow.melee');
  const get=k=>[...row.querySelectorAll('.wst')].find(w=>w.querySelector('b').textContent===k);
  return {s:get('S').querySelector('span').textContent, a:get('A').querySelector('span').textContent,
          sMod:get('S').className, aMod:get('A').className};}, id);
const invOf = id => p.evaluate(u=>{
  const c=[...document.querySelectorAll('#view-cp .unit')].find(x=>x.querySelector('h3').textContent.includes(u));
  const e=c.querySelector('.inv');
  return e ? {text:e.textContent.trim(), cls:e.className} : null;}, id);

const meleeBefore = await meleeOf('CP Boyz');
t('melee S/A unmodified before the call', meleeBefore.s==='5' && meleeBefore.a==='3' && !meleeBefore.sMod.includes('mod-call'));
t('no invuln on the fixture boyz before the call', (await invOf('CP Boyz'))===null);

await p.evaluate(()=>{game.waaagh=true;save();refreshCall();
  document.querySelectorAll('#view-cp .unit').forEach(c=>c.classList.remove('collapsed'));});
await p.waitForTimeout(150);
const meleeAfter = await meleeOf('CP Boyz');
t('call adds +1 to melee Strength', meleeAfter.s==='6');
t('call adds +1 to melee Attacks', meleeAfter.a==='4');
t('changed S is marked as call-driven', meleeAfter.sMod.includes('mod-call'));
t('changed A is marked as call-driven', meleeAfter.aMod.includes('mod-call'));
t('call grants the invulnerable save', (await invOf('CP Boyz')).text.includes('5+'));
t('granted invuln is marked as call-driven', (await invOf('CP Boyz')).cls.includes('mod-call'));
t('call-driven marks pulse (animated), unlike enhancement marks', await p.evaluate(()=>{
  const el=document.querySelector('#view-cp .wst.mod-call');
  return getComputedStyle(el).animationName!=='none';}));
t('ranged weapons are untouched', await p.evaluate(()=>{
  const c=[...document.querySelectorAll('#view-cp .unit')].find(x=>x.querySelector('h3').textContent.includes('CP Boyz'));
  return !c.querySelector('.wrow.ranged .wst.mod-call');}));
t('a unit without the faction ability is untouched', await p.evaluate(()=>{
  const c=[...document.querySelectorAll('#view-cp .unit')].find(x=>x.querySelector('h3').textContent.includes('CP Buggy'));
  return !DATA.cpUnits['cp-buggy'].factionAbilities && !c.querySelector('.mod-call');}));
t('an existing better invuln is not downgraded', await p.evaluate(()=>{
  const u={id:'x',factionAbilities:['waaagh'],invulnerableSave:'4+'};
  return applyCallEffects(u).invulnerableSave==='4+';}));
t('a worse existing invuln is improved', await p.evaluate(()=>{
  const u={id:'x',factionAbilities:['waaagh'],invulnerableSave:'6+'};
  const d=applyCallEffects(u); return d.invulnerableSave==='5+' && d._invulnFromCall===true;}));
t('a non-numeric Attacks value is expressed, not miscalculated', await p.evaluate(()=>{
  const u={id:'x',factionAbilities:['waaagh'],weapons:{melee:[{name:'w',a:'D6+2',s:'4'}]}};
  const d=applyCallEffects(u); return d.weapons.melee[0].a==='D6+2+1' && d.weapons.melee[0].s==='5';}));
t('the underlying datasheet is never mutated', await p.evaluate(()=>
  DATA.cpUnits['cp-boyz'].weapons.melee[0].s==='5' && !DATA.cpUnits['cp-boyz'].invulnerableSave));
await p.evaluate(()=>{game.waaagh=false;save();refreshCall();
  document.querySelectorAll('#view-cp .unit').forEach(c=>c.classList.remove('collapsed'));});
await p.waitForTimeout(150);
t('ending the call restores the printed values', await p.evaluate(()=>{
  const c=[...document.querySelectorAll('#view-cp .unit')].find(x=>x.querySelector('h3').textContent.includes('CP Boyz'));
  return !c.querySelector('.mod-call');}));

// ---- background gif flourish
await p.evaluate(()=>{game.waaagh=false;save();setTab('cp');renderAll();}); await p.waitForTimeout(150);
t('gif is idle before the button is pressed', await p.evaluate(()=>{
  const g=document.querySelector('#dockGif');
  return !g.classList.contains('on') && !g.getAttribute('src');}));
t('gif is preloaded while idle, without touching the on-screen element',
  await p.evaluate(()=>gifWarmed===true && !document.querySelector('#dockGif').getAttribute('src')));
await p.click('#dockBtn');
t('gif starts on the press, alongside the button animation', await p.evaluate(()=>
  document.querySelector('#dockBtn').classList.contains('fire') &&
  document.querySelector('#dockGif').classList.contains('on')));
t('gif has a source immediately, not after a delay',
  await p.evaluate(()=>!!document.querySelector('#dockGif').getAttribute('src')));
await p.waitForTimeout(600);
t('gif actually decoded (not a broken image)', await p.evaluate(()=>{
  const g=document.querySelector('#dockGif');
  return g.complete && g.naturalWidth>0;}));
t('gif sits behind the button and takes no clicks', await p.evaluate(()=>{
  const g=getComputedStyle(document.querySelector('#dockGif'));
  const b=getComputedStyle(document.querySelector('#dockBtn').closest('#dock'));
  return g.pointerEvents==='none' && parseInt(g.zIndex,10) < parseInt(b.zIndex,10);}));
t('gif is faint, not opaque', await p.evaluate(()=>{
  const o=parseFloat(getComputedStyle(document.querySelector('#dockGif')).opacity);
  return o>0 && o<0.5;}));
await p.waitForTimeout(2800);
t('gif stops and releases its source when done', await p.evaluate(()=>{
  const g=document.querySelector('#dockGif');
  return !g.classList.contains('on') && !g.getAttribute('src');}));
t('a missing gif is given up on rather than retried', await p.evaluate(async()=>{
  const a=DATA.abilities.waaagh, keep=a.callGif;
  a.callGif='data/definitely-not-here.gif'; gifBroken=false;
  playCallGif();
  await new Promise(r=>setTimeout(r,1400));
  const flagged=gifBroken===true;
  a.callGif=keep; gifBroken=false;
  return flagged;}));
await p.evaluate(()=>{game.waaagh=false;save();renderDock();});

// ---- the matched-play side of the call: the button on the Army tab, and
//      everything that keys off the call being active
t('a Range in inches is added to, not appended to', await p.evaluate(()=>
  bumpStat('36"',3)==='39"' && bumpStat('4',1)==='5' && bumpStat('D6+2',1)==='D6+2+1'));
t('a detachment can add to the call for the units it names', await p.evaluate(()=>{
  const keep=game.waaagh, keepS=selectedDetachments.slice(), d=DATA.detachments['big-one'];
  if(!selectedDetachments.includes('big-one')) selectedDetachments.push('big-one');
  game.waaagh=true;
  d.whileCalled=[{keyword:'MOB',who:'MOB units',text:'+3" Range',rangedWeapon:{range:3}}];
  const mk=kw=>({id:'x',name:'X',keywords:kw,factionAbilities:['waaagh'],
    weapons:{ranged:[{name:'gun',count:1,range:'18"',a:'2',abilities:[]}],melee:[{name:'fist',count:1,a:'2',s:'4',abilities:[]}]}});
  const hit=applyCallEffects(mk(['MOB'])), miss=applyCallEffects(mk(['VEHICLE'])), cp=applyCallEffects(mk(['MOB']),{noGrants:true});
  delete d.whileCalled; game.waaagh=keep; selectedDetachments=keepS;
  return hit.weapons.ranged[0].range==='21"' && hit.weapons.ranged[0]._mods.range==='mod-call'
      && hit._callNotes.some(n=>n.text==='+3" Range' && n.from==='Big One')
      && hit.weapons.melee[0].a==='3'                                  // the call's own melee bump still lands
      && miss.weapons.ranged[0].range==='18"' && !(miss._callNotes||[]).length
      && cp.weapons.ranged[0].range==='18"' && !(cp._callNotes||[]).length;}));
t('...and only while its detachment is selected', await p.evaluate(()=>{
  const keep=game.waaagh, keepS=selectedDetachments.slice(), d=DATA.detachments['big-one'];
  game.waaagh=true; d.whileCalled=[{keyword:'MOB',text:'x',rangedWeapon:{range:3}}];
  selectedDetachments=selectedDetachments.filter(x=>x!=='big-one');
  const u=applyCallEffects({id:'x',name:'X',keywords:['MOB'],factionAbilities:['waaagh'],weapons:{ranged:[{name:'gun',count:1,range:'18"',abilities:[]}]}});
  delete d.whileCalled; game.waaagh=keep; selectedDetachments=keepS;
  return u.weapons.ranged[0].range==='18"';}));
t('the card lists what the call does beyond the numbers, and where each line comes from', await p.evaluate(()=>{
  const keep=game.waaagh, a=DATA.abilities.waaagh; game.waaagh=true;
  a.callState='Riled up'; a.callNotes=['Can charge after Advancing'];
  DATA.enhancements['shiny-bit'].whileCalled='Re-roll the dice';
  const u={id:'x',name:'X',keywords:[],factionAbilities:['waaagh'],stats:{}};
  const on=document.createElement('div'); on.innerHTML=unitBody(u,{enhancementId:'shiny-bit'},{noGrants:true});
  const plain=document.createElement('div'); plain.innerHTML=unitBody(u,null,{noGrants:true});
  game.waaagh=false;
  const off=document.createElement('div'); off.innerHTML=unitBody(u,{enhancementId:'shiny-bit'},{noGrants:true});
  delete a.callState; delete a.callNotes; delete DATA.enhancements['shiny-bit'].whileCalled; game.waaagh=keep;
  const txt=on.querySelector('.callnote')?.textContent||'', txt2=plain.querySelector('.callnote')?.textContent||'';
  return txt.includes('RILED UP') && txt.includes('Can charge after Advancing')
      && txt.includes('Re-roll the dice') && txt.includes('(Shiny Bit)')
      && txt2.includes('Can charge after Advancing') && !txt2.includes('Re-roll')    // no enhancement, no enhancement line
      && !off.querySelector('.callnote');}));
t('a call with nothing beyond its numbers adds no note row', await p.evaluate(()=>{
  const keep=game.waaagh; game.waaagh=true;
  const el=document.createElement('div');
  el.innerHTML=unitBody({id:'x',name:'X',keywords:[],factionAbilities:['waaagh'],stats:{}},null,{noGrants:true});
  game.waaagh=keep; return !el.querySelector('.callnote');}));
t('a stratagem with a stronger mode is marked only while the call is active', await p.evaluate(()=>{
  const keep=game.waaagh, a=DATA.abilities.waaagh; a.callState='Riled up';
  DATA.stratagems['core-a'].whileCalled='+1 to the roll'; ui.stratPhase='all';
  game.waaagh=false; renderStrats(); const off=document.querySelectorAll('#view-strats .sb.call').length;
  game.waaagh=true;  renderStrats();
  const on=[...document.querySelectorAll('#view-strats .scard.called')].map(c=>c.querySelector('.sb.call').textContent).join();
  showStratagem('core-a'); const pop=document.querySelector('#mBody .scall')?.textContent||''; document.querySelector('#mClose').click();
  game.waaagh=false; showStratagem('core-a'); const popOff=!!document.querySelector('#mBody .scall'); document.querySelector('#mClose').click();
  delete DATA.stratagems['core-a'].whileCalled; delete a.callState; game.waaagh=keep; renderStrats();
  return off===0 && on==='Riled up' && pop.includes('RILED UP NOW') && pop.includes('+1 to the roll') && !popOff;}));
t('toggling the call refreshes the Stratagems tab', await p.evaluate(()=>{
  DATA.stratagems['core-a'].whileCalled='x'; ui.stratPhase='all'; game.waaagh=false; refreshCall();
  const before=document.querySelectorAll('#view-strats .sb.call').length;
  game.waaagh=true; refreshCall(); const after=document.querySelectorAll('#view-strats .sb.call').length;
  game.waaagh=false; delete DATA.stratagems['core-a'].whileCalled; refreshCall();
  return before===0 && after===1;}));
t('the Army banner adds what detachments and stratagems contribute; Combat Patrol does not', await p.evaluate(()=>{
  const keepS=selectedDetachments.slice(); if(!selectedDetachments.includes('big-one')) selectedDetachments.push('big-one');
  DATA.detachments['big-one'].whileCalled=[{keyword:'MOB',who:'MOB units',text:'+3" Range'}];
  DATA.stratagems['core-a'].whileCalled='x';
  game.waaagh=true; setTab('army');
  const army=document.querySelector('#dockBanner .more')?.textContent||'';
  setTab('cp'); const cp=!!document.querySelector('#dockBanner .more');
  delete DATA.detachments['big-one'].whileCalled; setTab('army'); const one=document.querySelector('#dockBanner .more')?.textContent||'';
  delete DATA.stratagems['core-a'].whileCalled; setTab('army'); const none=!!document.querySelector('#dockBanner .more');
  game.waaagh=false; selectedDetachments=keepS; save(); setTab('cp'); renderAll();
  return army.includes('Big One:') && army.includes('MOB units') && army.includes('+3" Range') && army.includes('1 stratagem is stronger')
      && !cp && one.includes('1 stratagem is stronger') && !one.includes('Big One') && !none;}));
t('pressing the button on the Army tab changes matched-play cards, End restores them', await p.evaluate(async()=>{
  DATA.units['demo-boyz'].factionAbilities=['waaagh']; game.waaagh=false; save(); setTab('army'); renderAll();
  const before=document.querySelectorAll('#view-army .mod-call').length;
  document.querySelector('#dockBtn').click(); await new Promise(r=>setTimeout(r,450));
  const after=document.querySelectorAll('#view-army .mod-call').length, on=game.waaagh;
  document.querySelector('#dockEnd').click(); await new Promise(r=>setTimeout(r,120));
  const ended=document.querySelectorAll('#view-army .mod-call').length;
  delete DATA.units['demo-boyz'].factionAbilities; setTab('cp'); renderAll();
  return before===0 && on===true && after>0 && ended===0 && game.waaagh===false;}));
await p.waitForTimeout(900);   // let the press animation finish before the next dock tests

// data-driven: no call* keys => no dock at all
t('adding a tab to FACTION_CALL_TABS is all it takes', await p.evaluate(()=>{
  FACTION_CALL_TABS.push('strats'); setTab('strats');
  const shown=document.querySelector('#dock').style.display!=='none';
  FACTION_CALL_TABS.pop(); setTab('strats');
  const gone=document.querySelector('#dock').style.display==='none';
  setTab('cp'); return shown && gone;}));
t('Combat Patrol can name its own wording of the call; other tabs keep the default', await p.evaluate(()=>{
  DATA.abilities['cp-call']={...DATA.abilities.waaagh,name:'CP Call'};
  DATA.combatPatrol.factionCall='cp-call'; setTab('cp');
  const onCp=factionCall().name, label=document.querySelector('#dockBtn').textContent;
  setTab('army'); const onArmy=factionCall().name;
  delete DATA.combatPatrol.factionCall; delete DATA.abilities['cp-call']; setTab('cp');
  return onCp==='CP Call' && label==='CP CALL' && onArmy==='Waaagh!' && factionCall().name==='Waaagh!';}));
t('dock hides when the ability has no call data', await p.evaluate(()=>{
  const keep=DATA.abilities.waaagh; delete DATA.abilities.waaagh; renderDock();
  const hidden=document.querySelector('#dock').style.display==='none';
  DATA.abilities.waaagh=keep; renderDock(); return hidden;}));
await p.waitForTimeout(120);

// the optional extra cost must be visible, not rounded away
t('cpCostNote renders as its own badge', await p.evaluate(()=>{
  DATA.stratagems['core-a'].cpCostNote='+1 CP for X'; ui.stratPhase='all'; renderStrats();
  const n=document.querySelector('#view-strats .sb.alt');
  // card shows the short form, full note kept in the tooltip and the popup
  const ok=!!n && n.textContent==='+1 CP' && n.title==='+1 CP for X';
  delete DATA.stratagems['core-a'].cpCostNote; renderStrats(); return ok;}));

// --------------------------- WEAPON ROWS -----------------------------
await p.evaluate(()=>{ setTab('cp'); renderAll();
  // cards are collapsed by default; expand them all so their contents can be inspected
  document.querySelectorAll('#view-cp .unit').forEach(c=>c.classList.remove('collapsed')); });
await p.waitForTimeout(150);
t('every weapon carries its own stat labels', await p.evaluate(()=>{
  const r=document.querySelector('#view-cp .wrow.ranged');
  return [...r.querySelectorAll('.wst b')].map(x=>x.textContent).join()==='Range,A,BS,S,AP,D';}));
t('melee drops the Range column instead of leaving it blank', await p.evaluate(()=>{
  const m=document.querySelector('#view-cp .wrow.melee');
  return [...m.querySelectorAll('.wst b')].map(x=>x.textContent).join()==='A,WS,S,AP,D';}));
t('abilities sit below the stats, not beside them', await p.evaluate(()=>{
  const row=[...document.querySelectorAll('#view-cp .wrow')].find(r=>r.querySelector('.wab'));
  return row.querySelector('.wab').getBoundingClientRect().top
       >= row.querySelector('.wstats').getBoundingClientRect().bottom - 1;}));
t('stat values no longer crowd the right edge', await p.evaluate(()=>{
  const row=[...document.querySelectorAll('#view-cp .wrow')].find(r=>r.querySelector('.wab'));
  const rowBox=row.getBoundingClientRect(), stats=row.querySelector('.wstats').getBoundingClientRect();
  return stats.width > rowBox.width*0.9;}));
t('no ability pill overlaps a stat cell', await p.evaluate(()=>
  [...document.querySelectorAll('#view-cp .wrow')].every(r=>{
    const w=r.querySelector('.wstats'), a=r.querySelector('.wab');
    if(!a) return true;
    const wb=w.getBoundingClientRect(), ab=a.getBoundingClientRect();
    return ab.top >= wb.bottom - 1;})));
t('stat labels take the section colour', await p.evaluate(()=>
  getComputedStyle(document.querySelector('#view-cp .wrow.ranged .wst b')).color
  !== getComputedStyle(document.querySelector('#view-cp .wrow.melee .wst b')).color));
t('the old shared header row is gone',
  await p.evaluate(()=>document.querySelectorAll('#view-cp .wtbl').length)===0);

// ---------------------- WEAPON SECTION BANDING -----------------------
await p.evaluate(()=>{ setTab('cp'); renderAll();
  // cards are collapsed by default; expand them all so their contents can be inspected
  document.querySelectorAll('#view-cp .unit').forEach(c=>c.classList.remove('collapsed')); });
await p.waitForTimeout(150);
t('ranged and melee headers are distinguishable', await p.evaluate(()=>{
  const r=document.querySelector('#view-cp .wsec-t.ranged'), m=document.querySelector('#view-cp .wsec-t.melee');
  if(!r||!m) return false;
  const cr=getComputedStyle(r), cm=getComputedStyle(m);
  return cr.color!==cm.color && cr.backgroundColor!==cm.backgroundColor
      && cr.borderLeftColor!==cm.borderLeftColor;}));
t('both bands are actually painted, not transparent', await p.evaluate(()=>{
  const bg=el=>getComputedStyle(el).backgroundColor;
  const t=v=>v==='transparent'||v==='rgba(0, 0, 0, 0)';
  return !t(bg(document.querySelector('#view-cp .wsec-t.ranged')))
      && !t(bg(document.querySelector('#view-cp .wsec-t.melee')));}));
t('non-weapon sections keep the plain header', await p.evaluate(()=>
  [...document.querySelectorAll('#view-cp .sec-t')].some(x=>x.textContent==='Abilities')));
t('banding survives the light theme', await p.evaluate(()=>{
  document.documentElement.setAttribute('data-theme','light');
  const r=getComputedStyle(document.querySelector('#view-cp .wsec-t.ranged')).color;
  const m=getComputedStyle(document.querySelector('#view-cp .wsec-t.melee')).color;
  document.documentElement.removeAttribute('data-theme');
  return r!==m;}));

// --------------------------- LEADER BLOCK ----------------------------
await p.evaluate(()=>{ setTab('cp'); renderAll();
  // cards are collapsed by default; expand them all so their contents can be inspected
  document.querySelectorAll('#view-cp .unit').forEach(c=>c.classList.remove('collapsed')); });
await p.waitForTimeout(150);
const leadSec = () => p.evaluate(()=>{
  const s=[...document.querySelectorAll('#view-cp .sec')].find(x=>x.querySelector('.sec-t')?.textContent==='Leader');
  return s ? [...s.querySelectorAll('.pill')].map(x=>x.textContent) : null;});
t('Leader block lists what the model can attach to',
  JSON.stringify(await leadSec())==='["CP Boyz","CP Nob"]');
t('same-named lead targets are listed once', await p.evaluate(()=>{
  const keep=DATA.cpUnits['cp-nob'].name;
  DATA.cpUnits['cp-nob'].name=DATA.cpUnits['cp-boyz'].name;     // the real 'Ardmob Boyz case
  renderCombatPatrol();
  const s=[...document.querySelectorAll('#view-cp .sec')].find(x=>x.querySelector('.sec-t')?.textContent==='Leader');
  const n=s.querySelectorAll('.pill').length;
  DATA.cpUnits['cp-nob'].name=keep; renderCombatPatrol(); return n===1;}));
t('already-attached leader does not repeat its Leader block', await p.evaluate(()=>{
  cpChoice.leader='cp-nob'; cpChoice.target=cpLeaderTargets('cp-nob')[0].idx; renderCombatPatrol();
  const card=[...document.querySelectorAll('#view-cp .unit')].find(x=>x.querySelector('.leader-band'));
  const secs=[...card.querySelectorAll('.unit-bd')][0].querySelectorAll('.sec-t');
  const ok=![...secs].map(x=>x.textContent).includes('Leader');
  cpChoice.leader=null; cpChoice.target=null; renderCombatPatrol(); return ok;}));
t('multi-profile weapon shows one group header on a CP card',
  await p.evaluate(()=>document.querySelectorAll('#view-cp .wgrp').length)===1);
t('both profiles still listed under it',
  await p.evaluate(()=>[...document.querySelectorAll('#view-cp .wn')]
    .filter(x=>x.textContent.includes('Big Shoota')).length)===2);
t('CP summary merges the profiles into one weapon',
  await p.evaluate(()=>weaponSummaryText(DATA.cpUnits['cp-buggy'],null))==='2× Big Shoota');

// -------------------- COLLAPSING (accordion) -------------------------
await p.evaluate(()=>{openCard={};setTab('cp');renderAll();}); await p.waitForTimeout(150);
// Scope to real cards: the missing-datasheet placeholder has no collapsible
// body and no header hit target, so it is not part of the accordion.
const cpCards = () => p.evaluate(()=>[...document.querySelectorAll('#view-cp [data-ucol]')]
  .map(h=>h.closest('.unit').classList.contains('collapsed')));
const cpHd = i => p.locator('#view-cp .unit-hd[data-ucol]').nth(i).click();

t('every unit card has a chevron',
  await p.evaluate(()=>document.querySelectorAll('#view-cp .unit-hd .ucv').length)>0);
t('all cards start collapsed', (await cpCards()).every(Boolean));

// open the first
await cpHd(0);
t('tapping a header opens that card', (await cpCards())[0]===false);
t('all others stay collapsed', (await cpCards()).slice(1).every(Boolean));
t('opened body is visible', await p.evaluate(()=>{
  const c=document.querySelector('#view-cp [data-ucol]').closest('.unit');
  return getComputedStyle(c.querySelector('.unit-bd')).display;})!=='none');
t('the placeholder card is not part of the accordion', await p.evaluate(()=>
  [...document.querySelectorAll('#view-cp .unit')].some(c=>!c.querySelector('[data-ucol]'))));

// open a second — the first must close
await cpHd(1);
t('opening another closes the first', (await cpCards())[0]===true);
t('only one card open at a time', (await cpCards()).filter(x=>!x).length===1);
t('the newly tapped one is the open one', (await cpCards())[1]===false);

// tapping the open one closes it, leaving none open
await cpHd(1);
t('tapping the open card closes it', (await cpCards()).every(Boolean));

// per view, not global
await p.evaluate(()=>{setTab('cp');}); await cpHd(2);
await p.evaluate(()=>setTab('builder')); await p.waitForTimeout(120);
t('a Combat Patrol card open does not open a Builder card', await p.evaluate(()=>
  [...document.querySelectorAll('#view-builder .unit')].every(c=>c.classList.contains('collapsed'))));
await p.locator('#view-builder .unit').nth(0).locator('.unit-hd').click();
t('builder accordion is independent', await p.evaluate(()=>
  openCard.b!=null && openCard.c!=null && openCard.b!==openCard.c));
t('builder also allows only one open', await p.evaluate(()=>
  [...document.querySelectorAll('#view-builder .unit')].filter(c=>!c.classList.contains('collapsed')).length)===1);

// survives a re-render and a reload
t('state survives a full re-render', await p.evaluate(()=>{
  const k=openCard.b; renderAll();
  const open=[...document.querySelectorAll('#view-builder [data-ucol]')].find(h=>!h.closest('.unit').classList.contains('collapsed'));
  return !!open && open.dataset.ucol===k;}));
await p.reload({waitUntil:'networkidle'}); await p.waitForTimeout(400);
await p.evaluate(()=>setTab('cp')); await p.waitForTimeout(150);
t('open card survives a reload', (await cpCards()).filter(x=>!x).length===1);
t('legacy collapsed key is discarded, not misread as open cards',
  await p.evaluate(()=>localStorage.getItem('orks.collapsed'))===null);

// merged leader cards still collapse whole
await p.evaluate(()=>{
  addUnit('demo-warboss');
  armyList[0].leaderId = armyList[armyList.length-1].uid;
  setTab('army'); renderAll();
}); await p.waitForTimeout(150);
t('merged card present for the collapse check',
  await p.evaluate(()=>document.querySelectorAll('#view-army .leader-band').length)===2);
t('merged card hides leader AND unit sections', await p.evaluate(()=>{
  const c=[...document.querySelectorAll('#view-army .unit')].find(x=>x.querySelector('.leader-band'));
  return [...c.querySelectorAll('.leader-band,.unit-bd')].every(e=>getComputedStyle(e).display==='none');}));
await p.evaluate(()=>{openCard={};localStorage.removeItem('orks.openCard');renderAll();});

t('no console/page errors: '+errs.join(' | '), errs.length===0);
await b.close();
server.close();
console.log(ok.map(x=>'  ok  '+x).join('\n'));
if(bad.length){console.log('\n'+bad.map(x=>'  XX  '+x).join('\n'));}
console.log(`\n${ok.length} passed, ${bad.length} failed`);
process.exit(bad.length?1:0);
