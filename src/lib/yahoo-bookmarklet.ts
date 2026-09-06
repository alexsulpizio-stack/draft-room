function pageScript(endpoint: string) {
  const ep = JSON.stringify(endpoint);
  return `(async function(){
var endpoint=${ep},host=(location.hostname||"").toLowerCase();
if(!(host==="yahoo.com"||/\\.yahoo\\.com$/.test(host))){alert("Yahoo Sync must be run on a Yahoo Fantasy page.");return;}
function badge(text,bad){var id="draft-room-yahoo-badge",b=document.getElementById(id);if(!b){b=document.createElement("div");b.id=id;b.style.cssText="position:fixed;right:16px;bottom:16px;z-index:2147483647;color:#fff;background:#5f259f;padding:10px 14px;border-radius:12px;font:600 13px/1.3 system-ui,sans-serif;box-shadow:0 8px 24px #0005";document.documentElement.appendChild(b);}b.style.background=bad?"#9b1c1c":"#5f259f";b.textContent="Draft Room · "+text;}
function clean(s){return String(s||"").replace(/\\s+/g," ").trim();}
function teamsOnBoard(){var count=0;[...document.querySelectorAll("body *")].forEach(function(n){var s=clean(n.innerText||"");if(/^Team \\d+$/i.test(s)||/^You$/i.test(s))count++;});return count>=2&&count<=20?count:12;}
function read(){
 var rows=[],seen=new Set(),teams=teamsOnBoard();
 var nodes=[...document.querySelectorAll("body *")].filter(function(n){
  var s=clean(n.innerText||n.textContent||"");
  return /(?:^|\\s)\\d{1,2}\\.\\d{1,2}(?=\\s|$)/.test(s)&&![...n.children].some(function(c){return /(?:^|\\s)\\d{1,2}\\.\\d{1,2}(?=\\s|$)/.test(clean(c.innerText||c.textContent||""));});
 });
 for(var i=0;i<nodes.length;i++){
   var text=clean(nodes[i].innerText||nodes[i].textContent||"");
   var m=text.match(/(?:^|\\s)(\\d{1,2})\\.(\\d{1,2})(?=\\s|$)/);
   if(!m) continue;
   var round=Number(m[1]),slot=Number(m[2]),overall=(round-1)*teams+slot;
   var rest=clean(text.slice(0,text.indexOf(m[0]))).replace(/\\bON THE CLOCK\\b/i,"").trim();
   var meta=rest.match(/\\b(QB|RB|WR|TE|K|DST)\\s*[·•-]\\s*([A-Z]{2,3})\\b/i),pos,nflTeam;
   if(meta){pos=meta[1].toUpperCase();nflTeam=meta[2].toUpperCase();rest=rest.slice(0,meta.index).trim();}
   if(/^(Team \\d+|You|On the clock)$/i.test(rest)) continue;
   if(!(overall>0)||!rest||seen.has(overall)||rest.length>60||rest.length<3) continue;
   seen.add(overall);rows.push({overall:overall,playerName:rest,pos:pos,nflTeam:nflTeam});
 }
 if(!rows.length){
  var lines=(document.body.innerText||"").split(/\\n+/).map(clean).filter(Boolean);
  for(var j=0;j<lines.length;j++){
   var lm=lines[j].match(/^(\\d{1,2})\\.(\\d{1,2})$/);if(!lm)continue;
   var name="",k=j-1;
   while(k>=0&&!name){var candidate=lines[k].replace(/\\b(QB|RB|WR|TE|K|DST)\\s*[·•-].*$/i,"").trim();if(candidate&&!/^Team \\d+$|^You$|^On the clock$/i.test(candidate)&&!/^\\d/.test(candidate))name=candidate;k--;}
   var ov=(Number(lm[1])-1)*teams+Number(lm[2]);
   if(name&&name.length>=3&&!seen.has(ov)){seen.add(ov);rows.push({overall:ov,playerName:name});}
  }
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
