// Trekt de pure functies uit src/weekzicht.html zodat node ze kan testen.
// De app is bewust één bestand zonder bundelstap; hier knippen we de blokken
// eruit die geen DOM nodig hebben.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(dirname(HERE), "src", "weekzicht.html");
const src = readFileSync(SRC, "utf8").match(/<script>([\s\S]*)<\/script>/)[1];

const cut = (a, b) => {
  const i = src.indexOf(a), j = src.indexOf(b);
  if (i < 0) throw new Error(`markering niet gevonden: ${a.slice(0, 40)}`);
  if (j < 0) throw new Error(`markering niet gevonden: ${b.slice(0, 40)}`);
  return src.slice(i, j);
};

const TOESTAND = "/* ==========================================================\n     3. Toestand";
const EXPORT = "/* ==========================================================\n     8. Exporteren";

const HEAD = `
var AMS="Europe/Amsterdam";
var DAYS=["maandag","dinsdag","woensdag","donderdag","vrijdag","zaterdag","zondag"];
var DAYS_S=["ma","di","wo","do","vr","za","zo"];
var MONTHS=["januari","februari","maart","april","mei","juni","juli","augustus","september","oktober","november","december"];
var MONTHS_S=["jan","feb","mrt","apr","mei","jun","jul","aug","sep","okt","nov","dec"];
var CATS=[{id:"afspraak",label:"Afspraak"},{id:"focus",label:"Focus"},{id:"reizen",label:"Reizen"},{id:"prive",label:"Priv\\u00e9"},{id:"overig",label:"Overig"}];
var CAT_IDS=CATS.map(function(c){return c.id;});
function catVar(id){return "var(--cat-"+(CAT_IDS.indexOf(id)>=0?id:"overig")+")";}
function catLabel(id){for(var i=0;i<CATS.length;i++)if(CATS[i].id===id)return CATS[i].label;return "Overig";}
function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
var CAPTURED=[];
function put(c,o){CAPTURED.push(o);}
function putMany(c,a){a.forEach(function(o){CAPTURED.push(o);});}
function render(){}
function toast(m){LAST_TOAST=m;}
var LAST_TOAST="";
function uid(p){return (p||"e")+Math.random().toString(36).slice(2,8);}
var state={events:[],tasks:[],leads:[],hidden:{},stHidden:{},settings:{weekend:true,dayStart:7,dayEnd:21}};
`;

writeFileSync(join(HERE, "_lib.js"),
  HEAD
  + cut("function pad(n)", TOESTAND)
  + cut("function unfoldICS", EXPORT)
  + cut("  function packColumns(items)", "  function hourRange(dates)")
  + "\nmodule.exports={amsNow,instantToAms,wallToInstant,civ,dstr,addD,dowOf,mondayOf,diffD,"
  + "isoWeek,toMin,toTime,durText,hoursText,fmtLong,fmtShort,parseICS,parseDT,parseDuration,"
  + "expandRule,nthWeekday,splitAcrossDays,importICS,hash36,guessCat,CAPTURED,packColumns};\n",
  "utf8");

writeFileSync(join(HERE, "_lead-lib.js"),
  HEAD
  + cut("  var STATUSES = [", "  var LS_KEY")
  + cut("function pad(n)", TOESTAND)
  + cut("  function visibleEvents()", "  function periodDates()")
  + cut("  function isCalled(status)", "  function renderKlanten()")
  + "\nmodule.exports={STATUSES,stVar,stDef,icon,leadName,visibleLeads,leadCallEnd,dayItems,"
  + "itemColor,itemAttr,itemTitleHtml,sortLeads,statusCounts,isCalled,toggleCalled,findLead,"
  + "state,addD,dowOf,diffD,civ,toMin,toTime,CAPTURED,get LAST_TOAST(){return LAST_TOAST;}};\n",
  "utf8");

console.log("_lib.js en _lead-lib.js gebouwd");
