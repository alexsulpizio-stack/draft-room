import { gzipSync } from "node:zlib";
import { espnBookmarkletCode } from "./espn-bookmarklet";
import { ranksBookmarkletCode } from "./ranks-bookmarklet";

/** Tiny Chrome-safe bookmark: host check + badge, then gunzip+eval the real scrape. */
export function espnLoaderBoot(): string {
  return String.raw`(function(){
var h=(location.hostname||"").toLowerCase();
function badge(n,msg,bad){
  var b=document.getElementById("draft-room-sync");
  if(!b){b=document.createElement("div");b.id="draft-room-sync";b.style.cssText="position:fixed;bottom:16px;left:16px;z-index:2147483647;background:#1f6a45;color:#fff;padding:10px 14px;border-radius:12px;font:13px/1.35 system-ui,sans-serif;box-shadow:0 8px 24px #0005;max-width:360px";(document.body||document.documentElement).appendChild(b);}
  b.style.background=bad?"#9b1c1c":"#1f6a45";
  b.textContent="Draft Room · "+(n||0)+" picks"+(msg?" · "+msg:"")+" · "+new Date().toLocaleTimeString();
}
if(!(h==="espn.com"||/\.espn\.com$/.test(h))){alert("Sync ESPN only works on fantasy.espn.com (live draft / practice / mock). You are on "+(h||"this page")+". For FantasyPros or DraftSharks ranks, use Sync FP ranks / Sync DS ranks instead.");return;}
badge(0,"starting");
var z="__GZ__";
(async function(){
  try{
    var u=Uint8Array.from(atob(z),function(c){return c.charCodeAt(0);});
    var t=await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    (0,eval)(t);
  }catch(e){badge(0,"script error — recopy the bookmark from Draft Room",1);}
})();
})();`;
}

export function ranksLoaderBoot(source: "fp" | "ds"): string {
  const src = JSON.stringify(source);
  return String.raw`(function(){
var SRC=${src};
var LABEL=SRC==="ds"?"Sync DS ranks":"Sync FP ranks";
var h=(location.hostname||"").toLowerCase();
var ok=SRC==="ds"?/draftsharks\.com$/.test(h):/(^|\.)fantasypros\.com$/.test(h);
function badge(n,msg,bad){
  var id="draft-room-ranks-badge-"+SRC,el=document.getElementById(id);
  if(!el){el=document.createElement("div");el.id=id;el.setAttribute("style","position:fixed;z-index:2147483647;right:12px;bottom:"+(SRC==="ds"?"56px":"12px")+";background:#0f766e;color:#fff;font:600 12px/1.3 system-ui,sans-serif;padding:10px 14px;border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.28);max-width:min(360px,90vw)");(document.documentElement||document.body).appendChild(el);}
  el.style.background=bad?"#9b1c1c":"#0f766e";
  el.textContent=LABEL+" · "+(n||0)+" ranks"+(msg?" · "+msg:"");
}
if(!ok){alert(LABEL+" only works on "+(SRC==="ds"?"draftsharks.com (Draft War Room / rankings)":"fantasypros.com or draftwizard.fantasypros.com (Draft Assistant / cheat sheet)")+". Open that tab, then click the bookmark.");return;}
badge(0,"starting");
var z="__GZ__";
(async function(){
  try{
    var u=Uint8Array.from(atob(z),function(c){return c.charCodeAt(0);});
    var t=await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    (0,eval)(t);
  }catch(e){badge(0,"script error — recopy the bookmark from Draft Room",1);}
})();
})();`;
}

export function compressJavascriptBookmarklet(code: string, boot: string): string {
  const body = code.replace(/\n/g, "");
  const gz = gzipSync(Buffer.from(body, "utf8")).toString("base64");
  if (!boot.includes("__GZ__")) throw new Error("bookmarklet boot missing __GZ__");
  return `javascript:${boot.replace("__GZ__", gz).replace(/\n/g, "")}`;
}

export function buildCompressedEspnBookmarklet(origin: string, relayUrl: string): string {
  return compressJavascriptBookmarklet(espnBookmarkletCode(origin, relayUrl), espnLoaderBoot());
}

export function buildCompressedRanksBookmarklet(
  origin: string,
  source: "fp" | "ds",
  relayUrl: string,
): string {
  return compressJavascriptBookmarklet(
    ranksBookmarkletCode(origin, source, relayUrl),
    ranksLoaderBoot(source),
  );
}
