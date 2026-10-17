// Factuur: eigen nummerreeks, kopie van de offerte, pdf, betaald-knop en de vakken in het klantvenster.
const fs=require('fs'),path=require('path');
const {JSDOM,VirtualConsole}=require('jsdom');
const T=__dirname+'/';
const FIXTURE=require(T+'fixture.js'),fakeApi=require(T+'fake-api.js');
const L=require(T+'_offerte-lib.js');
let fail=0,pass=0;const ok=(n,c,x)=>{if(c)pass++;else{fail++;console.log('FAIL',n,x!==undefined?'→ '+x:'')}};
// pure
L.state.leads=[{id:'a',offerte:{nummer:'2026-003'},factuur:{nummer:'F2026-002'}}];
ok('factuurnummer eigen reeks',L.volgendNummer('2026-10-17','x','factuur')==='F2026-003',L.volgendNummer('2026-10-17','x','factuur'));
ok('offertenummer ongewijzigd',L.volgendNummer('2026-10-17','x')==='2026-004');
const klant={id:'k',name:'Eva',offerte:{nummer:'2026-003',aan:'Eva\ne@x.nl',betreft:'Bruiloftsfilm',details:'',regels:[{oms:'Goud',aantal:1,prijs:899}],btw:'incl',tarief:21,tekst:'akkoord?'}};
L.state.leads=[];
const f=L.nieuweFactuur(klant);
ok('factuur kopieert regels',f.regels.length===1&&f.regels[0].prijs===899&&f.regels!==klant.offerte.regels);
ok('factuur: nummer, offerteNummer, 14 dagen',f.nummer==='F'+f.datum.slice(0,4)+'-001'&&f.offerteNummer==='2026-003'&&Date.parse(f.geldig)-Date.parse(f.datum)===14*86400000,JSON.stringify(f));
ok('factuur: betaaltekst',/factuurnummer F\d{4}-001/.test(f.tekst)&&/14 dagen/.test(f.tekst),f.tekst);
const pdf=L.offertePdf(f,L.bedrijf(),null,'factuur');
ok('pdf factuur: titel',pdf.indexOf('(Factuur) Tj')>0&&pdf.indexOf('(Geldig tot)')<0);
ok('pdf factuur: kopvelden',pdf.indexOf('(Factuurnummer)')>0&&pdf.indexOf('(Vervaldatum)')>0&&pdf.indexOf('(2026-003)')>0);
ok('pdf factuur: te betalen',pdf.indexOf('(Te betalen voor ')>0);
ok('pdf factuur betaald',L.offertePdf(Object.assign({},f,{betaald:'2026-10-20T10:00:00Z'}),L.bedrijf(),null,'factuur').indexOf('(Betaald op 20 oktober 2026)')>0);
// app
const FIXED=Date.UTC(2026,8,1,10);
const doc=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
const errors=[],downloads=[];
const dom=new JSDOM(doc,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://example.test/',beforeParse(win){
  const RD=win.Date;win.Date=class extends RD{constructor(...a){a.length?super(...a):super(FIXED)}static now(){return FIXED}};
  win.fetch=fakeApi();
  win.localStorage.setItem('weekzicht.v1',JSON.stringify({events:[],tasks:[],leads:FIXTURE,settings:{weekend:true,dayStart:7,dayEnd:21}}));
  win.localStorage.setItem('weekzicht.v1.leads-seeded','1');
  let last=null;win.URL.createObjectURL=b=>{last=b;return 'blob:x'};win.URL.revokeObjectURL=()=>{};
  win.HTMLAnchorElement.prototype.click=function(){downloads.push({name:this.download,blob:last})};
},virtualConsole:new VirtualConsole().on('jsdomError',e=>errors.push(e.message))});
const w=dom.window,d=w.document,$=id=>d.getElementById(id),q=s=>d.querySelector(s);
const click=el=>el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
const typ=(el,v)=>{el.value=v;el.dispatchEvent(new w.Event('input',{bubbles:true}))};
const stored=id=>JSON.parse(w.localStorage.getItem('weekzicht.v1')).leads.find(l=>l.id===id);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
setTimeout(async()=>{try{
  ok('geen scriptfouten',errors.length===0,errors.join('|'));
  click(q('.viewswitch [data-view="klanten"]'));
  click(q('#canvas .k-main[data-lead="t-cas"]'));
  ok('factuurvak zichtbaar',!!$('lMakeFactuur')&&/Maak eerst een offerte/.test($('lFactuurBox').textContent));
  click($('lMakeOfferte'));
  typ(q('#oRegels .of-oms'),'Trouwfilm');typ(q('#oRegels .of-prijs input'),'1250');
  ok('knop Maak factuur in offertevenster',!$('oFactuur').hidden&&$('oAkkoordBox').hidden===false);
  click($('oFactuur'));
  ok('venster wisselt naar factuur',/^Factuur · /.test($('ofTitle').textContent)&&$('oNummerLabel').textContent==='Factuurnummer'&&$('oAkkoordBox').hidden&&!$('oBetaald').hidden);
  ok('factuurnummer en vervaldatum',$('oNummer').value==='F2026-001'&&$('oGeldig').value==='2026-09-15',[$('oNummer').value,$('oGeldig').value].join());
  let s=stored('t-cas');
  ok('offerte én factuur bewaard',s.offerte&&s.offerte.nummer==='2026-001'&&s.factuur&&s.factuur.nummer==='F2026-001'&&s.factuur.regels[0].prijs===1250&&s.factuur.offerteNummer==='2026-001',JSON.stringify(s.factuur));
  click($('oPdf'));await wait(30);
  ok('factuur-pdf',downloads.length===1&&downloads[0].name==='Factuur F2026-001 Cas en Dina.pdf',JSON.stringify(downloads.map(x=>x.name)));
  click($('oBetaald'));
  ok('betaald gezet',stored('t-cas').factuur.betaald&&$('oBetaald').textContent==='Toch niet betaald');
  click($('oClose'));
  ok('vakken in klantvenster',/F2026-001/.test($('lFactuurBox').textContent)&&/Betaald op/.test($('lFactuurBox').textContent)&&!$('lFactureerOfferte'));
  click($('lBetaaldFactuur'));
  ok('weer open',!stored('t-cas').factuur.betaald&&/Vervalt/.test($('lFactuurBox').textContent));
  // offerte bewerken mag factuur niet raken
  click($('lEditOfferte'));
  ok('terug naar offerte-modus',/^Offerte · /.test($('ofTitle').textContent)&&$('oNummer').value==='2026-001'&&$('oFactuur').textContent==='Naar factuur');
  typ(q('#oRegels .of-prijs input'),'1300');click($('oClose'));
  s=stored('t-cas');ok('factuur onveranderd na offertewijziging',s.offerte.regels[0].prijs===1300&&s.factuur.regels[0].prijs===1250);
  click($('lSave'));
  ok('kaartje noemt factuur',/factuur € 1\.250,00 · open/.test(q('#canvas').textContent),q('#canvas').textContent.match(/factuur[^a-z]{0,25}\w*/));
  // tweede klant: losse factuur, volgnummer
  click(q('#canvas .k-main[data-lead="t-eva"]'));click($('lMakeFactuur'));
  ok('losse factuur, volgend nummer',$('oNummer').value==='F2026-002'&&stored('t-eva').factuur);
  click($('oDelete'));click($('oDelete'));
  ok('factuur verwijderd, offerte-vak intact',!stored('t-eva').factuur&&!!$('lMakeFactuur'));
  ok('geen scriptfouten na alles',errors.length===0,errors.join('|'));
}catch(e){fail++;console.log('FAIL',e.stack)}console.log(pass+' geslaagd, '+fail+' gefaald');process.exit(fail?1:0)},400);
