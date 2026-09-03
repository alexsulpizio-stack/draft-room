/** Compact ESPN draft bookmarklet. String.raw so `\s` / `\d` survive into javascript: URLs.
 * Must stay under ~8KB (Chrome bookmark URL / sync truncation). Badge first, then post. */
export function espnBookmarkletCode(origin: string, relayUrl: string): string {
  const O = JSON.stringify(origin.replace(/\/$/, ""));
  const RELAY = JSON.stringify(relayUrl);
  return String.raw`(function(){
var O=${O},RELAY=${RELAY},POLL=5000;
var host=(location.hostname||"").toLowerCase();
function badge(n,msg,bad){
  var b=document.getElementById("draft-room-sync");
  if(!b){
    b=document.createElement("div");
    b.id="draft-room-sync";
    b.style.cssText="position:fixed;bottom:16px;left:16px;z-index:2147483647;background:#1f6a45;color:#fff;padding:10px 14px;border-radius:12px;font:13px/1.35 system-ui,sans-serif;box-shadow:0 8px 24px #0005;max-width:360px";
    (document.body||document.documentElement).appendChild(b);
  }
  b.style.background=bad?"#9b1c1c":"#1f6a45";
  b.textContent="Draft Room · "+(n||0)+" picks"+(msg?" · "+msg:"")+" · "+new Date().toLocaleTimeString();
}
if(!(host==="espn.com"||/\.espn\.com$/.test(host))){
  alert("Sync ESPN only works on fantasy.espn.com (live draft / practice / mock). You are on "+(host||"this page")+". For FantasyPros or DraftSharks ranks, use Sync FP ranks / Sync DS ranks instead.");
  return;
}
badge(0,"starting");
function takeSize(n){n=Number(n);return (n>=2&&n<=20)?n:0;}
function urlMeta(){
  var meta={leagueId:"",season:0,teamId:0,teams:0,leagueName:"",draftType:"snake",teamNames:null,pickOrder:null,slot:0,draftId:""};
  try{
    var href=String(location.href||""),sp=new URLSearchParams(location.search);
    meta.leagueId=sp.get("leagueId")||"";
    if(!meta.leagueId){var lm=href.match(/[?&#/](?:leagueId=|leagues\/|league\/)(-?\d+)/i);if(lm)meta.leagueId=lm[1];}
    meta.season=Number(sp.get("seasonId")||0)||0;
    if(!meta.season){var sm=href.match(/seasonId=(\d{4})/i);if(sm)meta.season=Number(sm[1]);}
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
  var s=json.settings||{},size=takeSize(s.size);
  if(size) meta.teams=size;
  if(typeof s.name==="string"&&s.name.length>1) meta.leagueName=s.name;
  var ds=s.draftSettings||{},ot=String(ds.orderType||ds.type||"");
  meta.draftType=(/LINEAR/i.test(ot)&&!/SNAKE/i.test(ot))?"linear":(meta.draftType||"snake");
  var teams=Array.isArray(json.teams)?json.teams:[];
  var order=(ds.pickOrder&&ds.pickOrder.length)?ds.pickOrder:teams.map(function(t){return t.id;});
  if(order&&order.length>=2) meta.pickOrder=order.map(Number).filter(function(n){return n>0;});
  if(teams.length>=2&&teams.length<=20){
    if(!meta.teams) meta.teams=teams.length;
    var byId={};teams.forEach(function(t){if(t&&t.id!=null) byId[t.id]=t;});
    meta.teamNames=(meta.pickOrder&&meta.pickOrder.length?meta.pickOrder:order).map(function(id,i){return teamName(byId[id],i);});
  }
  if(meta.teamId&&meta.pickOrder&&meta.pickOrder.length){
    var ix=meta.pickOrder.indexOf(meta.teamId);if(ix<0) ix=meta.pickOrder.indexOf(Number(meta.teamId));if(ix>=0) meta.slot=ix+1;
  }
  if(!meta.teams) meta.teams=12;
  return meta;
}
function unwrap(json){
  if(Array.isArray(json)){for(var i=0;i<json.length;i++) if(json[i]&&typeof json[i]==="object") return json[i];return null;}
  if(json&&json.data&&typeof json.data==="object"&&(json.data.draftDetail||json.data.teams||json.data.picks||json.data.settings)) return json.data;
  return json;
}
function pid(p){
  var n=Number(p.playerId||0);if(n>0) return n;
  if(p.player&&typeof p.player==="object"){n=Number(p.player.id||0);if(n>0) return n;}
  var ppe=p.playerPoolEntry;
  if(ppe&&typeof ppe==="object"){n=Number(ppe.playerId||0);if(n>0) return n;if(ppe.player&&typeof ppe.player==="object"){n=Number(ppe.player.id||0);if(n>0) return n;}}
  return Number(p.athleteId||p.espnPlayerId||0)||0;
}
function pname(p,names){
  var n="",pl=p.player||p.athlete;
  if(!pl&&p.playerPoolEntry) pl=p.playerPoolEntry.player;
  if(pl&&typeof pl==="object") n=pl.fullName||pl.name||pl.displayName||((pl.firstName||"")+" "+(pl.lastName||"")).trim();
  n=String(p.playerName||p.fullName||p.displayName||n||"").replace(/\s+/g," ").trim();
  if(/^ESPN\s+-?\d+$/i.test(n)) n="";
  var id=pid(p);if(!n&&id&&names&&names[id]) n=names[id];
  return n;
}
function nameMap(json){
  var m={};
  function add(list){
    if(!Array.isArray(list)) return;
    for(var i=0;i<list.length;i++){
      var e=list[i];if(!e||typeof e!=="object") continue;
      var pl=e.player||(e.playerPoolEntry&&e.playerPoolEntry.player)||e;
      var id=Number(e.id||e.playerId||(pl&&pl.id)||0);
      var nm=e.fullName||e.playerName||(pl&&(pl.fullName||pl.name))||"";
      if(id>0&&nm&&!/^ESPN\s+-?\d+$/i.test(nm)) m[id]=nm;
    }
  }
  add(json.players);
  if(Array.isArray(json.teams)) for(var t=0;t<json.teams.length;t++) add(json.teams[t]&&json.teams[t].roster&&json.teams[t].roster.entries);
  return m;
}
function cleanName(s){
  s=String(s||"").replace(/\s+/g," ").trim();
  s=s.replace(/^\d+\.\d{1,2}\s+/,"");
  s=s.replace(/,?\s*(QB|RB|WR|TE|K|DST|D\/ST|DEF|D)\b.*$/i,"");
  s=s.replace(/,?\s*[A-Z]{2,3}\s*$/,"");
  s=s.replace(/\s*\(.*\)\s*$/,"");
  var comma=s.indexOf(",");
  if(comma>0){var last=s.slice(0,comma).trim(),first=s.slice(comma+1).trim();if(last&&first&&last.length<18) s=first+" "+last;}
  if(/^ESPN\s+-?\d+$/i.test(s)||s.length<3||s.length>42) return "";
  if(/^(pick|round|team|draft|start|bench|overall|player|clock)$/i.test(s)) return "";
  return s;
}
function pushPick(out,seen,overall,playerId,teamId,name){
  playerId=Number(playerId||0)||0;name=cleanName(name);
  if(!playerId&&!name) return;
  var key=playerId?("id:"+playerId):("n:"+name.toLowerCase());
  if(seen[key]) return;seen[key]=1;
  out.push({overallPickNumber:Number(overall)||out.length+1,playerId:playerId,teamId:Number(teamId||0),playerName:name});
}
function takePicks(json){
  json=unwrap(json);if(!json) return [];
  var names=nameMap(json),raw=(json.draftDetail&&json.draftDetail.picks)||json.picks||(json.draft&&json.draft.picks)||[],out=[],i,p;
  if(Array.isArray(raw)) for(i=0;i<raw.length;i++){
    p=raw[i];if(!p||typeof p!=="object") continue;
    var overall=Number(p.overallPickNumber||p.overall||p.pickNumber||0),playerId=pid(p),name=pname(p,names);
    if(!overall||(!playerId&&!name)) continue;
    var team=p.team&&typeof p.team==="object"?p.team.id:p.teamId;
    out.push({overallPickNumber:overall,playerId:playerId,teamId:Number(team||0),playerName:name});
  }
  if(out.length) out.sort(function(a,b){return a.overallPickNumber-b.overallPickNumber;});
  return out;
}
function parsePickText(text){
  text=String(text||"").replace(/\r/g,"\n");if(text.length<8) return [];
  var out=[],seen={},teams=(lastMeta&&lastMeta.teams)||12,m,re=/(\d{1,2})\.(\d{1,2})\b/g,hits=[];
  while((m=re.exec(text))) hits.push({i:m.index,len:m[0].length,r:Number(m[1]),s:Number(m[2])});
  for(var i=0;i<hits.length;i++){
    if(hits[i].r<1||hits[i].s<1||hits[i].s>Math.max(teams,16)) continue;
    var start=hits[i].i+hits[i].len,end=i+1<hits.length?hits[i+1].i:Math.min(text.length,start+90);
    var name=cleanName(text.slice(start,end).replace(/[\n\t]+/g," "));
    if(name) pushPick(out,seen,(hits[i].r-1)*teams+hits[i].s,0,0,name);
  }
  return out;
}
function takeDomPicks(){
  var text="";
  try{text=(document.body&&document.body.innerText||"").slice(0,24000);}catch(e){}
  return parsePickText(text);
}
function mergePickLists(base,extra){
  if(!extra||!extra.length) return base||[];
  if(!base||!base.length) return extra;
  var by={},i,p,out=[];
  for(i=0;i<base.length;i++){p=base[i];if(p&&p.overallPickNumber>0) by[p.overallPickNumber]=p;}
  for(i=0;i<extra.length;i++){
    p=extra[i];if(!p||!(p.overallPickNumber>0)) continue;
    var prev=by[p.overallPickNumber];
    if(!prev){by[p.overallPickNumber]=p;continue;}
    by[p.overallPickNumber]={overallPickNumber:p.overallPickNumber,playerId:prev.playerId||p.playerId||0,teamId:prev.teamId||p.teamId||0,playerName:prev.playerName||p.playerName||""};
  }
  for(i in by) if(Object.prototype.hasOwnProperty.call(by,i)) out.push(by[i]);
  out.sort(function(a,b){return a.overallPickNumber-b.overallPickNumber;});
  return out;
}
function takeAllPicks(json){return mergePickLists(json?takePicks(json):[],takeDomPicks());}
function pack(picks,meta){
  var rows=[],i,p;
  for(i=0;i<(picks||[]).length;i++){p=picks[i];rows.push([p.overallPickNumber,p.playerId||0,p.teamId||0,p.playerName||""]);}
  var packed=JSON.stringify({v:1,p:rows,m:meta||{},h:location.href,t:Date.now()});
  while(rows.length>6&&packed.length>3500){rows=rows.slice(Math.ceil(rows.length/5));packed=JSON.stringify({v:1,p:rows,m:meta||{},h:location.href,t:Date.now()});}
  return packed;
}
function postRelay(picks,meta){
  if(!RELAY) return Promise.resolve(false);
  try{
    return fetch(RELAY,{method:"POST",headers:{"Content-Type":"text/plain"},body:pack(picks||[],meta),mode:"cors",keepalive:true}).then(function(r){if(!r.ok) throw 0;return true;}).catch(function(){return false;});
  }catch(e){return Promise.resolve(false);}
}
function postLocal(body){
  var ctrl=typeof AbortController==="function"?new AbortController():null;
  var t=setTimeout(function(){try{ctrl&&ctrl.abort();}catch(e){}},700);
  return fetch(O+"/api/espn/ingest",{method:"POST",headers:{"Content-Type":"application/json"},body:body,mode:"cors",keepalive:true,signal:ctrl?ctrl.signal:undefined}).then(function(r){clearTimeout(t);if(!r.ok) throw 0;return true;}).catch(function(){clearTimeout(t);return false;});
}
var sending=false,lastSig="",lastMeta=urlMeta(),pending=null,lastBeat=0;
function post(picks,meta,err){
  lastMeta=meta;
  if(!picks||!picks.length){
    var extra=takeDomPicks();
    if(extra.length){post(extra,meta);return;}
    var why=err||((!meta||!meta.leagueId)?"no leagueId in this URL":"0 filled slots");
    var hmeta={};for(var k in (meta||{})) hmeta[k]=meta[k];hmeta.reason=why;
    badge(0,why);
    var hsig="0:"+why+":"+(meta&&meta.leagueId||""),now=Date.now();
    if(hsig===lastSig&&now-lastBeat<25000) return;
    lastSig=hsig;lastBeat=now;
    postRelay([],hmeta);
    postLocal(JSON.stringify({picks:[],href:location.href,title:document.title,ts:Date.now(),meta:hmeta}));
    return;
  }
  var sig=picks.length+":"+picks[picks.length-1].overallPickNumber+":"+picks[picks.length-1].playerId+":"+(picks[picks.length-1].playerName||"")+":"+(meta.teams||"")+":"+(meta.leagueId||"");
  badge(picks.length,"sending");
  if(sig===lastSig){
    var nowKeep=Date.now();
    if(nowKeep-lastBeat<20000) return;
    lastBeat=nowKeep;
    postRelay(picks,meta);
    postLocal(JSON.stringify({picks:picks,href:location.href,title:document.title,ts:Date.now(),meta:meta}));
    return;
  }
  if(sending){pending={picks:picks,meta:meta};return;}
  sending=true;lastSig=sig;lastBeat=Date.now();
  var body=JSON.stringify({picks:picks,href:location.href,title:document.title,ts:Date.now(),meta:meta});
  var left=2,localOk=false,viaRelay=false;
  function done(){
    sending=false;
    badge(picks.length,localOk?"live":viaRelay?"via relay":"retry",!(localOk||viaRelay));
    if(pending){var n=pending;pending=null;post(n.picks,n.meta);}
  }
  function tick(){left-=1;if(left<=0) done();}
  postLocal(body).then(function(ok){localOk=!!ok;tick();});
  postRelay(picks,meta).then(function(ok){viaRelay=!!ok;tick();});
}
function ingestJson(json){
  json=unwrap(json);if(!json||typeof json!=="object") return;
  if(json.draftPick&&typeof json.draftPick==="object") json={picks:[json.draftPick]};
  var got=takeAllPicks(json);
  if(!got.length&&!(json.draftDetail||json.draft||(json.settings&&json.teams)||(Array.isArray(json.picks)&&json.picks[0]))) return;
  post(got,applyLeague(json,lastMeta||urlMeta()));
}
function draftUrl(u){
  u=String(u||"");
  if(/\/players\?|view=players_wl/i.test(u)) return false;
  return /mDraftDetail|mDraft(?:[^A-Za-z]|$)|draftDetail|draftRecap|draftStatus|mRoster|\/leagues\/-?\d+|leagueHistory|\/drafts\/\d+|gambit-api|livedraft|recentActivity/i.test(u);
}
function hookNet(){
  if(window.__draftRoomEspnHooked) return;
  window.__draftRoomEspnHooked=1;
  var ofetch=window.fetch;
  if(typeof ofetch==="function") window.fetch=function(){
    var req=arguments[0],url=typeof req==="string"?req:(req&&req.url)||"",p=ofetch.apply(this,arguments);
    if(draftUrl(url)) p.then(function(res){try{if(res&&res.ok) res.clone().json().then(ingestJson).catch(function(){});}catch(e){}return res;}).catch(function(){});
    return p;
  };
  var XO=XMLHttpRequest.prototype.open,XS=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(m,u){this.__drUrl=u;return XO.apply(this,arguments);};
  XMLHttpRequest.prototype.send=function(){
    var xhr=this;
    xhr.addEventListener("load",function(){
      try{if(xhr.status>=200&&xhr.status<300&&draftUrl(xhr.__drUrl)&&xhr.responseText&&xhr.responseText.length<2000000) ingestJson(JSON.parse(xhr.responseText));}catch(e){}
    });
    return XS.apply(this,arguments);
  };
}
function pullApi(){
  var meta=urlMeta();
  if(!meta.leagueId){post(takeAllPicks(null),lastMeta||meta,"no leagueId in this URL");return;}
  var views="view=mDraftDetail&view=mRoster&view=mSettings&view=mTeam&view=draftRecap";
  var season=meta.season||2026;
  var path="/apis/v3/games/ffl/seasons/"+season+"/segments/0/leagues/"+meta.leagueId+"?"+views;
  var urls=[location.origin+path,"https://fantasy.espn.com"+path,"https://lm-api-reads.fantasy.espn.com"+path];
  if(meta.draftId) urls.unshift(location.origin+"/apis/v3/games/ffl/seasons/"+season+"/drafts/"+meta.draftId);
  var i=0,lastErr="";
  function tryNext(){
    if(i>=urls.length){
      var n=(lastSig&&lastSig.charAt(0)!=="0"&&Number(lastSig.split(":")[0]))||0;
      if(n){badge(n,"watching");return;}
      var scraped=takeAllPicks(null);
      if(scraped.length){post(scraped,lastMeta||meta);return;}
      post([],lastMeta||meta,lastErr||"0 filled slots — copy ESPN pick history, then paste in Draft Room step 3");
      return;
    }
    var url=urls[i++],ctrl=typeof AbortController==="function"?new AbortController():null;
    var t=setTimeout(function(){try{ctrl&&ctrl.abort();}catch(e){}},8000);
    fetch(url,{credentials:"include",cache:"no-store",signal:ctrl?ctrl.signal:undefined}).then(function(r){
      clearTimeout(t);if(!r.ok) throw new Error("ESPN "+r.status);return r.json();
    }).then(function(json){ingestJson(json);}).catch(function(e){clearTimeout(t);lastErr=String((e&&e.message)||e||"ESPN failed");tryNext();});
  }
  tryNext();
}
function kick(){setTimeout(pullApi,0);}
if(window.__draftRoomEspn&&window.__draftRoomEspn.kick){window.__draftRoomEspn.kick();badge(0,"watching");return;}
hookNet();
window.__draftRoomEspn={kick:kick,timer:setInterval(kick,POLL)};
kick();
})();`;
}
