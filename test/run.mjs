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
t('detachment grants do NOT leak into CP cards',
  await p.evaluate(()=>document.querySelectorAll('#view-cp .pill.grant').length)===0);
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
