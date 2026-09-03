import { RANKS_RELAY_URL } from "./relay-urls";

export { RANKS_RELAY_URL };

/**
 * FantasyPros / DraftSharks live-ranks bookmarklet.
 * Runs on draftwizard.fantasypros.com, fantasypros.com, or draftsharks.com —
 * NOT on ESPN extension sidebars (those are isolated / cross-origin).
 * Always posts to ntfy (RANKS_RELAY_URL) so Cursor cloud / localhost-forward
 * Draft Room can receive ranks when direct POST to 127.0.0.1 fails.
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
var O=${O};
var SRC=${SRC};
var RELAY=${RELAY};
var POLL=6000;
var LABEL=SRC==="ds"?"Sync DS ranks":"Sync FP ranks";
var host=(location.hostname||"").toLowerCase();
var okHost=SRC==="ds"
  ? /draftsharks\.com$/.test(host)
  : /(^|\.)fantasypros\.com$/.test(host);
if(!okHost){
  alert(LABEL+" only works on " +(SRC==="ds"?"draftsharks.com (Draft War Room / rankings)":"fantasypros.com or draftwizard.fantasypros.com (Draft Assistant / cheat sheet)")+". Open that tab, then click the bookmark.");
  return;
}
if(window.__draftRoomRanks && window.__draftRoomRanks.source===SRC){
  try{window.__draftRoomRanks.kick();}catch(e){}
  return;
}
var lastSig="";
var sending=false;
var pending=null;
var lastCount=0;
function badge(n,msg){
  lastCount=n;
  var id="draft-room-ranks-badge-"+SRC;
  var el=document.getElementById(id);
  if(!el){
    el=document.createElement("div");
    el.id=id;
    el.setAttribute("style","position:fixed;z-index:2147483647;right:12px;bottom:"+(SRC==="ds"?"56px":"12px")+";background:#0f766e;color:#fff;font:600 12px/1.3 system-ui,sans-serif;padding:10px 14px;border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.28);max-width:min(360px,90vw);cursor:default");
    document.documentElement.appendChild(el);
  }
  el.textContent=LABEL+" · "+(n||0)+" ranks"+(msg?" · "+msg:"");
}
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
  var key=name.toLowerCase();
  var prev=map.get(key);
  if(prev && prev.rank<=rank) return;
  map.set(key,{rank:rank,name:name,pos:pos||undefined,team:team||undefined});
}
function fromAttrs(map){
  var nodes=document.querySelectorAll("[data-player-name]");
  for(var i=0;i<nodes.length;i++){
    var el=nodes[i];
    var name=el.getAttribute("data-player-name")||"";
    var pos=el.getAttribute("data-fantasy-position")||el.getAttribute("data-position")||"";
    var team=el.getAttribute("data-team")||el.getAttribute("data-nfl-team")||"";
    var rank=0;
    var ri=el.querySelector(".rank-index span, .rank-index, [class*='rank-index']");
    if(ri) rank=Number((ri.textContent||"").replace(/[^\d]/g,""));
    if(!rank){
      var row=el.closest("tr, [data-rank], [class*='player-row'], [class*='ranking']");
      if(row){
        var rAttr=row.getAttribute("data-rank")||row.getAttribute("data-overall-rank")||"";
        rank=Number(rAttr);
        if(!rank){
          var first=row.querySelector("td, [class*='rank']");
          if(first) rank=Number((first.textContent||"").trim().split(/\s+/)[0].replace(/[^\d]/g,""));
        }
      }
    }
    if(!rank) rank=i+1;
    addRow(map,rank,name,pos,team);
  }
}
function fromTables(map){
  var tables=document.querySelectorAll("table");
  for(var t=0;t<tables.length;t++){
    var rows=tables[t].querySelectorAll("tr");
    var order=0;
    for(var r=0;r<rows.length;r++){
      var cells=rows[r].querySelectorAll("th,td");
      if(cells.length<2) continue;
      var texts=[];
      for(var c=0;c<cells.length;c++) texts.push((cells[c].textContent||"").replace(/\s+/g," ").trim());
      if(/^(rk|rank|#|overall)$/i.test(texts[0])||/player/i.test(texts.join(" "))&&r===0) continue;
      var rank=Number(texts[0].replace(/[^\d.]/g,""));
      var name="",pos="",team="";
      for(var j=1;j<texts.length;j++){
        var cell=texts[j];
        if(!name && looksPlayer(cleanName(cell))){ name=cell; continue; }
        if(!pos && /^(QB|RB|WR|TE|K|DST|DEF)$/i.test(cell)){ pos=cell.toUpperCase(); continue; }
        if(!team && /^[A-Z]{2,3}$/.test(cell) && !/^(QB|RB|WR|TE|K)$/.test(cell)){ team=cell; continue; }
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
  var lines=root.split(/\n+/);
  var order=0;
  for(var i=0;i<lines.length;i++){
    var line=lines[i].replace(/\s+/g," ").trim();
    var m=line.match(/^(\d{1,3})[.)\s]+([A-Za-z][A-Za-z.'\-]+(?:\s+[A-Za-z][A-Za-z.'\-]+){0,3})(?:\s+(QB|RB|WR|TE|K|DST|DEF))?(?:\s+([A-Z]{2,3}))?/);
    if(!m) continue;
    order+=1;
    addRow(map,Number(m[1])||order,m[2],m[3],m[4]);
  }
}
function walkJson(node,map,depth){
  if(!node||depth>8) return;
  if(Array.isArray(node)){
    if(node.length>=5 && node.length<=500){
      var looks=0;
      for(var i=0;i<Math.min(node.length,12);i++){
        var it=node[i];
        if(it&&typeof it==="object"&&(it.player_name||it.playerName||it.name||it.player)&&(it.rank!=null||it.ecr!=null||it.overall_rank!=null||it.rank_ecr!=null||it.rk!=null||it.pos_rank!=null||it.value!=null||it.adp!=null)) looks++;
      }
      if(looks>=3){
        for(var j=0;j<node.length;j++){
          var p=node[j];
          if(!p||typeof p!=="object") continue;
          var name=p.player_name||p.playerName||p.name||(p.player&&(p.player.fullName||p.player.name))||"";
          var rank=Number(p.rank_ecr||p.ecr||p.overall_rank||p.overallRank||p.rk||p.rank||p.pos_rank||(j+1));
          var pos=p.position||p.pos||p.player_position_id||(p.player&&p.player.position)||"";
          var team=p.team||p.player_team_id||p.nfl_team||(p.player&&p.player.team)||"";
          addRow(map,rank,name,pos,team);
        }
        return;
      }
    }
    for(var k=0;k<node.length;k++) walkJson(node[k],map,depth+1);
    return;
  }
  if(typeof node==="object"){
    if(node.players) walkJson(node.players,map,depth+1);
    if(node.ecrData) walkJson(node.ecrData,map,depth+1);
    if(node.rankings) walkJson(node.rankings,map,depth+1);
    if(node.data) walkJson(node.data,map,depth+1);
    var keys=Object.keys(node);
    for(var x=0;x<keys.length && x<40;x++){
      var key=keys[x];
      if(/player|rank|ecr|board|sheet|list/i.test(key)) walkJson(node[key],map,depth+1);
    }
  }
}
function fromScripts(map){
  try{
    if(window.ecrData) walkJson(window.ecrData,map,0);
  }catch(e){}
  var scripts=document.querySelectorAll("script");
  for(var i=0;i<scripts.length;i++){
    var txt=scripts[i].textContent||"";
    if(txt.length<40||txt.length>2500000) continue;
    var m=txt.match(/ecrData\s*=\s*(\{[\s\S]*?\});/);
    if(m){
      try{walkJson(JSON.parse(m[1]),map,0);}catch(e){}
    }
    if(/"player_name"|"playerName"|"rank_ecr"|"overall_rank"/.test(txt) && /"players"\s*:/.test(txt)){
      var brace=txt.indexOf("{");
      if(brace>=0){
        try{walkJson(JSON.parse(txt.slice(brace)),map,0);}catch(e){}
      }
    }
  }
}
function scrape(){
  var map=new Map();
  fromAttrs(map);
  fromTables(map);
  fromScripts(map);
  if(map.size<8) fromText(map);
  var rows=Array.from(map.values()).sort(function(a,b){return a.rank-b.rank;});
  // Re-number by current visual order when ranks are sparse / remaining-only boards
  if(rows.length>=8){
    var dens=rows.filter(function(r,i,arr){return i===0||r.rank!==arr[i-1].rank;}).length;
    if(dens<rows.length*0.5){
      for(var i=0;i<rows.length;i++) rows[i].rank=i+1;
    }
  }
  return rows;
}
function rowsToText(rows){
  var lines=["RK,PLAYER,POS,TEAM"];
  for(var i=0;i<rows.length;i++){
    var r=rows[i];
    lines.push([r.rank,r.name,r.pos||"",r.team||""].join(","));
  }
  return lines.join("\n");
}
function packChunks(rows){
  var MAX=3200, t=Date.now(), href=location.href, parts=[], i=0;
  while(i<rows.length){
    var take=Math.min(80, rows.length-i);
    while(take>6){
      var slice=rows.slice(i,i+take);
      var packed=JSON.stringify({v:2,s:SRC,t:t,h:href,i:parts.length,n:0,r:slice.map(function(r){return [r.rank,r.name,r.pos||"",r.team||""];})});
      if(packed.length<=MAX) break;
      take=Math.ceil(take/2);
    }
    var use=Math.max(1,take);
    parts.push(rows.slice(i,i+use));
    i+=use;
  }
  var n=parts.length, chunks=[];
  for(var c=0;c<parts.length;c++){
    chunks.push(JSON.stringify({v:2,s:SRC,t:t,h:href,i:c,n:n,r:parts[c].map(function(r){return [r.rank,r.name,r.pos||"",r.team||""];})}));
  }
  return chunks;
}
function postRelay(rows){
  if(!RELAY||!rows||!rows.length) return Promise.resolve(false);
  var chunks=packChunks(rows);
  var i=0;
  function next(){
    if(i>=chunks.length) return Promise.resolve(true);
    var body=chunks[i++];
    return fetch(RELAY,{method:"POST",headers:{"Content-Type":"text/plain"},body:body,mode:"cors",keepalive:true}).then(function(r){
      if(!r.ok) throw new Error("ntfy "+r.status);
      return next();
    });
  }
  return next().then(function(){return true;},function(){return false;});
}
function flush(){
  if(sending||!pending) return;
  var job=pending;
  pending=null;
  sending=true;
  var local=fetch(O+"/api/ranks/ingest",{method:"POST",headers:{"Content-Type":"application/json"},body:job.body,mode:"cors",keepalive:true}).then(function(r){
    if(!r.ok) throw new Error("HTTP "+r.status);
    return r.json();
  });
  var relay=postRelay(job.rows);
  function done(localJson, viaRelay){
    sending=false;
    if(localJson && localJson.ok){
      badge((localJson.matched)||lastCount, "live");
    } else if(viaRelay){
      badge(lastCount, "via relay");
    } else {
      badge(lastCount, "retry");
    }
    flush();
  }
  var localJson=null, viaRelay=false, left=2;
  function tick(){
    left-=1;
    if(left<=0) done(localJson, viaRelay);
  }
  local.then(function(json){ localJson=json; tick(); }, function(){ tick(); });
  relay.then(function(ok){ viaRelay=!!ok; tick(); }, function(){ tick(); });
}
function post(rows){
  if(!rows||rows.length<5){
    badge(rows?rows.length:0,"need visible ranks");
    return;
  }
  var sig=SRC+":"+rows.length+":"+rows[0].name+":"+rows[0].rank+":"+rows[Math.min(4,rows.length-1)].name+":"+rows[rows.length-1].name;
  if(sig===lastSig){ badge(rows.length,"live"); return; }
  lastSig=sig;
  var payload=JSON.stringify({source:SRC,rows:rows,text:rowsToText(rows),href:location.href,title:document.title,ts:Date.now()});
  pending={body:payload,rows:rows};
  badge(rows.length,"sending");
  flush();
}
function kick(){
  try{ post(scrape()); }catch(e){ badge(0,"scrape error"); }
}
function hookNet(){
  if(window.__draftRoomRanksHooked) return;
  window.__draftRoomRanksHooked=1;
  function maybe(url,json){
    url=String(url||"");
    if(!/rank|ecr|player|draft|cheat|war|board|assistant|sheet/i.test(url) && !(json&&typeof json==="object")) return;
    try{
      var map=new Map();
      walkJson(json,map,0);
      var rows=Array.from(map.values());
      if(rows.length>=8) post(rows.sort(function(a,b){return a.rank-b.rank;}));
    }catch(e){}
  }
  var ofetch=window.fetch;
  if(typeof ofetch==="function"){
    window.fetch=function(){
      var req=arguments[0];
      var url=typeof req==="string"?req:(req&&req.url)||"";
      var p=ofetch.apply(this,arguments);
      p.then(function(res){
        try{
          if(res&&res.ok){
            var ct=res.headers&&res.headers.get&&res.headers.get("content-type")||"";
            if(/json/i.test(ct)||/rank|ecr|player|draft/i.test(url)){
              res.clone().json().then(function(j){maybe(url,j);}).catch(function(){});
            }
          }
        }catch(e){}
        return res;
      }).catch(function(){});
      return p;
    };
  }
  var XO=XMLHttpRequest.prototype.open, XS=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(m,u){this.__drUrl=u;return XO.apply(this,arguments);};
  XMLHttpRequest.prototype.send=function(){
    var xhr=this;
    xhr.addEventListener("load",function(){
      try{
        if(xhr.status>=200&&xhr.status<300&&xhr.responseText&&xhr.responseText.length<2500000){
          maybe(xhr.__drUrl,JSON.parse(xhr.responseText));
        }
      }catch(e){}
    });
    return XS.apply(this,arguments);
  };
}
function watchDom(){
  if(window.__draftRoomRanksObs||!document.body) return;
  var t=null;
  var obs=new MutationObserver(function(){
    if(t) return;
    t=setTimeout(function(){ t=null; kick(); },1200);
  });
  try{ obs.observe(document.body,{subtree:true,childList:true}); window.__draftRoomRanksObs=obs; }catch(e){}
}
hookNet();
watchDom();
kick();
setInterval(kick,POLL);
window.__draftRoomRanks={source:SRC,kick:kick};
badge(0,"watching");
})();`;
}

export function buildRanksBookmarklet(
  origin: string,
  source: "fp" | "ds",
  relayUrl = RANKS_RELAY_URL,
): string {
  return `javascript:${ranksBookmarkletCode(origin, source, relayUrl).replace(/\n/g, "")}`;
}
