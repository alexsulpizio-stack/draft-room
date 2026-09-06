function pageScript(endpoint: string) {
  const ep = JSON.stringify(endpoint);
  return `(async function(){
var endpoint=${ep},host=(location.hostname||"").toLowerCase();
if(!(host==="yahoo.com"||/\\.yahoo\\.com$/.test(host))){alert("Yahoo Sync must be run on a Yahoo Fantasy page.");return;}
function badge(text,bad){var id="draft-room-yahoo-badge",b=document.getElementById(id);if(!b){b=document.createElement("div");b.id=id;b.style.cssText="position:fixed;right:16px;bottom:16px;z-index:2147483647;color:#fff;background:#5f259f;padding:10px 14px;border-radius:12px;font:600 13px/1.3 system-ui,sans-serif;box-shadow:0 8px 24px #0005";document.documentElement.appendChild(b);}b.style.background=bad?"#9b1c1c":"#5f259f";b.textContent="Draft Room · "+text;}
function clean(s){return String(s||"").replace(/\\s+/g," ").replace(/^\\s*[#.]?\\d+(?:\\.\\d+)?[.)]?\\s*/,"").trim();}
function read(){
 var rows=[],seen=new Set();
 var nodes=[...document.querySelectorAll("tr,[role=row],[data-testid*='pick'],[class*='pick'],[class*='Pick']")];
 for(var i=0;i<nodes.length;i++){
   var text=clean(nodes[i].innerText||nodes[i].textContent||"");
   var m=text.match(/^(?:pick\\s*)?(\\d{1,3})(?:[.)]|\\s{1,3})(.+)$/i);
   if(!m) continue;
   var overall=Number(m[1]),rest=clean(m[2]).replace(/\\s+(QB|RB|WR|TE|K|DST)\\b.*$/i,"").trim();
   if(!(overall>0)||!rest||seen.has(overall)||rest.length>60||rest.length<3) continue;
   seen.add(overall);rows.push({overall:overall,playerName:rest});
 }
 return rows.sort(function(a,b){return a.overall-b.overall;});
}
badge("scanning");
var picks=read();
if(!picks.length){badge("0 picks — Yahoo layout not recognized",1);return;}
try{
 var r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({picks:picks,href:location.href,title:document.title,ts:Date.now()})});
 if(!r.ok) throw new Error("HTTP "+r.status);
 badge(picks.length+" picks · connected");
}catch(e){badge("connection failed — keep Draft Room open on this computer",1);}
})();`;
}

export function buildYahooBookmarklet(endpoint: string): string {
  return `javascript:${pageScript(endpoint).replace(/\\n/g, "")}`;
}
