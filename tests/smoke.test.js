const fs = require('fs');
const { JSDOM } = require('jsdom');

const path = require('path');
const FIXTURE = require('./fixture.js');
// De gebouwde pagina testen, niet de bron: zo dekt de test ook build.mjs.
const doc = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const errors = [];
const dom = new JSDOM(doc, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://example.test/',
  // De app kent geen startgegevens meer; zet ze klaar zoals een browser dat zou hebben.
  beforeParse(win) {
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

setTimeout(() => {
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
    $('fDate').value = $('clockDate') && new Date().toISOString().slice(0, 10);
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

    ok('nog steeds geen scriptfouten', errors.length === 0, errors.join(' | '));
  } catch (e) {
    fail++; console.log('EXCEPTIE:', e.stack);
  }
  console.log('\n' + pass + ' geslaagd, ' + fail + ' gefaald');
  w.close();
  process.exit(fail ? 1 : 0);
}, 400);
