import * as http from "http";
import * as fs from "fs";
import { parseHome, parsePlayerData, parseFriendCode as parseFC, parseRecentRecords, parseTop5 } from "./scraper";
import { cacheProfile, saveUserSession, getUserSyncToken, findUserBySyncToken, saveAvatarBlob, getAvatarBlob } from "./db";

let baseUrl = "";
export function setBaseUrl(url: string): void { baseUrl = url; }
export function getBaseUrl(port: number): string { return baseUrl || `http://localhost:${port}`; }

export function buildBookmarklet(token: string, port: number): string {
  const server = getBaseUrl(port);
  return `javascript:(function(d){var s=d.createElement('script');s.src='${server}/bookmarklet.js?code=${token}&v='+Math.floor(Date.now()/1e5);d.body.append(s)})(document)`;
}

const bookmarkletJs = `(async()=>{
var e=document,s=e.currentScript.src,u=new URL(s),c=u.searchParams.get('code')||'',v=u.origin;
var x=function(a){return fetch(a).then(function(r){return r.text()})};
var q=['/maimai-mobile/home/','/maimai-mobile/playerData/','/maimai-mobile/record/','/maimai-mobile/friend/userFriendCode/'];
var r=await Promise.all(q.map(x));
var h=r[0],p=r[1],rd=r[2],f=r[3],a='';
try{
  var m=h.match(/src="(https:[^"]*Icon[^"]*)"/);
  if(m){var b=await fetch(m[1]).then(function(t){return t.blob()});
  a=await new Promise(function(d){var g=new FileReader();g.onload=function(){d(g.result)};g.readAsDataURL(b)})}
}catch(e){}
await fetch(v+'/sync?code='+c,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({h:h,p:p,r:rd,f:f,a:a})});
alert('\\uC644\\uB8CC!')
})()`;

function guidePage(token: string, bookmarklet: string): string {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>maimai 북마클릿</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#0d0d0d;color:#ccc;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:16px}
.box{background:#1a1a1a;padding:28px;border-radius:16px;width:100%;max-width:480px;border:1px solid #2a2a2a;text-align:center}
h2{color:#fff;margin-bottom:16px}
.step{background:#111;border:1px solid #333;border-radius:8px;padding:14px;margin-bottom:12px;text-align:left}
.step b{color:#fff;display:block;margin-bottom:6px;font-size:14px}
.step p{color:#888;font-size:13px;line-height:1.5}
.bm{display:inline-block;background:#1a1a1a;border:2px dashed #555;border-radius:8px;padding:14px 24px;color:#4caf50;font-size:14px;font-weight:600;cursor:grab;text-decoration:none;margin:8px 0}
.bm:hover{border-color:#4caf50}
.btn{background:#333;color:#ccc;border:none;border-radius:6px;padding:8px 18px;font-size:13px;cursor:pointer;margin:4px}
.btn:hover{background:#444}
.copied{color:#4caf50;font-size:12px;display:none}
</style></head><body>
<div class="box">
<h2>📋 북마클릿 설치</h2>
<div class="step"><b>1. 북마클릿 추가</b><p>초록색 링크를 북마크바로 드래그</p>
<a class="bm" href="${bookmarklet}" draggable="true">maimai</a></div>
<div class="step"><b>2. 사용</b><p><a href="https://maimaidx-eng.com/maimai-mobile/" target="_blank">maimai DX net</a>에서 북마클릿 클릭</p></div>
<button class="btn" onclick="navigator.clipboard.writeText('${bookmarklet.replace(/'/g,"\\'")}').then(()=>{document.getElementById('cp').style.display='block'})">📋 복사</button>
<span class="copied" id="cp">복사 완료!</span>
</div></body></html>`;
}

export function startWebServer(port: number): void {
  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url || "/", `http://localhost:${port}`);

    if (req.method === "GET" && url.pathname === "/avatar") {
      const uid = url.searchParams.get("user") || "";
      const data = getAvatarBlob(uid);
      if (data) {
        res.writeHead(200, { "content-type": "image/png", "cache-control": "max-age=3600" });
        res.end(data);
      } else {
        res.writeHead(404); res.end();
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/bookmarklet.js") {
      res.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-cache" });
      res.end(bookmarkletJs);
      return;
    }

    if (req.method === "GET" && url.pathname === "/sync") {
      const token = url.searchParams.get("code") || "";
      if (!findUserBySyncToken(token)) { res.writeHead(403); res.end("expired"); return; }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(guidePage(token, buildBookmarklet(token, port)));
      return;
    }

    if (req.method === "POST" && url.pathname === "/sync") {
      const token = url.searchParams.get("code") || "";
      const userId = findUserBySyncToken(token);
      if (!userId) { res.writeHead(403); res.end("expired"); return; }

      const raw = await readBody(req);
      const data = JSON.parse(raw);
      const homeHtml: string = data.h || "";
      const playerHtml: string = data.p || "";
      const fcHtml: string = data.f || "";
      const recordHtml: string = data.r || "";
      const avatarBase64: string = data.a || "";
      console.log(`[web] user=${userId.slice(-6)}, home=${homeHtml.length}B, player=${playerHtml.length}B, record=${recordHtml.length}B, fc=${fcHtml.length}B`);
      fs.writeFileSync("debug_home.html", homeHtml, "utf-8");
      fs.writeFileSync("debug_pd.html", playerHtml, "utf-8");
      fs.writeFileSync("debug_fc.html", fcHtml, "utf-8");
      fs.writeFileSync("debug_record.html", recordHtml, "utf-8");

      try {
        const home = parseHome(homeHtml);
        // home 파싱 실패 시 playerData에서 재시도
        const usePd = !home.playerName && playerHtml;
        const effective = usePd ? parseHome(playerHtml) : home;
        console.log(`[web] parseHome: name="${effective.playerName}", rating=${effective.rating}, fc=${effective.friendCode}, usePd=${usePd}`);
        console.log(`[web] avatar url: ${effective.avatar?.substring(0, 80) || "(empty)"}`);
        console.log(`[web] avatar b64: ${avatarBase64 ? avatarBase64.substring(0, 40) + "..." : "(empty)"}`);
        const { playCount } = parsePlayerData(playerHtml);
        const fcRaw = parseFC(fcHtml);
        const fc = effective.friendCode || (/^\d{13}$/.test(fcRaw) ? fcRaw : "") || token;
        const recentRecords = parseRecentRecords(recordHtml);
        const top5Records = parseTop5(recordHtml);
        console.log(`[web] recentRecords: ${recentRecords.length} songs, top5: ${top5Records.length} unique`);

        cacheProfile({
          playerName: effective.playerName || "???", rating: effective.rating || 0,
          ratingMax: effective.ratingMax || 0, gradeImg: effective.gradeImg || "",
          avatar: effective.avatar || "", trophy: effective.trophy || "",
          trophyClass: effective.trophyClass || "normal", stars: effective.stars || "0",
          playCount: playCount || 0, comment: effective.comment || "", friendCode: fc,
        }, playCount || 0, homeHtml, JSON.stringify({ recent: recentRecords, top5: top5Records }));
        saveUserSession(userId, "{}", fc);

        // base64 아바타 → DB에 저장
        if (avatarBase64 && avatarBase64.startsWith("data:")) {
          const m = avatarBase64.match(/^data:image\/\w+;base64,(.+)$/);
          if (m) saveAvatarBlob(userId, m[1]);
        }
        console.log(`[web] 저장: ${effective.playerName} ⭐${effective.rating} fc=${fc}`);
        res.writeHead(200); res.end("ok");
      } catch (e) {
        console.error("[web] 동기화 실패:", e);
        res.writeHead(500); res.end("sync error");
      }
      return;
    }

    res.writeHead(404); res.end();
  });

  server.listen(port, () => console.log(`[maimai] 🌐 http://localhost:${port}`));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d)); });
}
