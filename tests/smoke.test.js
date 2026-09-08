const fs = require('fs');
const { JSDOM } = require('jsdom');

const path = require('path');
const FIXTURE = require('./fixture.js');
const fakeApi = require('./fake-api.js');
const fetchMock = fakeApi();
// De klok staat stil op dinsdag 1 september 2026, 12:00 Nederlandse tijd:
// zo hangt de test niet af van de echte datum.
const FIXED = Date.UTC(2026, 8, 1, 10, 0, 0);
function freezeClock(win) {
  const RealDate = win.Date;
  win.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(FIXED); }
    static now() { return FIXED; }
  };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
// De gebouwde pagina testen, niet de bron: zo dekt de test ook build.mjs.
const doc = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const errors = [];
const dom = new JSDOM(doc, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://example.test/',
  // De app kent geen startgegevens meer; zet ze klaar zoals een browser dat zou hebben.
  beforeParse(win) {
    freezeClock(win);
    win.fetch = fetchMock;
    win.localStorage.setItem('weekzicht.v1', JSON.stringify({
      events: [], tasks: [], leads: FIXTURE,
      settings: { weekend: true, dayStart: 7, dayEnd: 21 }
    }));
    win.localStorage.setItem('weekzicht.v1.leads-seeded', '1');
  },
  virtualConsole: new (require('jsdom').VirtualConsole)().on('jsdomError', e => errors.push('jsdomError: ' + e.message))
});
const w = dom.window, d = w.document;
w.addEventListener('error', e => errors.push('window error: ' + e.message));

let fail = 0, pass = 0;
function ok(name, cond, extra) {
  if (cond) pass++; else { fail++; console.log('FAIL', name, extra !== undefined ? '→ ' + extra : ''); }
}
const $ = id => d.getElementById(id);
const q = sel => d.querySelector(sel);
const qa = sel => Array.from(d.querySelectorAll(sel));
function click(el) { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); }

setTimeout(async () => {
  try {
    // ---- opstart ----
    ok('geen scriptfouten', errors.length === 0, errors.join(' | '));
    ok('klok loopt', /^\d{2}:\d{2}:\d{2}$/.test($('clockTime').textContent), $('clockTime').textContent);
    ok('datum in het Nederlands', /\b(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)\b/.test($('clockDate').textContent), $('clockDate').textContent);

    // ---- de ingelezen klanten ----
    const rail = $('klantCard').textContent;
    ok('zijkolom toont klanten', /Klanten/.test(rail) && /5 totaal/.test(rail), rail.slice(0, 90));
    ok('eerstvolgende call genoemd', /Eerstvolgende call/.test(rail), rail.slice(-90));

    // ---- weekweergave toont de klantitems ----
    ok('weekweergave heeft raster', !!$('gridScroll'));
    const leadChips = qa('#canvas [data-lead]');
    ok('klantitems in de agenda', leadChips.length > 0, leadChips.length);
    ok('klantitem heeft statusicoon', qa('#canvas [data-lead] svg').length > 0);

    // ---- klantenweergave ----
    click(q('.viewswitch [data-view="klanten"]'));
    ok('klantenweergave actief', q('.viewswitch [data-view="klanten"]').getAttribute('aria-pressed') === 'true');
    const rows = qa('#canvas .klant');
    ok('vijf klanten in de lijst', rows.length === 5, rows.length);

    const namen = qa('#canvas .k-name').map(e => e.textContent.trim());
    ok('gesorteerd op datum', JSON.stringify(namen) === JSON.stringify(
      ['Cas en Dina', 'Bram Jansen', 'Eva Bakker', 'Anna de Vries', '+31 6 00000003']), JSON.stringify(namen));

    const datums = qa('#canvas .k-date').map(e => e.textContent.trim());
    ok('datums getoond', datums[0].startsWith('29 mei') && datums[4].indexOf('onbekend') >= 0, JSON.stringify(datums));
    ok('verleden datum gemarkeerd', qa('#canvas .klant.gone').length === 1, qa('#canvas .klant.gone').length);

    const pills = qa('#canvas .stat-pill').map(e => e.textContent.trim());
    ok('statuslabels aanwezig', JSON.stringify(pills) === JSON.stringify(
      ['Gebeld', 'Nog bellen', 'Akkoord', 'Nog bellen', 'Call gepland']), JSON.stringify(pills));
    ok('elk statuslabel heeft een icoon', qa('#canvas .stat-pill svg').length === 5);
    ok('telefoonnummers zichtbaar', qa('#canvas .k-phone').length === 5);
    ok('kopieerknoppen', qa('#canvas .k-copy').length === 5);
    ok('belafspraken gemarkeerd', qa('#canvas .k-call').length === 2, qa('#canvas .k-call').length);
    ok('bladerknoppen uit', $('prevBtn').disabled && $('nextBtn').disabled);

    // ---- filters ----
    click(q('#canvas [data-preset="tebellen"]'));
    ok('filter "nog te bellen"', qa('#canvas .klant').length === 3, qa('#canvas .klant').length);
    click(q('#canvas [data-preset="gebeld"]'));
    ok('filter "al gebeld"', qa('#canvas .klant').length === 2, qa('#canvas .klant').length);
    click(q('#canvas [data-st="akkoord"]'));
    ok('losse status uitzetten', qa('#canvas .klant').length === 1, qa('#canvas .klant').length);
    click(q('#canvas [data-preset="alles"]'));
    ok('filter resetten', qa('#canvas .klant').length === 5, qa('#canvas .klant').length);

    const tellingen = qa('#canvas .fchip .n').map(e => e.textContent);
    ok('aantallen per status', JSON.stringify(tellingen) === JSON.stringify(['2','1','1','1','0']), JSON.stringify(tellingen));

    // ---- klantvenster ----
    click(q('#canvas .k-main'));
    ok('klantvenster open', !$('ldOverlay').hidden);
    ok('naam ingevuld', $('lName').value === 'Cas en Dina', $('lName').value);
    ok('telefoon ingevuld', $('lPhone').value === '+31 6 00000004', $('lPhone').value);
    ok('status voorgeselecteerd', $('lStatus').querySelector('[aria-pressed="true"]').getAttribute('data-pickst') === 'gebeld');
    ok('verwijderknop zichtbaar', !$('lDelete').hidden);

    // status wijzigen en opslaan
    click($('lStatus').querySelector('[data-pickst="akkoord"]'));
    click($('lSave'));
    ok('venster dicht na opslaan', $('ldOverlay').hidden);
    const pills2 = qa('#canvas .stat-pill').map(e => e.textContent.trim());
    ok('status opgeslagen', pills2[0] === 'Akkoord', pills2[0]);
    // terugzetten
    click(q('#canvas .k-main'));
    click($('lStatus').querySelector('[data-pickst="gebeld"]'));
    click($('lSave'));

    // ---- overige weergaven ----
    click(q('.viewswitch [data-view="lijst"]'));
    ok('lijstweergave rendert', qa('#canvas .lrow').length > 0, qa('#canvas .lrow').length);
    ok('lijst bevat klantitems', qa('#canvas .lrow[data-lead]').length > 0);
    $('searchBox').value = 'eva';
    $('searchBox').dispatchEvent(new w.Event('input', { bubbles: true }));
    ok('zoeken op klantnaam', qa('#canvas .lrow').length === 2, qa('#canvas .lrow').length);
    $('searchBox').value = '';
    $('searchBox').dispatchEvent(new w.Event('input', { bubbles: true }));

    click(q('.viewswitch [data-view="dag"]'));
    ok('dagweergave rendert', !!$('gridScroll'));
    click(q('.viewswitch [data-view="week"]'));

    // ---- afspraak toevoegen ----
    click($('newBtn'));
    ok('afspraakvenster open', !$('evOverlay').hidden);
    $('fTitle').value = 'Testafspraak';
    $('fDate').value = '2026-09-01';
    click($('fSave'));
    ok('afspraakvenster dicht', $('evOverlay').hidden);
    ok('afspraak toegevoegd', qa('#canvas .ev[data-ev]').length > 0, qa('#canvas .ev[data-ev]').length);

    // ---- taken ----
    $('tkInput').value = 'Testtaak';
    click($('tkAdd'));
    ok('taak toegevoegd', qa('#taskCard .tasklist li').length === 1);
    ok('taakveld geleegd', $('tkInput').value === '');

    // ---- opslag ----
    const saved = JSON.parse(w.localStorage.getItem('weekzicht.v1'));
    ok('klanten lokaal bewaard', saved.leads.length === 5, saved.leads && saved.leads.length);
    ok('geen opmaakvelden opgeslagen',
      !JSON.stringify(saved.events).match(/"_s"|"_e"|"_col"|"_n"/), JSON.stringify(saved.events).slice(0, 120));
    ok('seedvlag gezet', w.localStorage.getItem('weekzicht.v1.leads-seeded') === '1');


    // ---- "Gebeld"-vinkje ----
    click(q('.viewswitch [data-view="klanten"]'));
    function rowByName(n) {
      return qa('#canvas .klant').find(r => r.querySelector('.k-name').textContent.trim() === n);
    }
    function check(row) {
      const cb = row.querySelector('[data-called]');
      cb.checked = !cb.checked;
      cb.dispatchEvent(new w.Event('change', { bubbles: true }));
    }
    function statusOf(n) { return rowByName(n).querySelector('.stat-pill').textContent.trim(); }

    ok('vinkje op elke rij', qa('#canvas [data-called]').length === 5, qa('#canvas [data-called]').length);
    ok('gebelde klant staat aan', rowByName('Cas en Dina').querySelector('[data-called]').checked);
    ok('niet-gebelde klant staat uit', !rowByName('Anna de Vries').querySelector('[data-called]').checked);
    ok('aangevinkte rij is gemarkeerd', rowByName('Cas en Dina').querySelector('.k-check').className.indexOf('on') >= 0);

    // aanvinken zet de status op Gebeld en noteert de datum
    check(rowByName('Anna de Vries'));
    ok('aanvinken -> Gebeld', statusOf('Anna de Vries') === 'Gebeld', statusOf('Anna de Vries'));
    ok('beldatum genoteerd', /gebeld op/.test(rowByName('Anna de Vries').textContent), rowByName('Anna de Vries').textContent.slice(0,80));
    ok('vinkje blijft aan na hertekenen', rowByName('Anna de Vries').querySelector('[data-called]').checked);

    // uitvinken zet hem terug (geen belafspraak -> Nog bellen)
    check(rowByName('Anna de Vries'));
    ok('uitvinken -> Nog bellen', statusOf('Anna de Vries') === 'Nog bellen', statusOf('Anna de Vries'));
    ok('beldatum weer weg', !/gebeld op/.test(rowByName('Anna de Vries').textContent));

    // uitvinken met belafspraak valt terug op Call gepland, mét waarschuwing
    $('toast').hidden = true;
    check(rowByName('Eva Bakker'));
    ok('akkoord uitvinken -> Call gepland', statusOf('Eva Bakker') === 'Call gepland', statusOf('Eva Bakker'));
    ok('waarschuwing getoond', !$('toast').hidden && /Akkoord/.test($('toast').textContent), $('toast').textContent);
    check(rowByName('Eva Bakker'));
    ok('weer aanvinken -> Gebeld', statusOf('Eva Bakker') === 'Gebeld', statusOf('Eva Bakker'));

    // filter "Al gebeld" volgt het vinkje
    click(q('#canvas [data-preset="gebeld"]'));
    ok('filter volgt vinkjes', qa('#canvas .klant').length === 2, qa('#canvas .klant').length);
    click(q('#canvas [data-preset="alles"]'));

    // venster en vinkje blijven gelijk
    click(rowByName('Eva Bakker').querySelector('.k-main'));
    ok('venster toont Gebeld', $('lStatus').querySelector('[aria-pressed="true"]').getAttribute('data-pickst') === 'gebeld');
    click($('lStatus').querySelector('[data-pickst="akkoord"]'));
    click($('lSave'));
    ok('via venster akkoord -> vinkje aan', rowByName('Eva Bakker').querySelector('[data-called]').checked);
    ok('via venster akkoord -> beldatum', /gebeld op/.test(rowByName('Eva Bakker').textContent));

    // ---- begin- en eindtijd van de klus ----
    click(rowByName('Bram Jansen').querySelector('.k-main'));
    ok('tijdvelden in klantvenster', !!$('lStart') && !!$('lEnd'));
    ok('formulierblok zonder link', /Maak formulierlink/.test($('lFormBox').textContent), $('lFormBox').textContent.slice(0, 60));
    $('lStart').value = '11:00';
    $('lStart').dispatchEvent(new w.Event('change', { bubbles: true }));
    ok('eindtijd voorgesteld', $('lEnd').value === '20:00', $('lEnd').value);
    $('lEnd').value = '01:00';
    click($('lSave'));
    ok('tijden in klantenlijst', /11:00–01:00/.test(rowByName('Bram Jansen').textContent), rowByName('Bram Jansen').textContent.slice(0, 80));
    let bram = JSON.parse(w.localStorage.getItem('weekzicht.v1')).leads.find(l => l.name === 'Bram Jansen');
    ok('tijden bewaard', bram.start === '11:00' && bram.end === '01:00', JSON.stringify([bram.start, bram.end]));

    // ---- formulierlink maken ----
    click(rowByName('Bram Jansen').querySelector('.k-main'));
    click($('lMakeLink'));
    await wait(30);
    ok('link gemaakt', !!$('lLink') && /^https:\/\/example\.test\/\?f=[a-z0-9]{22}$/.test($('lLink').value), $('lLink') && $('lLink').value);
    const token = $('lLink').value.split('?f=')[1];
    ok('nog niet ingevuld, met tijdstip', /Nog niet ingevuld · link gemaakt op 1 sep 2026 om 12:00$/.test($('lFormBox').querySelector('.fstate').textContent), $('lFormBox').querySelector('.fstate').textContent);
    ok('server kent de link', fetchMock.store.has('formulier:' + token));
    ok('server kent naam en datum', (() => { const r = JSON.parse(fetchMock.store.get('formulier:' + token)); return r.naam === 'Bram Jansen' && r.datum === '2026-10-03'; })());
    ok('venster blijft open', !$('ldOverlay').hidden);
    click(q('#ldOverlay [data-close]'));
    ok('chip "formulier gestuurd"', /formulier gestuurd/.test(rowByName('Bram Jansen').textContent));
    bram = JSON.parse(w.localStorage.getItem('weekzicht.v1')).leads.find(l => l.name === 'Bram Jansen');
    ok('token bij de klant bewaard', bram.formToken === token);

    // server kwijt (bijv. herstart zonder Redis): verversen meldt de link opnieuw aan
    fetchMock.store.delete('formulier:' + token);
    click(rowByName('Bram Jansen').querySelector('.k-main'));
    click($('lCheckForm'));
    await wait(30);
    ok('link opnieuw aangemeld', /opnieuw aangemeld/.test($('toast').textContent), $('toast').textContent);
    ok('server kent de link weer', (() => { const r = fetchMock.store.get('formulier:' + token); return r && JSON.parse(r).naam === 'Bram Jansen'; })());
    click(q('#ldOverlay [data-close]'));

    // ---- de klant opent de link op een eigen apparaat ----
    const errors2 = [];
    const dom2 = new JSDOM(doc, {
      runScripts: 'dangerously', pretendToBeVisual: true,
      url: 'https://example.test/?f=' + token,
      beforeParse(win) { freezeClock(win); win.fetch = fetchMock; },
      virtualConsole: new (require('jsdom').VirtualConsole)().on('jsdomError', e => errors2.push('jsdomError: ' + e.message))
    });
    const w2 = dom2.window, d2 = w2.document;
    w2.addEventListener('error', e => errors2.push('window error: ' + e.message));
    await wait(30);
    const $2 = id => d2.getElementById(id);
    ok('klant: geen scriptfouten', errors2.length === 0, errors2.join(' | '));
    ok('klant: formulier zichtbaar', !$2('formPage').hidden && !$2('fpForm').hidden);
    ok('klant: planning verborgen', d2.querySelector('.app').hidden);
    ok('klant: geen klantgegevens op de pagina', !/Anna de Vries|00000001/.test(d2.body.textContent));
    ok('klant: naam voor-ingevuld', $2('q_namen').value === 'Bram Jansen', $2('q_namen').value);
    ok('klant: datum voor-ingevuld', $2('q_datum').value === '2026-10-03', $2('q_datum').value);
    ok('klant: begin- en eindtijd gevraagd', $2('q_start').type === 'time' && $2('q_eind').type === 'time');
    ok('klant: aangesproken met naam', /Bram Jansen/.test($2('fpTitle').textContent), $2('fpTitle').textContent);

    function submit2() { $2('fpForm').dispatchEvent(new w2.Event('submit', { bubbles: true, cancelable: true })); }
    submit2();
    await wait(10);
    ok('klant: verplicht veld gemeld', /e-mailadres/i.test($2('fpStatus').textContent), $2('fpStatus').textContent);
    ok('klant: niets verstuurd', !JSON.parse(fetchMock.store.get('formulier:' + token)).ingevuld);

    $2('q_email').value = 'bram@voorbeeld.nl';
    $2('q_telefoon').value = '06 00000002';
    $2('q_start').value = '10:00';
    $2('q_start').dispatchEvent(new w2.Event('change', { bubbles: true }));
    ok('klant: eindtijd voorgesteld', $2('q_eind').value === '19:00', $2('q_eind').value);
    $2('q_eind').value = '00:30';
    $2('q_locCeremonie').value = 'Kasteel Keukenhof';
    d2.querySelector('input[name="q_momenten"][value="Ceremonie"]').checked = true;
    d2.querySelector('input[name="q_momenten"][value="Openingsdans"]').checked = true;
    $2('q_wensen').value = 'De speech van opa niet missen.';
    submit2();
    await wait(30);
    ok('klant: bedankt-scherm', !$2('fpDone').hidden && /Bedankt, Bram Jansen/.test($2('fpDone').textContent), $2('fpDone').textContent.slice(0, 60));
    ok('klant: formulier weg', $2('fpForm').hidden);
    ok('klant: samenvatting toont wensen', /opa/.test($2('fpDone').textContent));
    const rec = JSON.parse(fetchMock.store.get('formulier:' + token));
    ok('server: antwoorden opgeslagen', rec.antwoorden && rec.antwoorden.start === '10:00' && rec.antwoorden.eind === '00:30', JSON.stringify(rec.antwoorden));
    ok('server: vinkjes opgeslagen', JSON.stringify(rec.antwoorden.momenten) === JSON.stringify(['Ceremonie', 'Openingsdans']));
    ok('klant: geen scriptfouten na versturen', errors2.length === 0, errors2.join(' | '));
    w2.close();

    // ---- de antwoorden komen terug in de planning ----
    click(rowByName('Bram Jansen').querySelector('.k-main'));
    await wait(30);
    ok('antwoorden in venster', /^Ingevuld op \d{1,2} [a-z]{3} \d{4} om \d{2}:\d{2}$/.test($('lFormBox').querySelector('.fstate').textContent), $('lFormBox').querySelector('.fstate').textContent);
    ok('antwoorden leesbaar', /Kasteel Keukenhof/.test($('lFormBox').textContent) && /Ceremonie, Openingsdans/.test($('lFormBox').textContent));
    ok('tijden overgenomen', $('lStart').value === '10:00' && $('lEnd').value === '00:30', JSON.stringify([$('lStart').value, $('lEnd').value]));
    ok('melding ontvangen', /Formulier ontvangen van Bram Jansen/.test($('toast').textContent), $('toast').textContent);
    click($('lSave'));
    ok('chip "formulier ingevuld"', /formulier ingevuld/.test(rowByName('Bram Jansen').textContent));
    ok('tijdchip bijgewerkt', /10:00–00:30/.test(rowByName('Bram Jansen').textContent));
    bram = JSON.parse(w.localStorage.getItem('weekzicht.v1')).leads.find(l => l.name === 'Bram Jansen');
    ok('formulier lokaal bewaard', bram.form && bram.form.wensen === 'De speech van opa niet missen.' && bram.formAt === rec.ingevuld);

    // nogmaals verversen: niets nieuws, geen dubbel werk
    click(rowByName('Bram Jansen').querySelector('.k-main'));
    click($('lCheckForm'));
    await wait(30);
    ok('ververs zonder nieuws', /Geen nieuwe antwoorden/.test($('toast').textContent), $('toast').textContent);
    click(q('#ldOverlay [data-close]'));

    // klus met tijden in de agenda: week van 3 oktober
    click($('nextBtn')); click($('nextBtn')); click($('nextBtn')); click($('nextBtn')); click($('nextBtn'));
    const klus = qa('#canvas [data-lead]').find(e => /Bram Jansen/.test(e.textContent));
    ok('klus in agenda van die week', !!klus);
    ok('klus staat op tijd, niet als hele dag', klus && !klus.closest('.allday, .ad, [data-allday]') && /10:00/.test(klus.getAttribute('title') || klus.textContent || ''),
      klus && (klus.getAttribute('title') || klus.textContent));

    ok('nog steeds geen scriptfouten', errors.length === 0, errors.join(' | '));
  } catch (e) {
    fail++; console.log('EXCEPTIE:', e.stack);
  }
  console.log('\n' + pass + ' geslaagd, ' + fail + ' gefaald');
  w.close();
  process.exit(fail ? 1 : 0);
}, 400);
