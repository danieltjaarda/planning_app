const L = require('./_lead-lib.js');
let fail=0,pass=0;
function eq(n,g,w){const a=JSON.stringify(g),b=JSON.stringify(w);if(a===b)pass++;else{fail++;console.log("FAIL",n,"\n  got ",a,"\n  want",b);}}

// de ingelezen lijst
L.state.leads = L.SEED_LEADS.map(o => Object.assign({}, o));
eq("aantal klanten", L.state.leads.length, 5);

// sortering op datum, onbekend achteraan
eq("volgorde", L.sortLeads(L.state.leads).map(l => (l.date || "onbekend") + " " + L.leadName(l)),
  ["2026-05-29 David en Veerle",
   "2026-10-03 Arco van Beek",
   "2026-10-05 Juda Urk",
   "2026-10-30 Lisa van Duijn",
   "onbekend +31 6 34890705"]);

// naam valt terug op het nummer
eq("naamloos -> nummer", L.leadName({name:"", phone:"+31 6 34890705"}), "+31 6 34890705");
eq("lege lead", L.leadName({}), "Naamloos");

// tellingen per status
eq("tellingen", L.statusCounts(), {wacht:2, gepland:1, gebeld:1, akkoord:1, af:0});

// belafspraak -> tijdblok van 30 minuten
eq("belblok eindtijd", L.leadCallEnd({callTime:"18:15"}), "18:45");
eq("belblok over middernacht", L.leadCallEnd({callTime:"23:50"}), "23:59");

// klusdatum verschijnt als hele-dag item
const okt5 = L.dayItems("2026-10-05");
eq("klusdag item", okt5.map(i => i.kind+"/"+i.sub+"/"+i.title+"/"+i.allDay), ["lead/klus/Juda Urk/true"]);
eq("klusdag kleur = status", L.itemColor(okt5[0]), "var(--st-akkoord)");
eq("klusdag attribuut", L.itemAttr(okt5[0]), 'data-lead="ld-juda-urk"');
eq("klusdag icoon in titel", L.itemTitleHtml(okt5[0]).indexOf("<svg") >= 0, true);

// belafspraak met tijd -> tijdblok
const sep2 = L.dayItems("2026-09-02");
eq("belafspraak met tijd", sep2.map(i => i.title+" "+i.start+"-"+i.end+" allDay="+i.allDay),
   ["Bellen · +31 6 34890705 18:15-18:45 allDay=false"]);

// belafspraak zonder tijd -> hele dag
const sep4 = L.dayItems("2026-09-04");
eq("belafspraak zonder tijd", sep4.map(i => i.title+" allDay="+i.allDay),
   ["Bellen · Juda Urk allDay=true"]);

// afspraken en klanten door elkaar, op tijd gesorteerd
L.state.events = [
  {id:"e1", title:"Overleg", date:"2026-09-02", start:"09:00", end:"10:00", allDay:false, cat:"afspraak", loc:""},
  {id:"e2", title:"Deadline", date:"2026-09-02", start:"00:00", end:"23:59", allDay:true, cat:"focus", loc:""}
];
eq("gemengde dag", L.dayItems("2026-09-02").map(i => i.title),
   ["Deadline", "Overleg", "Bellen · +31 6 34890705"]);
eq("afspraak zonder icoon", L.itemTitleHtml(L.dayItems("2026-09-02")[1]), "Overleg");
eq("afspraak kleur = categorie", L.itemColor(L.dayItems("2026-09-02")[1]), "var(--cat-afspraak)");

// statusfilter werkt door in de agenda
L.state.stHidden = {akkoord:true};
eq("gefilterd: klusdag weg", L.dayItems("2026-10-05").length, 0);
eq("gefilterd: belafspraak weg", L.dayItems("2026-09-04").length, 0);
eq("gefilterd: afspraken blijven", L.dayItems("2026-09-02").map(i=>i.title), ["Deadline","Overleg","Bellen · +31 6 34890705"]);
L.state.stHidden = {};

// escaping
eq("escaping in titel", L.itemTitleHtml({kind:"event", title:'<img src=x>'}), "&lt;img src=x&gt;");

// elke status heeft een icoon
eq("iconen aanwezig", L.STATUSES.every(s => L.icon(s.icon,12).indexOf("<path") >= 0), true);
eq("statuskleuren", L.STATUSES.map(s => L.stVar(s.id)),
   ["var(--st-wacht)","var(--st-gepland)","var(--st-gebeld)","var(--st-akkoord)","var(--st-af)"]);

console.log("\n" + pass + " geslaagd, " + fail + " gefaald");
process.exit(fail?1:0);
