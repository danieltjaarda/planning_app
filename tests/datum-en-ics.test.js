const L = require('./_lib.js');
let fail = 0, pass = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log("FAIL", name, "\n   got ", g, "\n   want", w); }
}

// --- kalenderrekenen ---
eq("dowOf ma", L.dowOf("2026-09-07"), 0);
eq("dowOf zo", L.dowOf("2026-09-06"), 6);
eq("mondayOf", L.mondayOf("2026-09-02"), "2026-08-31");
eq("addD over maand", L.addD("2026-08-31", 7), "2026-09-07");
eq("addD terug", L.addD("2026-01-01", -1), "2025-12-31");
eq("diffD", L.diffD("2026-09-10","2026-09-02"), 8);

// ISO-weeknummers (bekende waarden)
eq("isoWeek 2026-09-02", L.isoWeek("2026-09-02").week, 36);
eq("isoWeek 2026-01-01", L.isoWeek("2026-01-01").week, 1);
eq("isoWeek 2027-01-01", L.isoWeek("2027-01-01").week, 53);   // 2026 heeft 53 weken
eq("isoWeek 2027-01-01 jaar", L.isoWeek("2027-01-01").year, 2026);
eq("isoWeek 2024-12-30", L.isoWeek("2024-12-30").week, 1);
eq("isoWeek 2024-12-30 jaar", L.isoWeek("2024-12-30").year, 2025);
eq("isoWeek 2021-01-01", L.isoWeek("2021-01-01").week, 53);
eq("isoWeek 2020-12-31 jaar", L.isoWeek("2020-12-31").year, 2020);

// --- tijd ---
eq("toMin", L.toMin("14:35"), 875);
eq("toTime", L.toTime(875), "14:35");
eq("toTime clamp", L.toTime(1500), "23:59");
eq("durText", L.durText(90), "1 u 30 min");
eq("durText uur", L.durText(120), "2 u");
eq("hoursText", L.hoursText(150), "2,5 u");

// --- tijdzone: UTC -> Amsterdam, zomer- en wintertijd ---
eq("zomertijd (CEST +2)", L.instantToAms(new Date("2026-07-01T12:00:00Z")), {date:"2026-07-01", time:"14:00"});
eq("wintertijd (CET +1)", L.instantToAms(new Date("2026-01-15T12:00:00Z")), {date:"2026-01-15", time:"13:00"});
eq("net na overgang okt", L.instantToAms(new Date("2026-10-25T01:30:00Z")), {date:"2026-10-25", time:"02:30"});
eq("dagovergang", L.instantToAms(new Date("2026-03-01T23:30:00Z")), {date:"2026-03-02", time:"00:30"});

// New York wandklok -> Amsterdam
const inst = L.wallToInstant(2026, 7, 1, 9, 0, 0, "America/New_York");
eq("NY 09:00 -> AMS", L.instantToAms(inst), {date:"2026-07-01", time:"15:00"});
eq("NY winter 09:00 -> AMS", L.instantToAms(L.wallToInstant(2026,1,15,9,0,0,"America/New_York")), {date:"2026-01-15", time:"15:00"});
eq("Tokyo 09:00 -> AMS", L.instantToAms(L.wallToInstant(2026,7,1,9,0,0,"Asia/Tokyo")), {date:"2026-07-01", time:"02:00"});
eq("onbekende tz -> null", L.wallToInstant(2026,7,1,9,0,0,"Not/AZone"), null);

// --- ICS-parsing ---
const ics = [
"BEGIN:VCALENDAR","VERSION:2.0",
"BEGIN:VEVENT","UID:a1","SUMMARY:Klantgesprek\\, kwartaal","LOCATION:Teams",
"DTSTART:20260902T110000Z","DTEND:20260902T123000Z","END:VEVENT",
"BEGIN:VEVENT","UID:a2","SUMMARY:Standup","DTSTART;TZID=Europe/Amsterdam:20260902T093000",
"DTEND;TZID=Europe/Amsterdam:20260902T094500","RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6","END:VEVENT",
"BEGIN:VEVENT","UID:a3","SUMMARY:Vakantie","DTSTART;VALUE=DATE:20260914","DTEND;VALUE=DATE:20260917","END:VEVENT",
"BEGIN:VEVENT","UID:a4","SUMMARY:Lange","","DTSTART:20260903T220000Z","DURATION:PT5H","END:VEVENT",
"BEGIN:VEVENT","UID:a5","SUMMARY:Afgezegd","STATUS:CANCELLED","DTSTART:20260904T090000Z","END:VEVENT",
"BEGIN:VEVENT","UID:a6","SUMMARY:Ingevouwen ti","  tel","DTSTART:20260905T080000Z","DTEND:20260905T090000Z","END:VEVENT",
"END:VCALENDAR"].join("\r\n");

const parsed = L.parseICS(ics);
eq("aantal VEVENTs", parsed.length, 6);
eq("escape in SUMMARY", parsed[0].title, "Klantgesprek, kwartaal");
eq("UTC start -> AMS", parsed[0].start, {allDay:false, date:"2026-09-02", time:"13:00"});
eq("TZID Amsterdam", parsed[1].start, {allDay:false, date:"2026-09-02", time:"09:30"});
eq("VALUE=DATE", parsed[2].start, {allDay:true, date:"2026-09-14", time:"00:00"});
eq("DURATION", parsed[3].duration, 300);
eq("STATUS cancelled", parsed[4].status, "CANCELLED");
eq("line folding", parsed[5].title, "Ingevouwen ti tel");

eq("parseDuration P1DT2H30M", L.parseDuration("P1DT2H30M"), 1590);

// --- RRULE ---
const wk = L.expandRule("2026-09-02", "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6", "2026-01-01", "2027-01-01", 240);
eq("weekly BYDAY telling", wk.length, 6);
eq("weekly BYDAY eerste", wk[0], "2026-09-02");   // wo, start zelf
eq("weekly BYDAY tweede", wk[1], "2026-09-07");   // ma erna
eq("weekly BYDAY derde", wk[2], "2026-09-09");

const daily = L.expandRule("2026-09-01","FREQ=DAILY;INTERVAL=3;UNTIL=20260915T000000Z","2026-01-01","2027-01-01",240);
eq("daily interval", daily, ["2026-09-01","2026-09-04","2026-09-07","2026-09-10","2026-09-13"]);

const monthly = L.expandRule("2026-01-31","FREQ=MONTHLY;COUNT=4","2026-01-01","2027-01-01",240);
eq("monthly slaat korte maanden over", monthly, ["2026-01-31","2026-03-31","2026-05-31","2026-07-31"]);

const nth = L.expandRule("2026-09-08","FREQ=MONTHLY;BYDAY=2TU;COUNT=3","2026-01-01","2027-01-01",240);
eq("monthly 2e dinsdag", nth, ["2026-09-08","2026-10-13","2026-11-10"]);

const yearly = L.expandRule("2026-03-15","FREQ=YEARLY;COUNT=3","2020-01-01","2030-01-01",240);
eq("yearly", yearly, ["2026-03-15","2027-03-15","2028-03-15"]);

const windowed = L.expandRule("2020-01-06","FREQ=WEEKLY;BYDAY=MO","2026-09-01","2026-09-30",240);
eq("venster knipt", windowed, ["2026-09-07","2026-09-14","2026-09-21","2026-09-28"]);

// --- splitsen over middernacht ---
eq("split 1 dag", L.splitAcrossDays("2026-09-02","10:00",90,false), [{date:"2026-09-02",start:"10:00",end:"11:30"}]);
eq("split over middernacht", L.splitAcrossDays("2026-09-02","23:00",180,false),
   [{date:"2026-09-02",start:"23:00",end:"23:59"},{date:"2026-09-03",start:"00:00",end:"02:00"}]);
eq("split hele dagen", L.splitAcrossDays("2026-09-14","00:00",4320,true),
   [{date:"2026-09-14",start:"00:00",end:"23:59"},{date:"2026-09-15",start:"00:00",end:"23:59"},{date:"2026-09-16",start:"00:00",end:"23:59"}]);

// --- categorie raden ---
eq("cat reizen", L.guessCat("Vlucht naar Berlijn",""), "reizen");
eq("cat prive", L.guessCat("Tandarts",""), "prive");
eq("cat focus", L.guessCat("Focusblok offerte",""), "focus");
eq("cat default", L.guessCat("Overleg met klant",""), "afspraak");

// --- stabiele id bij herimport ---
eq("hash stabiel", L.hash36("abc") === L.hash36("abc"), true);
eq("hash verschilt", L.hash36("abc") !== L.hash36("abd"), true);

console.log("\n" + pass + " geslaagd, " + fail + " gefaald");
process.exit(fail ? 1 : 0);
