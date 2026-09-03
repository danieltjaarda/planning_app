const L = require('./_lib.js');
let fail=0,pass=0;
function eq(n,g,w){const a=JSON.stringify(g),b=JSON.stringify(w);if(a===b)pass++;else{fail++;console.log("FAIL",n,"\n  got ",a,"\n  want",b);}}

// --- overlap-indeling ---
function P(list){ const items=list.map(([s,e],i)=>({id:"x"+i,_s:s,_e:e})); L.packColumns(items); return items.map(o=>o._col+"/"+o._n); }
eq("geen overlap", P([[540,600],[660,720]]), ["0/1","0/1"]);
eq("twee overlappend", P([[540,660],[600,720]]), ["0/2","1/2"]);
eq("drie overlappend", P([[540,720],[560,600],[570,660]]), ["0/3","1/3","2/3"]);
eq("kolom hergebruikt", P([[540,600],[540,660],[600,700]]), ["0/2","1/2","0/2"]);
eq("twee losse clusters", P([[540,600],[560,620],[700,760]]), ["0/2","1/2","0/1"]);

// --- volledige import end-to-end ---
const today = L.amsNow().date;
function d(n){ return L.addD(today,n); }
function stamp(ds,t){ return ds.replace(/-/g,"") + "T" + t.replace(":","") + "00"; }
const ics = ["BEGIN:VCALENDAR",
 "BEGIN:VEVENT","UID:w1","SUMMARY:Wekelijks overleg",
 "DTSTART;TZID=Europe/Amsterdam:"+stamp(d(1),"10:00"),
 "DTEND;TZID=Europe/Amsterdam:"+stamp(d(1),"11:00"),
 "RRULE:FREQ=WEEKLY","END:VEVENT",
 "BEGIN:VEVENT","UID:o1","SUMMARY:Ver in de toekomst","DTSTART;TZID=Europe/Amsterdam:"+stamp(L.addD(today,400),"10:00"),
 "DTEND;TZID=Europe/Amsterdam:"+stamp(L.addD(today,400),"11:00"),"END:VEVENT",
 "BEGIN:VEVENT","UID:v1","SUMMARY:Vrij","DTSTART;VALUE=DATE:"+d(3).replace(/-/g,""),
 "DTEND;VALUE=DATE:"+d(5).replace(/-/g,""),"END:VEVENT",
 "END:VCALENDAR"].join("\r\n");

L.CAPTURED.length = 0;
L.importICS(ics);
const got = L.CAPTURED;
const weekly = got.filter(e=>e.title==="Wekelijks overleg");
eq("wekelijks binnen venster", weekly.length, 26);  // +1 dag t/m +182 dagen, stap 7
eq("wekelijkse tijd", weekly[0].start + "-" + weekly[0].end, "10:00-11:00");
eq("buiten venster genegeerd", got.filter(e=>e.title==="Ver in de toekomst").length, 0);
const vrij = got.filter(e=>e.title==="Vrij");
eq("hele dag, DTEND exclusief -> 2 dagen", vrij.length, 2);
eq("hele dag vlag", vrij[0].allDay, true);
eq("hele dag datums", vrij.map(e=>e.date), [d(3), d(4)]);

// herimport = zelfde ids (geen dubbelingen)
const ids1 = got.map(e=>e.id).sort();
L.CAPTURED.length = 0;
L.importICS(ics);
const ids2 = L.CAPTURED.map(e=>e.id).sort();
eq("herimport levert identieke ids", ids1.join(","), ids2.join(","));

console.log("\n" + pass + " geslaagd, " + fail + " gefaald");
process.exit(fail?1:0);
