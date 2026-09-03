import { RANKS_RELAY_URL } from "./relay-urls";

export { RANKS_RELAY_URL };

/**
 * Compact FP/DS live-ranks bookmarklet (<8KB). Badge first, then scrape/post.
 * ntfy relay is required on Cursor cloud (localhost POST cannot reach the VM).
 */
export function ranksBookmarkletCode(
  origin: string,
  source: "fp" | "ds",
  relayUrl = RANKS_RELAY_URL,
): string {
  const O = JSON.stringify(origin.replace(/\/$/, ""));
  const SRC = JSON.stringify(source);
  const RELAY = JSON.stringify(relayUrl);
  return String.raw`(function(){
var O=${O},SRC=${SRC},RELAY=${RELAY},POLL=6000;
var LABEL=SRC==="ds"?"Sync DS ranks":"Sync FP ranks";
var host=(location.hostname||"").toLowerCase();
var okHost=SRC==="ds"?/draftsharks\.com$/.test(host):/(^|\.)fantasypros\.com$/.test(host);
function badge(n,msg,bad){
  lastCount=n;
  var id="draft-room-ranks-badge-"+SRC,el=document.getElementById(id);
  if(!el){
    el=document.createElement("div");
    el.id=id;
    el.setAttribute("style","position:fixed;z-index:2147483647;right:12px;bottom:"+(SRC==="ds"?"56px":"12px")+";background:#0f766e;color:#fff;font:600 12px/1.3 system-ui,sans-serif;padding:10px 14px;border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.28);max-width:min(360px,90vw)");
    (document.documentElement||document.body).appendChild(el);
  }
  el.style.background=bad?"#9b1c1c":"#0f766e";
  el.textContent=LABEL+" · "+(n||0)+" ranks"+(msg?" · "+msg:"");
}
if(!okHost){
  alert(LABEL+" only works on "+(SRC==="ds"?"draftsharks.com (Draft War Room / rankings)":"fantasypros.com or draftwizard.fantasypros.com (Draft Assistant / cheat sheet)")+". Open that tab, then click the bookmark.");
  return;
}
badge(0,"starting");
if(window.__draftRoomRanks&&window.__draftRoomRanks.source===SRC){
  try{window.__draftRoomRanks.kick();}catch(e){}
  return;
}
var lastSig="",sending=false,pending=null,lastCount=0;
function cleanName(s){
  s=String(s||"").replace(/\s+/g," ").trim();
  s=s.replace(/\s*\(.*\)\s*$/,"");
  s=s.replace(/\s+(QB|RB|WR|TE|K|DST|DEF|D\/ST)\d*$/i,"");
  s=s.replace(/\s+[A-Z]{2,3}$/,"");
  s=s.replace(/^#?\d+\.?\s+/,"");
  return s.trim();
}
function looksPlayer(name){
  if(!name||name.length<3||name.length>42) return false;
  if(!/[A-Za-z]{2,}/.test(name)) return false;
  if(/^(rank|player|name|pos|team|adp|ecr|overall|tier|value|proj|fpts|bye|status|available|drafted|taken)$/i.test(name)) return false;
  return true;
}
function addRow(map,rank,name,pos,team){
  name=cleanName(name);
  if(!looksPlayer(name)) return;
  rank=Number(rank);
  if(!Number.isFinite(rank)||rank<=0||rank>500) return;
  var key=name.toLowerCase(),prev=map.get(key);
  if(prev&&prev.rank<=rank) return;
  map.set(key,{rank:rank,name:name,pos:pos||undefined,team:team||undefined});
}
function fromAttrs(map){
  var nodes=document.querySelectorAll("[data-player-name]");
  for(var i=0;i<nodes.length;i++){
    var el=nodes[i],name=el.getAttribute("data-player-name")||"";
    var pos=el.getAttribute("data-fantasy-position")||el.getAttribute("data-position")||"";
    var team=el.getAttribute("data-team")||el.getAttribute("data-nfl-team")||"";
    var rank=0,ri=el.querySelector(".rank-index span,.rank-index,[class*='rank-index']");
    if(ri) rank=Number((ri.textContent||"").replace(/[^\d]/g,""));
    if(!rank){
      var row=el.closest("tr,[data-rank],[class*='player-row'],[class*='ranking']");
      if(row){
        rank=Number(row.getAttribute("data-rank")||row.getAttribute("data-overall-rank")||"");
        if(!rank){var first=row.querySelector("td,[class*='rank']");if(first) rank=Number((first.textContent||"").trim().split(/\s+/)[0].replace(/[^\d]/g,""));}
      }
    }
    addRow(map,rank||(i+1),name,pos,team);
  }
}
function fromTables(map){
  var tables=document.querySelectorAll("table");
  for(var t=0;t<tables.length;t++){
    var rows=tables[t].querySelectorAll("tr"),order=0;
    for(var r=0;r<rows.length;r++){
      var cells=rows[r].querySelectorAll("th,td");if(cells.length<2) continue;
      var texts=[];for(var c=0;c<cells.length;c++) texts.push((cells[c].textContent||"").replace(/\s+/g," ").trim());
      if(/^(rk|rank|#|overall)$/i.test(texts[0])) continue;
      var rank=Number(texts[0].replace(/[^\d.]/g,"")),name="",pos="",team="";
      for(var j=1;j<texts.length;j++){
        var cell=texts[j];
        if(!name&&looksPlayer(cleanName(cell))){name=cell;continue;}
        if(!pos&&/^(QB|RB|WR|TE|K|DST|DEF)$/i.test(cell)){pos=cell.toUpperCase();continue;}
        if(!team&&/^[A-Z]{2,3}$/.test(cell)&&!/^(QB|RB|WR|TE|K)$/.test(cell)){team=cell;continue;}
      }
      if(!name) continue;
      order+=1;
      addRow(map,Number.isFinite(rank)&&rank>0?rank:order,name,pos,team);
    }
  }
}
function fromText(map){
  var root=document.body?document.body.innerText:"";
  if(!root||root.length>800000) root=(root||"").slice(0,800000);
  var lines=root.split(/\n+/),order=0;
  for(var i=0;i<lines.length;i++){
    var line=lines[i].replace(/\s+/g," ").trim();
    var m=line.match(/^(\d{1,3})[.)\s]+([A-Za-z][A-Za-z.'\-]+(?:\s+[A-Za-z][A-Za-z.'\-]+){0,3})(?:\s+(QB|RB|WR|TE|K|DST|DEF))?(?:\s+([A-Z]{2,3}))?/);
    if(!m) continue;
    order+=1;
    addRow(map,Number(m[1])||order,m[2],m[3],m[4]);
  }
}
function scrape(){
  var map=new Map();
  fromAttrs(map);fromTables(map);
  if(map.size<8) fromText(map);
  var rows=Array.from(map.values()).sort(function(a,b){return a.rank-b.rank;});
  if(rows.length>=8){
    var dens=rows.filter(function(r,i,arr){return i===0||r.rank!==arr[i-1].rank;}).length;
    if(dens<rows.length*0.5) for(var i=0;i<rows.length;i++) rows[i].rank=i+1;
  }
  return rows;
}
function rowsToText(rows){
  var lines=["RK,PLAYER,POS,TEAM"];
  for(var i=0;i<rows.length;i++){var r=rows[i];lines.push([r.rank,r.name,r.pos||"",r.team||""].join(","));}
  return lines.join("\n");
}
function packChunks(rows){
  var MAX=3200,t=Date.now(),href=location.href,parts=[],i=0;
  while(i<rows.length){
    var take=Math.min(80,rows.length-i);
    while(take>6){
      var packed=JSON.stringify({v:2,s:SRC,t:t,h:href,i:parts.length,n:0,r:rows.slice(i,i+take).map(function(r){return [r.rank,r.name,r.pos||"",r.team||""];})});
      if(packed.length<=MAX) break;
      take=Math.ceil(take/2);
    }
    var use=Math.max(1,take);
    parts.push(rows.slice(i,i+use));i+=use;
  }
  var n=parts.length,chunks=[];
  for(var c=0;c<parts.length;c++) chunks.push(JSON.stringify({v:2,s:SRC,t:t,h:href,i:c,n:n,r:parts[c].map(function(r){return [r.rank,r.name,r.pos||"",r.team||""];})}));
  return chunks;
}
function postRelay(rows){
  if(!RELAY||!rows||!rows.length) return Promise.resolve(false);
  var chunks=packChunks(rows),i=0;
  function next(){
    if(i>=chunks.length) return Promise.resolve(true);
    return fetch(RELAY,{method:"POST",headers:{"Content-Type":"text/plain"},body:chunks[i++],mode:"cors",keepalive:true}).then(function(r){if(!r.ok) throw 0;return next();});
  }
  return next().then(function(){return true;},function(){return false;});
}
function postLocal(body){
  var ctrl=typeof AbortController==="function"?new AbortController():null;
  var t=setTimeout(function(){try{ctrl&&ctrl.abort();}catch(e){}},700);
  return fetch(O+"/api/ranks/ingest",{method:"POST",headers:{"Content-Type":"application/json"},body:body,mode:"cors",keepalive:true,signal:ctrl?ctrl.signal:undefined}).then(function(r){clearTimeout(t);if(!r.ok) throw 0;return r.json();}).catch(function(){clearTimeout(t);return null;});
}
function flush(){
  if(sending||!pending) return;
  var job=pending;pending=null;sending=true;
  var left=2,localJson=null,viaRelay=false;
  function done(){
    sending=false;
    if(localJson&&localJson.ok) badge((localJson.matched)||lastCount,"live");
    else if(viaRelay) badge(lastCount,"via relay");
    else badge(lastCount,"retry",true);
    flush();
  }
  function tick(){left-=1;if(left<=0) done();}
  postLocal(job.body).then(function(json){localJson=json;tick();});
  postRelay(job.rows).then(function(ok){viaRelay=!!ok;tick();});
}
function post(rows){
  if(!rows||rows.length<5){badge(rows?rows.length:0,"need visible ranks");return;}
  var sig=SRC+":"+rows.length+":"+rows[0].name+":"+rows[0].rank+":"+rows[Math.min(4,rows.length-1)].name+":"+rows[rows.length-1].name;
  if(sig===lastSig){badge(rows.length,"live");return;}
  lastSig=sig;
  pending={body:JSON.stringify({source:SRC,rows:rows,text:rowsToText(rows),href:location.href,title:document.title,ts:Date.now()}),rows:rows};
  badge(rows.length,"sending");
  flush();
}
function kick(){try{post(scrape());}catch(e){badge(0,"scrape error",true);}}
function hookNet(){
  if(window.__draftRoomRanksHooked) return;
  window.__draftRoomRanksHooked=1;
  function maybe(url,json){
    if(!json||typeof json!=="object") return;
    try{
      var map=new Map(),walk=function(node,d){
        if(!node||d>6) return;
        if(Array.isArray(node)){
          if(node.length>=5&&node.length<=500&&node[0]&&typeof node[0]==="object"&&(node[0].player_name||node[0].playerName||node[0].name)&&(node[0].rank!=null||node[0].ecr!=null||node[0].rk!=null)){
            for(var j=0;j<node.length;j++){var p=node[j];if(!p||typeof p!=="object") continue;addRow(map,Number(p.rank_ecr||p.ecr||p.overall_rank||p.rk||p.rank||(j+1)),p.player_name||p.playerName||p.name||"",p.position||p.pos||"",p.team||"");}
            return;
          }
          for(var k=0;k<node.length;k++) walk(node[k],d+1);
          return;
        }
        if(typeof node==="object"){if(node.players) walk(node.players,d+1);if(node.rankings) walk(node.rankings,d+1);if(node.data) walk(node.data,d+1);}
      };
      walk(json,0);
      var rows=Array.from(map.values());
      if(rows.length>=8) post(rows.sort(function(a,b){return a.rank-b.rank;}));
    }catch(e){}
  }
  var ofetch=window.fetch;
  if(typeof ofetch==="function") window.fetch=function(){
    var req=arguments[0],url=typeof req==="string"?req:(req&&req.url)||"",p=ofetch.apply(this,arguments);
    p.then(function(res){try{if(res&&res.ok){var ct=res.headers&&res.headers.get&&res.headers.get("content-type")||"";if(/json/i.test(ct)||/rank|ecr|player|draft/i.test(url)) res.clone().json().then(function(j){maybe(url,j);}).catch(function(){});}}catch(e){}return res;}).catch(function(){});
    return p;
  };
}
function watchDom(){
  if(window.__draftRoomRanksObs||!document.body) return;
  var t=null;
  var obs=new MutationObserver(function(){if(t) return;t=setTimeout(function(){t=null;kick();},1200);});
  try{obs.observe(document.body,{subtree:true,childList:true});window.__draftRoomRanksObs=obs;}catch(e){}
}
hookNet();
watchDom();
window.__draftRoomRanks={source:SRC,kick:kick};
kick();
setInterval(kick,POLL);
})();`;
}

export function buildRanksBookmarklet(
  origin: string,
  source: "fp" | "ds",
  relayUrl = RANKS_RELAY_URL,
): string {
  return `javascript:${ranksBookmarkletCode(origin, source, relayUrl).replace(/\n/g, "")}`;
}
