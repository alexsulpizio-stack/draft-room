/** ESPN draft bookmarklet source. String.raw so `\s` / `\d` survive into javascript: URLs. */
export function espnBookmarkletCode(origin: string, relayUrl: string): string {
  const O = JSON.stringify(origin.replace(/\/$/, ""));
  const RELAY = JSON.stringify(relayUrl);
  return String.raw`(function(){
var O=${O};
var RELAY=${RELAY};
var POLL=5000;
var API="https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";
var host=(location.hostname||"").toLowerCase();
if(!(host==="espn.com"||/\.espn\.com$/.test(host))){
  alert("Sync ESPN only works on fantasy.espn.com (live draft / practice / mock). You are on "+(host||"this page")+". For FantasyPros or DraftSharks ranks, use Sync FP ranks / Sync DS ranks instead.");
  return;
}
function takeSize(n){n=Number(n);return (n>=2&&n<=20)?n:0;}
function urlMeta(){
  var meta={leagueId:"",season:0,teamId:0,teams:0,leagueName:"",draftType:"snake",teamNames:null,pickOrder:null,slot:0,draftId:""};
  try{
    var href=String(location.href||"");
    var sp=new URLSearchParams(location.search);
    meta.leagueId=sp.get("leagueId")||"";
    if(!meta.leagueId){
      var lm=href.match(/[?&#/](?:leagueId=|leagues\/|league\/)(-?\d+)/i);
      if(lm) meta.leagueId=lm[1];
    }
    meta.season=Number(sp.get("seasonId")||0)||0;
    if(!meta.season){
      var sm=href.match(/seasonId=(\d{4})/i);
      if(sm) meta.season=Number(sm[1]);
    }
    meta.teamId=Number(sp.get("teamId")||0)||0;
    meta.draftId=sp.get("draftId")||sp.get("draftChannelId")||sp.get("mockDraftId")||"";
  }catch(e){}
  return meta;
}
function teamName(t,i){
  if(!t||typeof t!=="object") return "Team "+(i+1);
  return ((t.location||"")+" "+(t.nickname||"")).trim()||t.name||t.abbrev||("Team "+(i+1));
}
function applyLeague(json,meta){
  if(!json||typeof json!=="object") return meta;
  var s=json.settings||{};
  var size=takeSize(s.size);
  if(size) meta.teams=size;
  if(typeof s.name==="string"&&s.name.length>1) meta.leagueName=s.name;
  var ds=s.draftSettings||{};
  var ot=String(ds.orderType||ds.type||"");
  if(/LINEAR/i.test(ot)&&!/SNAKE/i.test(ot)) meta.draftType="linear";
  else meta.draftType=meta.draftType||"snake";
  var teams=Array.isArray(json.teams)?json.teams:[];
  var order=(ds.pickOrder&&ds.pickOrder.length)?ds.pickOrder:teams.map(function(t){return t.id;});
  if(order&&order.length>=2){
    meta.pickOrder=order.map(function(id){return Number(id);}).filter(function(n){return n>0;});
  }
  if(teams.length>=2&&teams.length<=20){
    if(!meta.teams) meta.teams=teams.length;
    var byId={};
    teams.forEach(function(t){if(t&&t.id!=null) byId[t.id]=t;});
    meta.teamNames=(meta.pickOrder&&meta.pickOrder.length?meta.pickOrder:order).map(function(id,i){return teamName(byId[id],i);});
  }
  if(meta.teamId&&meta.pickOrder&&meta.pickOrder.length){
    var ix=meta.pickOrder.indexOf(meta.teamId);
    if(ix<0) ix=meta.pickOrder.indexOf(Number(meta.teamId));
    if(ix>=0) meta.slot=ix+1;
  }
  if(!meta.teams) meta.teams=12;
  return meta;
}
function unwrap(json){
  if(Array.isArray(json)){
    for(var i=0;i<json.length;i++) if(json[i]&&typeof json[i]==="object") return json[i];
    return null;
  }
  if(json&&json.data&&typeof json.data==="object"&&(json.data.draftDetail||json.data.teams||json.data.picks||json.data.settings)) return json.data;
  return json;
}
function pid(p){
  var n=Number(p.playerId||0); if(n>0) return n;
  if(p.player&&typeof p.player==="object"){ n=Number(p.player.id||0); if(n>0) return n; }
  var ppe=p.playerPoolEntry;
  if(ppe&&typeof ppe==="object"){
    n=Number(ppe.playerId||0); if(n>0) return n;
    if(ppe.player&&typeof ppe.player==="object"){ n=Number(ppe.player.id||0); if(n>0) return n; }
  }
  if(p.athlete&&typeof p.athlete==="object"){ n=Number(p.athlete.id||0); if(n>0) return n; }
  n=Number(p.athleteId||p.espnPlayerId||p.entityId||0); if(n>0) return n;
  return 0;
}
function nameMap(json){
  var m={};
  function add(list){
    if(!Array.isArray(list)) return;
    for(var i=0;i<list.length;i++){
      var e=list[i]; if(!e||typeof e!=="object") continue;
      var pl=e.player||(e.playerPoolEntry&&e.playerPoolEntry.player)||e;
      var id=Number(e.id||e.playerId||(pl&&pl.id)||0);
      var nm=e.fullName||e.playerName||(pl&&(pl.fullName||pl.name))||"";
      if(id>0&&nm&&!/^ESPN\s+-?\d+$/i.test(nm)) m[id]=nm;
    }
  }
  add(json.players);
  if(Array.isArray(json.teams)){
    for(var t=0;t<json.teams.length;t++){
      var roster=json.teams[t]&&json.teams[t].roster;
      add(roster&&roster.entries);
    }
  }
  return m;
}
function pname(p,names){
  var n="",pl=p.player||p.athlete||p.entity||p.member;
  if(!pl&&p.playerPoolEntry&&typeof p.playerPoolEntry==="object") pl=p.playerPoolEntry.player;
  if(pl&&typeof pl==="object") n=pl.fullName||pl.name||pl.displayName||((pl.firstName||"")+" "+(pl.lastName||"")).trim();
  n=p.playerName||p.fullName||p.displayName||n||"";
  n=String(n).replace(/\s+/g," ").trim();
  if(/^ESPN\s+-?\d+$/i.test(n)) n="";
  var id=pid(p);
  if(!n&&id&&names&&names[id]) n=names[id];
  return n;
}
function takePicks(json){
  json=unwrap(json); if(!json) return [];
  var names=nameMap(json);
  var raw=(json.draftDetail&&json.draftDetail.picks)||json.picks||(json.draft&&json.draft.picks)||(json.draftBoard&&json.draftBoard.picks)||[];
  if(!Array.isArray(raw)||!raw.length){
    var bag=[],seen={};
    function walk(node,depth){
      if(!node||depth>6||bag.length>250) return;
      if(Array.isArray(node)){ for(var i=0;i<node.length;i++) walk(node[i],depth+1); return; }
      if(typeof node!=="object") return;
      if(node.overallPickNumber&&(node.playerId||node.player||node.athleteId||node.playerName||node.fullName)){
        var k=String(node.overallPickNumber)+":"+(node.playerId||node.playerName||"");
        if(!seen[k]){ seen[k]=1; bag.push(node); }
      }
      var ks=["draftDetail","draft","picks","draftPicks","draftBoard","selection","pickHistory"];
      for(var j=0;j<ks.length;j++) if(node[ks[j]]) walk(node[ks[j]],depth+1);
    }
    walk(json,0);
    if(bag.length) raw=bag;
  }
  var out=[],i,p,overall,playerId,name,team;
  if(Array.isArray(raw)){
    for(i=0;i<raw.length;i++){
      p=raw[i]; if(!p||typeof p!=="object") continue;
      overall=Number(p.overallPickNumber||p.overall||p.pickNumber||0);
      playerId=pid(p);
      name=pname(p,names);
      if(!overall||(!playerId&&!name)) continue;
      team=p.team&&typeof p.team==="object"?p.team.id:p.teamId;
      out.push({overallPickNumber:overall,playerId:playerId,teamId:Number(team||0),playerName:name});
    }
  }
  if(out.length){ out.sort(function(a,b){return a.overallPickNumber-b.overallPickNumber;}); return out; }
  if(Array.isArray(json.teams)){
    for(i=0;i<json.teams.length;i++){
      team=json.teams[i]; if(!team) continue;
      var entries=team.roster&&team.roster.entries; if(!Array.isArray(entries)) continue;
      for(var j=0;j<entries.length;j++){
        p=entries[j]; if(!p||typeof p!=="object") continue;
        var ppe=p.playerPoolEntry||p;
        playerId=pid({playerId:p.playerId||ppe.playerId,player:ppe.player||p.player,athleteId:ppe.athleteId});
        name=pname({player:ppe.player||p.player,playerName:p.playerName,playerId:playerId},names);
        if(!playerId&&!name) continue;
        out.push({overallPickNumber:out.length+1,playerId:playerId,teamId:Number(team.id||0),playerName:name});
      }
    }
  }
  if(!out.length&&Array.isArray(json.players)){
    for(i=0;i<json.players.length;i++){
      p=json.players[i]; if(!p||typeof p!=="object") continue;
      var on=Number(p.onTeamId||0); if(!(on>0)) continue;
      playerId=pid(p);
      name=pname(p,names);
      if(!playerId&&!name) continue;
      out.push({overallPickNumber:out.length+1,playerId:playerId,teamId:on,playerName:name});
    }
  }
  return out;
}
function pushPick(out,seen,overall,playerId,teamId,name){
  playerId=Number(playerId||0); if(!(playerId>0)) playerId=0;
  name=cleanName(name);
  if(!playerId&&!name) return;
  var key=playerId?("id:"+playerId):("n:"+name.toLowerCase());
  if(seen[key]) return;
  seen[key]=1;
  out.push({overallPickNumber:Number(overall)||out.length+1,playerId:playerId,teamId:Number(teamId||0),playerName:name});
}
function cleanName(s){
  s=String(s||"").replace(/\s+/g," ").trim();
  s=s.replace(/^\d+\.\d{1,2}\s+/,"");
  s=s.replace(/,?\s*(QB|RB|WR|TE|K|DST|D\/ST|DEF|D)\b.*$/i,"");
  s=s.replace(/,?\s*[A-Z]{2,3}\s*$/,"");
  s=s.replace(/\s*\(.*\)\s*$/,"");
  s=s.replace(/\s*[—–-]\s*.*$/,"").trim();
  var comma=s.indexOf(",");
  if(comma>0){
    var last=s.slice(0,comma).trim(), first=s.slice(comma+1).trim();
    if(last&&first&&last.length<18) s=first+" "+last;
  }
  if(/^ESPN\s+-?\d+$/i.test(s)) return "";
  if(s.length<3||s.length>42) return "";
  if(/^(pick|round|team|draft|start|bench|overall|player|clock)$/i.test(s)) return "";
  return s;
}
function considerPickArr(arr,out,seen){
  if(!Array.isArray(arr)||arr.length<1||arr.length>400) return;
  var sample=arr[0];
  if(!sample||typeof sample!=="object") return;
  if(!("overallPickNumber" in sample)&&!("overall" in sample)&&!("pickNumber" in sample)&&!("playerId" in sample)&&!("player" in sample)&&!("playerName" in sample)&&!("fullName" in sample)) return;
  var hits=0,i,p;
  for(i=0;i<Math.min(arr.length,300);i++){
    p=arr[i]; if(!p||typeof p!=="object") continue;
    if((Number(p.overallPickNumber||p.overall||p.pickNumber||0)>0)&&(pid(p)>0||pname(p,{}))) hits++;
  }
  if(hits<1) return;
  for(i=0;i<Math.min(arr.length,300);i++){
    p=arr[i]; if(!p||typeof p!=="object") continue;
    var overall=Number(p.overallPickNumber||p.overall||p.pickNumber||0);
    var playerId=pid(p);
    var name=pname(p,{});
    if(!overall||(!playerId&&!name)) continue;
    var team=p.team&&typeof p.team==="object"?p.team.id:p.teamId;
    pushPick(out,seen,overall,playerId,team,name);
  }
}
function scanFiberEl(el,consider,start){
  if(!el) return;
  var keys=Object.keys(el);
  for(var i=0;i<keys.length;i++){
    if(keys[i].indexOf("__reactFiber")===0||keys[i].indexOf("__reactInternalInstance")===0){
      walkFiber(el[keys[i]],0,consider,start);
    }
  }
}
function walkFiber(fiber,depth,consider,start){
  if(!fiber||depth>55||Date.now()-start>90) return;
  try{
    var props=fiber.memoizedProps||fiber.pendingProps;
    if(props&&typeof props==="object"){
      if(props.picks) consider(props.picks);
      if(props.draftPicks) consider(props.draftPicks);
      if(props.selections) consider(props.selections);
      if(props.pickHistory) consider(props.pickHistory);
      if(props.draftDetail&&props.draftDetail.picks) consider(props.draftDetail.picks);
      if(props.draft&&props.draft.picks) consider(props.draft.picks);
      if(props.value&&typeof props.value==="object"){
        if(props.value.picks) consider(props.value.picks);
        if(props.value.draftDetail&&props.value.draftDetail.picks) consider(props.value.draftDetail.picks);
      }
      for(var k in props){
        if(k==="children"||k==="ref") continue;
        var v=props[k];
        if(Array.isArray(v)) consider(v);
        else if(v&&typeof v==="object"&&v.picks) consider(v.picks);
      }
    }
    var state=fiber.memoizedState, guard=0;
    while(state&&guard++<40){
      var ms=state.memoizedState;
      if(Array.isArray(ms)) consider(ms);
      else if(ms&&typeof ms==="object"){
        if(ms.picks) consider(ms.picks);
        if(ms.draftDetail&&ms.draftDetail.picks) consider(ms.draftDetail.picks);
        if(ms.draft&&ms.draft.picks) consider(ms.draft.picks);
      }
      state=state.next;
    }
  }catch(e){}
  walkFiber(fiber.child,depth+1,consider,start);
  walkFiber(fiber.sibling,depth+1,consider,start);
}
function takeReactPicks(){
  var best=[], start=Date.now();
  function consider(arr){
    var tmp=[], seen={};
    considerPickArr(arr,tmp,seen);
    if(tmp.length>best.length) best=tmp;
  }
  var roots=[document.getElementById("espn-root"),document.getElementById("root"),document.querySelector("#arena-root"),document.querySelector("[data-reactroot]"),document.body];
  for(var r=0;r<roots.length;r++) scanFiberEl(roots[r],consider,start);
  var extra=document.querySelectorAll('[class*="pick"],[class*="Pick"],[class*="draft"],[class*="Draft"],[class*="history"],main,aside,section');
  for(var e=0;e<extra.length&&Date.now()-start<90;e++) scanFiberEl(extra[e],consider,start);
  if(best.length) best.sort(function(a,b){return a.overallPickNumber-b.overallPickNumber;});
  return best;
}
function takeGlobalPicks(){
  var out=[], seen={}, start=Date.now();
  function walk(node,depth){
    if(!node||depth>6||Date.now()-start>40||out.length>80) return;
    if(Array.isArray(node)){ considerPickArr(node,out,seen); return; }
    if(typeof node!=="object") return;
    for(var k in node){
      if(k==="players"||k==="playerPool"||k==="children"||k==="ref") continue;
      try{
        if(/pick|draft|select|roster/i.test(k)||depth<2) walk(node[k],depth+1);
      }catch(e){}
    }
  }
  try{ walk(window.__NEXT_DATA__,0); }catch(e){}
  try{ if(window.espn) walk(window.espn,0); }catch(e){}
  try{ if(window.__PRELOADED_STATE__) walk(window.__PRELOADED_STATE__,0); }catch(e){}
  return out;
}
function takeBoardPicks(){
  var out=[], seen={}, teams=(lastMeta&&lastMeta.teams)||12, start=Date.now();
  var nodes=document.querySelectorAll("div,li,td,article,span,p,button");
  for(var i=0;i<nodes.length&&out.length<120&&Date.now()-start<70;i++){
    var el=nodes[i];
    if(el.childElementCount>8) continue;
    var t=(el.innerText||"").replace(/\s+/g," ").trim();
    if(t.length<5||t.length>140) continue;
    var m=t.match(/^(\d{1,2})\.(\d{1,2})\b/);
    if(!m) continue;
    var slot=Number(m[2]); if(slot<1||slot>Math.max(teams,16)) continue;
    var name=cleanName(t.slice(m[0].length));
    if(!name&&el.nextElementSibling) name=cleanName((el.nextElementSibling.innerText||"").replace(/\s+/g," "));
    if(!name&&el.parentElement&&el.parentElement.childElementCount<=8) name=cleanName((el.parentElement.innerText||"").replace(m[0]," "));
    if(name) pushPick(out,seen,(Number(m[1])-1)*teams+slot,0,0,name);
  }
  return out;
}
function takeDomPicks(){
  var out=[], seen={}, i, a, href, id, name, m, el, attr, root;
  var roots=document.querySelectorAll('[class*="pick-history"],[class*="PickHistory"],[class*="pickHistory"],[class*="draft-board"],[class*="draftBoard"],[class*="completed"],[class*="recap"],[class*="history"],aside,[role="complementary"]');
  if(!roots.length) return out;
  for(var r=0;r<roots.length&&out.length<80;r++){
    root=roots[r];
    var links=root.querySelectorAll('a[href*="/player/_/id/"],a[href*="playerId="],a[href*="playerid="]');
    for(i=0;i<links.length&&out.length<80;i++){
      a=links[i];
      href=a.getAttribute("href")||"";
      m=href.match(/\/player\/_\/id\/(\d+)/)||href.match(/[?&#]playerId=(\d+)/i);
      id=m?Number(m[1]):0;
      name=cleanName(a.textContent||"");
      pushPick(out,seen,out.length+1,id,0,name);
    }
    var nodes=root.querySelectorAll("[data-player-id],[data-playerid],[data-entity-id]");
    for(i=0;i<nodes.length&&out.length<80;i++){
      el=nodes[i];
      attr=el.getAttribute("data-player-id")||el.getAttribute("data-playerid")||el.getAttribute("data-entity-id")||"";
      id=Number(attr)||0;
      if(!(id>1000)) continue;
      name=cleanName(el.getAttribute("aria-label")||el.textContent||"");
      pushPick(out,seen,out.length+1,id,0,name);
    }
  }
  return out;
}
function parsePickText(text){
  text=String(text||"").replace(/\r/g,"\n");
  if(text.length<8) return [];
  var out=[], seen={}, teams=(lastMeta&&lastMeta.teams)||12, m, re, i;
  re=/(\d{1,2})\.(\d{1,2})\b/g;
  var hits=[];
  while((m=re.exec(text))) hits.push({i:m.index,len:m[0].length,r:Number(m[1]),s:Number(m[2])});
  for(i=0;i<hits.length;i++){
    if(hits[i].r<1||hits[i].s<1||hits[i].s>Math.max(teams,16)) continue;
    var start=hits[i].i+hits[i].len;
    var end=i+1<hits.length?hits[i+1].i:Math.min(text.length,start+90);
    var name=cleanName(text.slice(start,end).replace(/[\n\t]+/g," "));
    if(name) pushPick(out,seen,(hits[i].r-1)*teams+hits[i].s,0,0,name);
  }
  if(out.length) return out;
  re=/\b(?:Pick\s*)?(\d{1,3})[\.:)\-]\s+([A-Za-z][A-Za-z.'’\-]+(?:\s+[A-Za-z.'’\-]+){0,3})/g;
  while((m=re.exec(text))&&out.length<80){
    var nm=cleanName(m[2]);
    if(nm) pushPick(out,seen,Number(m[1]),0,0,nm);
  }
  return out;
}
function collectPickText(){
  var chunks=[], i, el;
  var nodes=document.querySelectorAll('[class*="pick"],[class*="Pick"],[class*="history"],[class*="History"],[class*="draftLog"],[class*="DraftLog"],[data-testid*="pick"],aside,[role="complementary"],main');
  for(i=0;i<nodes.length&&chunks.length<40;i++){
    el=nodes[i];
    var t=(el.innerText||el.textContent||"").replace(/\s+/g," ").trim();
    if(t.length>=8&&t.length<4000) chunks.push(t);
  }
  var text=chunks.join("\n");
  if(text.length<20){
    try{ text=(document.body.innerText||"").slice(0,20000); }catch(e){}
  }
  return text;
}
function takeTextPicks(){
  return parsePickText(collectPickText());
}
function mergePickLists(base,extra){
  if(!extra||!extra.length) return base||[];
  if(!base||!base.length) return extra;
  var by={},i,p,out=[];
  for(i=0;i<base.length;i++){
    p=base[i]; if(!p||!(p.overallPickNumber>0)) continue;
    by[p.overallPickNumber]=p;
  }
  for(i=0;i<extra.length;i++){
    p=extra[i]; if(!p||!(p.overallPickNumber>0)) continue;
    var prev=by[p.overallPickNumber];
    if(!prev){ by[p.overallPickNumber]=p; continue; }
    // Prefer a real name; prefer a positive id only when names agree or prev had none.
    var name=prev.playerName||p.playerName||"";
    var id=prev.playerId||0;
    if(!(id>0)&&p.playerId>0) id=p.playerId;
    if(p.playerName&&(!prev.playerName||prev.playerName.length<p.playerName.length)) name=p.playerName;
    by[p.overallPickNumber]={
      overallPickNumber:p.overallPickNumber,
      playerId:id,
      teamId:prev.teamId||p.teamId||0,
      playerName:name
    };
  }
  for(i in by) if(Object.prototype.hasOwnProperty.call(by,i)) out.push(by[i]);
  out.sort(function(a,b){return a.overallPickNumber-b.overallPickNumber;});
  return out;
}
function takeAllPicks(json){
  // Never stop at a thin JSON list — practice drafts often return a few id slots while
  // the board/DOM already shows more names. Merge every source by overall pick.
  var got=json?takePicks(json):[];
  got=mergePickLists(got,takeReactPicks());
  got=mergePickLists(got,takeGlobalPicks());
  got=mergePickLists(got,takeBoardPicks());
  got=mergePickLists(got,takeTextPicks());
  got=mergePickLists(got,takeDomPicks());
  return got;
}
function scrapeThenPost(meta,err){
  var scraped=takeAllPicks(null);
  if(scraped.length){ post(scraped,meta); return; }
  var finish=function(extra){
    if(extra&&extra.length){ post(extra,meta); return; }
    post([],meta,err);
  };
  try{
    if(navigator.clipboard&&typeof navigator.clipboard.readText==="function"){
      var to=setTimeout(function(){ finish([]); },500);
      navigator.clipboard.readText().then(function(text){
        clearTimeout(to);
        finish(parsePickText(text));
      }).catch(function(){ clearTimeout(to); finish([]); });
      return;
    }
  }catch(e){}
  finish([]);
}
function isLeaguePayload(json){
  json=unwrap(json);
  return !!(json&&typeof json==="object"&&(json.draftDetail||json.draft||(json.settings&&json.teams)||(Array.isArray(json.picks)&&json.picks[0]&&(json.picks[0].overallPickNumber||json.picks[0].player||json.picks[0].playerId||json.picks[0].playerName))));
}
function emptyWhy(meta,err){
  if(err) return String(err);
  if(!meta||!meta.leagueId) return "no leagueId in this URL";
  return "0 filled slots";
}
function badge(n,meta,err){
  var b=document.getElementById("draft-room-sync");
  if(!b){
    b=document.createElement("div");
    b.id="draft-room-sync";
    b.style.cssText="position:fixed;bottom:16px;left:16px;z-index:2147483647;background:#1f6a45;color:#fff;padding:10px 14px;border-radius:12px;font:13px/1.35 system-ui,sans-serif;box-shadow:0 8px 24px #0005;max-width:360px";
    document.body.appendChild(b);
  }
  var why=err?String(err):"";
  var label=(meta&&meta.leagueName)?meta.leagueName:(meta&&meta.leagueId)?("League "+meta.leagueId):"this ESPN draft";
  var clock=new Date().toLocaleTimeString();
  var waiting=!n&&!!(meta&&(meta.leagueName||meta.leagueId));
  b.style.background=n||waiting?"#1f6a45":"#9b1c1c";
  if(n){
    b.textContent="Draft Room is syncing "+n+" picks from "+label+" · "+clock;
    return;
  }
  if(waiting){
    b.textContent="Draft Room connected to "+label+" · 0 picks · if ESPN shows names, copy pick history and paste in Draft Room step 3 · "+clock;
    return;
  }
  b.textContent="Draft Room · 0 picks — "+(why||emptyWhy(meta))+" · "+clock;
}
function idle(fn){
  if(typeof requestIdleCallback==="function") requestIdleCallback(function(){fn();},{timeout:1500});
  else setTimeout(fn,0);
}
var sending=false,lastSig="",lastMeta=urlMeta(),pending=null,lastBeat=0;
function flushPending(){
  if(!pending) return;
  var n=pending; pending=null;
  post(n.picks,n.meta);
}
function pack(picks,meta){
  var rows=[],i,p;
  for(i=0;i<(picks||[]).length;i++){
    p=picks[i];
    rows.push([p.overallPickNumber,p.playerId||0,p.teamId||0,p.playerName||""]);
  }
  var packed=JSON.stringify({v:1,p:rows,m:meta||{},h:location.href,t:Date.now()});
  while(rows.length>6&&packed.length>3500){
    rows=rows.slice(Math.ceil(rows.length/5));
    packed=JSON.stringify({v:1,p:rows,m:meta||{},h:location.href,t:Date.now()});
  }
  return packed;
}
function postRelay(picks,meta){
  if(!RELAY) return;
  try{fetch(RELAY,{method:"POST",headers:{"Content-Type":"text/plain"},body:pack(picks||[],meta),mode:"cors",keepalive:true}).catch(function(){});}catch(e){}
}
function post(picks,meta,err){
  lastMeta=meta;
  if(!picks||!picks.length){
    var pageText=collectPickText();
    var parsed=parsePickText(pageText);
    if(parsed.length){ post(parsed,meta); return; }
    var why=emptyWhy(meta,err);
    var hmeta={};
    for(var k in (meta||{})) hmeta[k]=meta[k];
    hmeta.reason=why;
    badge(0,hmeta,why);
    var hsig="0:"+why+":"+(meta&&meta.leagueId||"");
    var now=Date.now();
    if(hsig===lastSig&&now-lastBeat<25000){ badge(0,hmeta,why); return; }
    lastSig=hsig;
    lastBeat=now;
    postRelay([],hmeta);
    fetch(O+"/api/espn/ingest",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({picks:[],text:pageText,href:location.href,title:document.title,ts:Date.now(),meta:hmeta}),mode:"cors",keepalive:true}).catch(function(){});
    return;
  }
  var sig=picks.length+":"+picks[picks.length-1].overallPickNumber+":"+picks[picks.length-1].playerId+":"+(picks[picks.length-1].playerName||"")+":"+(meta.teams||"")+":"+(meta.leagueId||"");
  if(sig===lastSig){
    badge(picks.length,meta);
    var nowKeep=Date.now();
    // Soft heartbeat so listen does not go stale between picks.
    if(nowKeep-lastBeat<20000) return;
    lastBeat=nowKeep;
    postRelay(picks,meta);
    try{
      fetch(O+"/api/espn/ingest",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({picks:picks,href:location.href,title:document.title,ts:Date.now(),meta:meta}),mode:"cors",keepalive:true}).catch(function(){});
    }catch(e){}
    return;
  }
  postRelay(picks,meta);
  if(sending){ pending={picks:picks,meta:meta}; return; }
  sending=true;
  lastSig=sig;
  var body=JSON.stringify({picks:picks,href:location.href,title:document.title,ts:Date.now(),meta:meta});
  fetch(O+"/api/espn/ingest",{method:"POST",headers:{"Content-Type":"application/json"},body:body,mode:"cors",keepalive:true}).then(function(r){
    sending=false;
    if(!r.ok) throw new Error("HTTP "+r.status);
    badge(picks.length,meta);
    flushPending();
  }).catch(function(e){
    sending=false;
    badge(picks.length,meta);
    flushPending();
  });
}
function ingestJson(json){
  json=unwrap(json);
  if(!json||typeof json!=="object") return;
  if(json.draftPick&&typeof json.draftPick==="object") json={picks:[json.draftPick]};
  if(json.pick&&typeof json.pick==="object"&&!json.picks) json={picks:[json.pick]};
  var got=takeAllPicks(json);
  if(!got.length&&!isLeaguePayload(json)) return;
  var meta=applyLeague(json,lastMeta||urlMeta());
  post(got,meta);
}
function draftUrl(u){
  u=String(u||"");
  if(/\/players\?|view=players_wl/i.test(u)) return false;
  return /mDraftDetail|mDraft(?:[^A-Za-z]|$)|draftDetail|draftRecap|draftStatus|mRoster|\/leagues\/-?\d+|leagueHistory|\/drafts\/\d+|gambit-api|livedraft|recentActivity/i.test(u);
}
function hookWs(){
  var WS=window.WebSocket;
  if(typeof WS!=="function"||WS.__draftRoomEspn) return;
  function Wrapped(url,proto){
    var ws=proto!==undefined?new WS(url,proto):new WS(url);
    try{
      ws.addEventListener("message",function(ev){
        idle(function(){
          try{
            var raw=ev&&ev.data;
            if(typeof raw!=="string"||raw.length>2000000) return;
            var json=JSON.parse(raw);
            ingestJson(json);
          }catch(e){}
        });
      });
    }catch(e){}
    return ws;
  }
  Wrapped.prototype=WS.prototype;
  Wrapped.__draftRoomEspn=1;
  window.WebSocket=Wrapped;
}
function hookNet(){
  if(window.__draftRoomEspnHooked) return;
  window.__draftRoomEspnHooked=1;
  hookWs();
  var ofetch=window.fetch;
  if(typeof ofetch==="function"){
    window.fetch=function(){
      var req=arguments[0];
      var url=typeof req==="string"?req:(req&&req.url)||"";
      var p=ofetch.apply(this,arguments);
      if(draftUrl(url)){
        p.then(function(res){
          try{if(res&&res.ok) res.clone().json().then(ingestJson).catch(function(){});}catch(e){}
          return res;
        }).catch(function(){});
      }
      return p;
    };
  }
  var XO=XMLHttpRequest.prototype.open, XS=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(m,u){this.__drUrl=u;return XO.apply(this,arguments);};
  XMLHttpRequest.prototype.send=function(){
    var xhr=this;
    xhr.addEventListener("load",function(){
      try{
        if(xhr.status>=200&&xhr.status<300&&draftUrl(xhr.__drUrl)&&xhr.responseText&&xhr.responseText.length<2000000){
          idle(function(){try{ingestJson(JSON.parse(xhr.responseText));}catch(e){}});
        }
      }catch(e){}
    });
    return XS.apply(this,arguments);
  };
}
function watchDom(){
  if(window.__draftRoomEspnObs||!document.body) return;
  var t=null;
  var obs=new MutationObserver(function(){
    if(t) return;
    t=setTimeout(function(){
      t=null;
      var got=takeAllPicks(null);
      if(got.length) post(got,lastMeta||urlMeta());
    },900);
  });
  try{ obs.observe(document.body,{subtree:true,childList:true}); window.__draftRoomEspnObs=obs; }catch(e){}
}
function pullApi(){
  var meta=urlMeta();
  if(!meta.leagueId){ post([],lastMeta||meta,"no leagueId in this URL"); return; }
  var views="view=mDraftDetail&view=mRoster&view=mSettings&view=mTeam&view=draftRecap";
  var season=meta.season||2026;
  var path="/apis/v3/games/ffl/seasons/"+season+"/segments/0/leagues/"+meta.leagueId+"?"+views;
  var urls=[location.origin+path,"https://fantasy.espn.com"+path,"https://gambit-api.fantasy.espn.com"+path,API+"/seasons/"+season+"/segments/0/leagues/"+meta.leagueId+"?"+views];
  if(meta.draftId){
    urls.unshift(location.origin+"/apis/v3/games/ffl/seasons/"+season+"/drafts/"+meta.draftId);
    urls.unshift("https://gambit-api.fantasy.espn.com/apis/v1/games/ffl/seasons/"+season+"/drafts/"+meta.draftId);
  }
  var i=0,lastErr="";
  function tryNext(){
    if(i>=urls.length){
      var n=(lastSig&&lastSig.charAt(0)!=="0"&&Number(lastSig.split(":")[0]))||0;
      if(n){ badge(n,lastMeta||meta); return; }
      scrapeThenPost(lastMeta||meta,lastErr||"0 filled slots — copy ESPN pick history, then paste in Draft Room step 3");
      return;
    }
    var url=urls[i++];
    var ctrl=typeof AbortController==="function"?new AbortController():null;
    var t=setTimeout(function(){try{ctrl&&ctrl.abort();}catch(e){}},8000);
    fetch(url,{credentials:"include",cache:"no-store",signal:ctrl?ctrl.signal:undefined}).then(function(r){
      clearTimeout(t);
      if(!r.ok) throw new Error("ESPN "+r.status);
      return r.json();
    }).then(function(json){ ingestJson(json); }).catch(function(e){
      clearTimeout(t);
      lastErr=String((e&&e.message)||e||"ESPN failed");
      tryNext();
    });
  }
  tryNext();
}
function kick(){ idle(pullApi); }
if(window.__draftRoomEspn&&window.__draftRoomEspn.kick){
  window.__draftRoomEspn.kick();
  badge(0,lastMeta);
  return;
}
hookNet();
watchDom();
badge(0,lastMeta);
window.__draftRoomEspn={kick:kick,timer:setInterval(kick,POLL)};
kick();
})();`;
}