import * as fs from "fs";
import * as path from "path";

// ─── maimai DX net (International) endpoints ───────────────────────────
const AUTH_PAGE =
  "https://maimaidx-eng.com/maimai-mobile/";
const AUTH_POST =
  "https://maimaidx-eng.com/common_auth/login/sid";
const HOME =
  "https://maimaidx-eng.com/maimai-mobile/home/";
const FRIEND_CODE_URL =
  "https://maimaidx-eng.com/maimai-mobile/friend/userFriendCode/";
const SEARCH_URL = (code: string) =>
  `https://maimaidx-eng.com/maimai-mobile/friend/search/searchUser/?friendCode=${code}`;

// ─── Types ──────────────────────────────────────────────────────────────
export interface CookieJar {
  [origin: string]: Record<string, { key: string; value: string; attributes: Record<string, string | true> }>;
}

export interface LoginResult {
  success: boolean;
  message: string;
}

// ─── Cookie helpers ─────────────────────────────────────────────────────
function originOf(u: string): string {
  const parsed = new URL(u);
  return `${parsed.protocol}//${parsed.host}`;
}

function parseSetCookie(response: Response): CookieJar {
  const jar: CookieJar = {};
  const origin = originOf(response.url);

  const raw = response.headers.get("set-cookie");
  if (!raw) return jar;

  // Split on `, ` that is NOT followed by a date pattern (expires=Thu, 01 Jan...)
  const separator = /,\s(?!\d\d-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{4}\s\d\d:\d\d:\d\d\sGMT;)/;
  for (const chunk of raw.split(separator)) {
    const parts = chunk.split(";").map((t) => t.trim());
    const [kv] = parts; // key=value
    const eq = kv.indexOf("=");
    const key = kv.slice(0, eq);
    const value = kv.slice(eq + 1);

    const attributes: Record<string, string | true> = {};
    for (const attr of parts.slice(1)) {
      const aeq = attr.indexOf("=");
      if (aeq > 0) {
        attributes[attr.slice(0, aeq).toLowerCase()] = attr.slice(aeq + 1);
      } else {
        attributes[attr.toLowerCase()] = true;
      }
    }

    jar[origin] ??= {};
    jar[origin][key] = { key, value, attributes };
  }

  return jar;
}

function cookieHeader(jar: CookieJar, url: string): string {
  const now = Date.now();
  const origin = originOf(url);
  const entry = jar[origin];
  if (!entry) return "";

  return Object.values(entry)
    .filter((c) => {
      if (c.attributes.expires && typeof c.attributes.expires === "string") {
        return new Date(c.attributes.expires).getTime() >= now;
      }
      return true;
    })
    .map((c) => `${c.key}=${c.value}`)
    .join("; ");
}

function mergeCookies(a: CookieJar, b: CookieJar): CookieJar {
  const result: CookieJar = {};
  for (const jar of [a, b]) {
    for (const [origin, entries] of Object.entries(jar)) {
      result[origin] ??= {};
      Object.assign(result[origin], entries);
    }
  }
  return result;
}

// ─── Fetcher ────────────────────────────────────────────────────────────
class Fetcher {
  cookies: CookieJar = {};
  private ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0";

  async get(url: string, follow = false): Promise<Response> {
    const res = await fetch(url, {
      headers: this.reqHeaders(url),
      redirect: follow ? "follow" : "manual",
    });
    this.cookies = mergeCookies(this.cookies, parseSetCookie(res));

    if (!follow && res.status >= 300 && res.status <= 399) {
      const loc = res.headers.get("location");
      if (loc) return this.get(new URL(loc, url).href, follow);
    }
    return res;
  }

  async post(url: string, body: Record<string, string>, follow = false): Promise<Response> {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        ...this.headers(url),
        "content-type": "application/x-www-form-urlencoded",
        referer: "https://maimaidx-eng.com/maimai-mobile/",
      },
      body: new URLSearchParams(body).toString(),
      redirect: follow ? "follow" : "manual",
    });
    this.cookies = mergeCookies(this.cookies, parseSetCookie(res));

    if (!follow && res.status >= 300 && res.status <= 399) {
      const loc = res.headers.get("location");
      if (loc) return this.get(new URL(loc, url).href, follow);
    }
    return res;
  }

  getCookie(site: string, key: string): string {
    return this.cookies[site]?.[key]?.value ?? "";
  }

  private headers(url: string): Record<string, string> {
    const cookie = cookieHeader(this.cookies, url);
    return cookie ? { "user-agent": this.ua, cookie } : { "user-agent": this.ua };
  }

  getCookieHeader(url: string): string {
    return cookieHeader(this.cookies, url);
  }

  private reqHeaders(url: string): Record<string, string> {
    return { ...this.headers(url), referer: "https://maimaidx-eng.com/maimai-mobile/" };
  }
}

// ─── Session ────────────────────────────────────────────────────────────
export class MaimaiSession {
  private fetcher = new Fetcher();
  isLoggedIn = false;

  /** HTTP 기반 로그인. SEGA ID + 비밀번호로 인증하고 세션 쿠키를 수집한다. */
  async login(sid: string, password: string): Promise<LoginResult> {
    try {
      console.log(`[auth] 로그인 시도: ${sid.substring(0, 3)}***`);

      await this.fetcher.get(AUTH_PAGE, false);
      console.log("[auth] GET 완료, 쿠키:", Object.keys(this.fetcher.cookies).join(","));

      const cookie = this.fetcher.getCookieHeader(AUTH_POST);
      const postRes = await fetch(AUTH_POST, {
        method: "POST",
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0",
          "content-type": "application/x-www-form-urlencoded",
          referer: AUTH_PAGE,
          ...(cookie ? { cookie } : {}),
        },
        body: new URLSearchParams({ sid, password, retention: "1" }).toString(),
        redirect: "manual",
      });
      this.fetcher.cookies = mergeCookies(this.fetcher.cookies, parseSetCookie(postRes));
      console.log(`[auth] POST: ${postRes.status} → ${postRes.headers.get("location")?.substring(0, 100) || "(none)"}`);

      if (postRes.status >= 300 && postRes.status <= 399) {
        const loc = postRes.headers.get("location");
        if (loc) {
          const finalRes = await this.fetcher.get(new URL(loc, AUTH_POST).href, false);
          console.log(`[auth] 최종: ${finalRes.status} ${finalRes.url.substring(0, 100)}`);

          if (finalRes.url.includes("/maimai-mobile/home")) {
            this.isLoggedIn = true;
            console.log("[auth] 로그인 성공");
            return { success: true, message: "로그인 성공!" };
          }
          return { success: false, message: finalRes.url.includes("error") || finalRes.url.includes("alof")
            ? "SEGA ID 또는 비밀번호가 틀렸습니다."
            : `로그인 실패 (리다이렉트 후: ${finalRes.url.substring(0, 60)})` };
        }
      }

      return { success: false, message: postRes.url.includes("error") || postRes.url.includes("alof")
        ? "SEGA ID 또는 비밀번호가 틀렸습니다."
        : `로그인 실패 (${postRes.status})` };
    } catch (e) {
      return { success: false, message: `네트워크 오류: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  async loginWithSsid(ssid: string): Promise<LoginResult> {
    try {
      const res = await this.fetcher.get(`https://maimaidx-eng.com/maimai-mobile/?ssid=${encodeURIComponent(ssid)}`, true);
      if (!res.ok || !res.url.includes("/maimai-mobile/home")) {
        return { success: false, message: "SSID가 만료되었거나 유효하지 않습니다. 다시 로그인해주세요." };
      }
      this.isLoggedIn = true;
      return { success: true, message: "로그인 성공!" };
    } catch (e) {
      return { success: false, message: `네트워크 오류: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  save(): string {
    return JSON.stringify(this.fetcher.cookies);
  }

  /** 저장된 세션 복원 */
  restore(state: string): void {
    try {
      this.fetcher.cookies = JSON.parse(state);
      this.isLoggedIn = true;
    } catch {
      // ignore corrupted save
    }
  }

  /** 브라우저 쿠키(document.cookie)를 세션에 로드 */
  loadCookies(cookieStr: string, baseUrl: string): void {
    const origin = originOf(baseUrl);
    this.fetcher.cookies[origin] = {};
    for (const pair of cookieStr.split(";")) {
      const [k, ...v] = pair.trim().split("=");
      if (k) this.fetcher.cookies[origin][k] = { key: k, value: v.join("="), attributes: {} };
    }
    this.isLoggedIn = true;
  }

  /** 임의의 URL fetch */
  async fetchPage(url: string): Promise<string> {
    const res = await this.fetcher.get(url);
    if (!res.ok) throw new Error(`fetch 실패 (${res.status})`);
    return res.text();
  }

  /** 현재 세션 쿠키를 파일에 저장 */
  saveToFile(filePath: string): void {
    fs.writeFileSync(filePath, this.save(), "utf-8");
  }

  /** 파일에서 세션 쿠키 불러오기 */
  loadFromFile(filePath: string): boolean {
    const full = path.resolve(filePath);
    if (!fs.existsSync(full)) return false;
    try {
      this.restore(fs.readFileSync(full, "utf-8"));
      return true;
    } catch {
      return false;
    }
  }

  /** 내 프로필 HTML 가져오기 */
  async fetchHomeHtml(): Promise<string> {
    const res = await this.fetcher.get(HOME);
    if (!res.ok) throw new Error(`프로필 조회 실패 (${res.status})`);
    return res.text();
  }

  /** 내 친구 코드 가져오기 */
  async fetchFriendCode(): Promise<string> {
    const res = await this.fetcher.get(FRIEND_CODE_URL);
    if (!res.ok) throw new Error(`친구 코드 조회 실패 (${res.status})`);
    return res.text();
  }

  /** 친구 코드로 유저 검색 HTML 가져오기 */
  async searchFriend(friendCode: string): Promise<string> {
    const res = await this.fetcher.get(SEARCH_URL(friendCode));
    if (!res.ok) throw new Error(`친구 검색 실패 (${res.status})`);
    return res.text();
  }
}
