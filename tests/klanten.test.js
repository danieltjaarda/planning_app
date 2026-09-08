const L = require('./_lead-lib.js');
const FIXTURE = require('./fixture.js');
let fail = 0, pass = 0;
function eq(n, g, w) {
  const a = JSON.stringify(g), b = JSON.stringify(w);
  if (a === b) pass++; else { fail++; console.log('FAIL', n, '\n  got ', a, '\n  want', b); }
}
function load() { L.state.leads = FIXTURE.map(o => Object.assign({}, o)); }

load();
eq('aantal klanten', L.state.leads.length, 5);

// sortering op datum, onbekend achteraan
eq('volgorde', L.sortLeads(L.state.leads).map(l => (l.date || 'onbekend') + ' ' + L.leadName(l)),
  ['2026-05-29 Cas en Dina',
   '2026-10-03 Bram Jansen',
   '2026-10-05 Eva Bakker',
   '2026-10-30 Anna de Vries',
   'onbekend +31 6 00000003']);

// naam valt terug op het nummer
eq('naamloos -> nummer', L.leadName({ name: '', phone: '+31 6 00000003' }), '+31 6 00000003');
eq('lege lead', L.leadName({}), 'Naamloos');

eq('tellingen', L.statusCounts(), { wacht: 2, gepland: 1, gebeld: 1, akkoord: 1, af: 0 });

// belafspraak -> tijdblok van 30 minuten
eq('belblok eindtijd', L.leadCallEnd({ callTime: '18:15' }), '18:45');
eq('belblok over middernacht', L.leadCallEnd({ callTime: '23:50' }), '23:59');

// klusdatum verschijnt als hele-dag item, met statuskleur en -icoon
const okt5 = L.dayItems('2026-10-05');
eq('klusdag item', okt5.map(i => `${i.kind}/${i.sub}/${i.title}/${i.allDay}`), ['lead/klus/Eva Bakker/true']);
eq('klusdag kleur = status', L.itemColor(okt5[0]), 'var(--st-akkoord)');
eq('klusdag attribuut', L.itemAttr(okt5[0]), 'data-lead="t-eva"');
eq('klusdag icoon in titel', L.itemTitleHtml(okt5[0]).includes('<svg'), true);

eq('belafspraak met tijd', L.dayItems('2026-09-02').map(i => `${i.title} ${i.start}-${i.end} allDay=${i.allDay}`),
  ['Bellen · +31 6 00000003 18:15-18:45 allDay=false']);
eq('belafspraak zonder tijd', L.dayItems('2026-09-04').map(i => `${i.title} allDay=${i.allDay}`),
  ['Bellen · Eva Bakker allDay=true']);

// afspraken en klanten door elkaar, op tijd gesorteerd
L.state.events = [
  { id: 'e1', title: 'Overleg',  date: '2026-09-02', start: '09:00', end: '10:00', allDay: false, cat: 'afspraak', loc: '' },
  { id: 'e2', title: 'Deadline', date: '2026-09-02', start: '00:00', end: '23:59', allDay: true,  cat: 'focus',    loc: '' }
];
eq('gemengde dag', L.dayItems('2026-09-02').map(i => i.title), ['Deadline', 'Overleg', 'Bellen · +31 6 00000003']);
eq('afspraak zonder icoon', L.itemTitleHtml(L.dayItems('2026-09-02')[1]), 'Overleg');
eq('afspraak kleur = categorie', L.itemColor(L.dayItems('2026-09-02')[1]), 'var(--cat-afspraak)');

// statusfilter werkt door in de agenda
L.state.stHidden = { akkoord: true };
eq('gefilterd: klusdag weg', L.dayItems('2026-10-05').length, 0);
eq('gefilterd: belafspraak weg', L.dayItems('2026-09-04').length, 0);
eq('gefilterd: afspraken blijven', L.dayItems('2026-09-02').map(i => i.title),
  ['Deadline', 'Overleg', 'Bellen · +31 6 00000003']);
L.state.stHidden = {};

// het Gebeld-vinkje verzet de status
eq('gebeld?', ['wacht', 'gepland', 'gebeld', 'akkoord', 'af'].map(L.isCalled), [false, false, true, true, true]);

load(); L.CAPTURED.length = 0;
L.toggleCalled('t-anna');                      // wacht, geen belafspraak
eq('aanvinken -> gebeld', L.CAPTURED[0].status, 'gebeld');
eq('aanvinken noteert datum', /^\d{4}-\d{2}-\d{2}$/.test(L.CAPTURED[0].calledAt), true);

load(); L.CAPTURED.length = 0;
L.toggleCalled('t-cas');                       // gebeld, geen belafspraak
eq('uitvinken zonder belafspraak -> wacht', L.CAPTURED[0].status, 'wacht');
eq('uitvinken wist de datum', L.CAPTURED[0].calledAt, null);

load(); L.CAPTURED.length = 0;
L.toggleCalled('t-eva');                       // akkoord, mét belafspraak
eq('uitvinken met belafspraak -> gepland', L.CAPTURED[0].status, 'gepland');
eq('waarschuwing bij akkoord terugdraaien', /Akkoord/.test(L.LAST_TOAST), true);

// escaping
eq('escaping in titel', L.itemTitleHtml({ kind: 'event', title: '<img src=x>' }), '&lt;img src=x&gt;');

// elke status heeft een icoon
eq('iconen aanwezig', L.STATUSES.every(s => L.icon(s.icon, 12).includes('<path')), true);
eq('statuskleuren', L.STATUSES.map(s => L.stVar(s.id)),
  ['var(--st-wacht)', 'var(--st-gepland)', 'var(--st-gebeld)', 'var(--st-akkoord)', 'var(--st-af)']);

// begin- en eindtijd van de klus
load();
eq('zonder tijden: hele dag', L.leadTimes(L.state.leads[0]), null);
L.state.leads[1].start = '11:00'; L.state.leads[1].end = '20:00';           // Bram, 3 okt
eq('met tijden', L.leadTimes(L.state.leads[1]), { start: '11:00', end: '20:00', label: '11:00–20:00', late: false });
eq('klus op tijd in de agenda', L.dayItems('2026-10-03').map(i => `${i.title} ${i.start}-${i.end} allDay=${i.allDay}`),
  ['Bram Jansen 11:00-20:00 allDay=false']);
L.state.leads[1].end = '01:00';
eq('eind na middernacht loopt tot 23:59', L.leadTimes(L.state.leads[1]), { start: '11:00', end: '23:59', label: '11:00–01:00', late: true });
L.state.leads[1].end = null;
eq('alleen begintijd telt niet', L.leadTimes(L.state.leads[1]), null);
eq('dan weer hele dag', L.dayItems('2026-10-03')[0].allDay, true);

console.log('\n' + pass + ' geslaagd, ' + fail + ' gefaald');
process.exit(fail ? 1 : 0);
