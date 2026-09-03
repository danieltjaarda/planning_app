#!/usr/bin/env python3
"""Trekt de pure functies uit src/weekzicht.html zodat node ze kan testen.

De app is bewust één bestand zonder bundelstap; de testbestanden knippen
de blokken eruit die geen DOM nodig hebben.
"""
import io, os, re

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(os.path.dirname(ROOT), "src", "weekzicht.html")
src = re.search(r"<script>(.*)</script>", io.open(SRC, encoding="utf-8").read(), re.S).group(1)

def cut(a, b):
    return src[src.index(a):src.index(b)]

TOESTAND = "/* ==========================================================\n     3. Toestand"
EXPORT = "/* ==========================================================\n     8. Exporteren"

HEAD = '''
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
function toast(m){}
function uid(p){return (p||"e")+Math.random().toString(36).slice(2,8);}
var state={events:[],tasks:[],leads:[],hidden:{},stHidden:{},settings:{weekend:true,dayStart:7,dayEnd:21}};
'''

# agenda-, tijdzone- en ICS-logica
io.open(os.path.join(ROOT, "_lib.js"), "w", encoding="utf-8").write(
    HEAD
    + cut("function pad(n)", TOESTAND)
    + cut("function unfoldICS", EXPORT)
    + cut("  function packColumns(items)", "  function hourRange(dates)")
    + "\nmodule.exports={amsNow,instantToAms,wallToInstant,civ,dstr,addD,dowOf,mondayOf,diffD,"
      "isoWeek,toMin,toTime,durText,hoursText,fmtLong,fmtShort,parseICS,parseDT,parseDuration,"
      "expandRule,nthWeekday,splitAcrossDays,importICS,hash36,guessCat,CAPTURED,packColumns};\n")

# klantenlogica
io.open(os.path.join(ROOT, "_lead-lib.js"), "w", encoding="utf-8").write(
    HEAD
    + cut("  var STATUSES = [", "  var LS_KEY")
    + cut("function pad(n)", TOESTAND)
    + cut("  function visibleEvents()", "  function periodDates()")
    + cut("  function isCalled(status)", "  function renderKlanten()")
    + cut("  var SEED_LEADS = [", "  function seedLeads()")
    + "\nmodule.exports={STATUSES,stVar,stDef,icon,leadName,visibleLeads,leadCallEnd,dayItems,"
      "itemColor,itemAttr,itemTitleHtml,sortLeads,statusCounts,isCalled,SEED_LEADS,state,"
      "addD,dowOf,diffD,civ,toMin,toTime};\n")

print("_lib.js en _lead-lib.js gebouwd")
