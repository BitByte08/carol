import { getConstantsCache, saveConstantsCache } from "./db";

interface SongEntry {
  title: string;
  image_url?: string;
  lev_bas_i?: string;
  lev_adv_i?: string;
  lev_exp_i?: string;
  lev_mas_i?: string;
  lev_remas_i?: string;
  dx_lev_bas_i?: string;
  dx_lev_adv_i?: string;
  dx_lev_exp_i?: string;
  dx_lev_mas_i?: string;
  dx_lev_remas_i?: string;
}

const DIFF_FIELDS: Record<string, [keyof SongEntry, keyof SongEntry]> = {
  BASIC:       ["lev_bas_i",   "dx_lev_bas_i"],
  ADVANCED:    ["lev_adv_i",   "dx_lev_adv_i"],
  EXPERT:      ["lev_exp_i",   "dx_lev_exp_i"],
  MASTER:      ["lev_mas_i",   "dx_lev_mas_i"],
  "Re:MASTER": ["lev_remas_i", "dx_lev_remas_i"],
};

// 국제판 기준 수록곡 (우선), 일본판은 국제판에 없는 곡 보충용
const INTL_URL = "https://otoge-db.net/maimai/data/music-ex-intl.json";
const JP_URL = "https://otoge-db.net/maimai/data/music-ex.json";

let constantMap: Map<string, number> = new Map();
let jacketMap: Map<string, string> = new Map();

// 이미 존재하는 키는 덮어쓰지 않음 → 먼저 채운 쪽(국제판)이 우선
function ingest(data: SongEntry[]): void {
  for (const song of data) {
    if (song.image_url && !jacketMap.has(song.title)) jacketMap.set(song.title, song.image_url);
    for (const [diff, [stField, dxField]] of Object.entries(DIFF_FIELDS)) {
      const v = parseFloat((song[stField] as string | undefined) ?? "");
      const dv = parseFloat((song[dxField] as string | undefined) ?? "");
      const stKey = `${song.title}|ST|${diff}`;
      const dxKey = `${song.title}|DX|${diff}`;
      if (!isNaN(v) && v > 0 && !constantMap.has(stKey)) constantMap.set(stKey, v);
      if (!isNaN(dv) && dv > 0 && !constantMap.has(dxKey)) constantMap.set(dxKey, dv);
    }
  }
}

async function fetchSongs(url: string): Promise<SongEntry[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json() as SongEntry[];
}

export async function loadConstants(): Promise<void> {
  const dbCache = getConstantsCache();
  if (dbCache && Date.now() - dbCache.updatedAt < 24 * 60 * 60 * 1000) {
    try {
      const parsed = JSON.parse(dbCache.data) as { constants: [string, number][]; jackets: [string, string][] };
      constantMap = new Map(parsed.constants);
      jacketMap = new Map(parsed.jackets);
      console.log(`[constants] DB 캐시 복원: 상수 ${constantMap.size}개, 자켓 ${jacketMap.size}개`);
      return;
    } catch (e) {
      console.error("[constants] DB 캐시 파싱 실패, 네트워크 fetch 시도:", e);
    }
  }

  try {
    const intl = await fetchSongs(INTL_URL);
    constantMap = new Map();
    jacketMap = new Map();
    ingest(intl);
    const intlCount = constantMap.size;

    let jpAdded = 0;
    try {
      const jp = await fetchSongs(JP_URL);
      const before = constantMap.size;
      ingest(jp);
      jpAdded = constantMap.size - before;
    } catch (e) {
      console.error("[constants] JP 보충 로드 실패:", e);
    }

    console.log(`[constants] 국제판 ${intl.length}곡 (상수 ${intlCount}개) + JP 보충 ${jpAdded}개, 자켓 ${jacketMap.size}개`);
    saveConstantsCache(JSON.stringify({
      constants: Array.from(constantMap.entries()),
      jackets: Array.from(jacketMap.entries()),
    }));
  } catch (e) {
    console.error("[constants] 로드 실패:", e);
    if (dbCache) {
      try {
        const parsed = JSON.parse(dbCache.data) as { constants: [string, number][]; jackets: [string, string][] };
        constantMap = new Map(parsed.constants);
        jacketMap = new Map(parsed.jackets);
        console.log(`[constants] 네트워크 실패, 오래된 DB 캐시 사용: 상수 ${constantMap.size}개`);
      } catch (e2) {
        console.error("[constants] DB 캐시 파싱도 실패:", e2);
      }
    }
  }
}

// otoge-db 자켓 이미지 파일명 (예: "c7cfd8a91e0436ac.png")
export function getJacketFile(title: string): string | null {
  return jacketMap.get(title) ?? null;
}

export function getConstant(title: string, musicKind: string, diff: string): number | null {
  const kind = musicKind === "DX" ? "DX" : "ST";
  const val = constantMap.get(`${title}|${kind}|${diff}`);
  if (val !== undefined) return val;
  // DX/ST 구분 없이 어느 쪽이든 있으면 fallback
  const alt = constantMap.get(`${title}|${kind === "DX" ? "ST" : "DX"}|${diff}`);
  return alt ?? null;
}

// 표시용 레벨 문자열("14+")을 숫자 근사값으로 변환 (상수 없을 때 fallback)
export function levelToNumber(level: string): number {
  const base = parseInt(level.replace(/[^0-9]/g, "")) || 0;
  return level.includes("+") ? base + 0.6 : base;
}

// 달성률 계수 (achInt = 달성률 × 10000, 예: 100.5000% → 1005000)
function maimaiCoefficient(achInt: number): number {
  if (achInt >= 1005000) return 22.4; // SSS+
  if (achInt >= 1000000) return 21.6; // SSS
  if (achInt >= 995000)  return 21.1; // SS+
  if (achInt >= 990000)  return 20.8; // SS
  if (achInt >= 980000)  return 20.3; // S+
  if (achInt >= 970000)  return 20.0; // S
  if (achInt >= 940000)  return 16.8; // AAA
  if (achInt >= 900000)  return 15.2; // AA
  if (achInt >= 800000)  return 13.6; // A
  if (achInt >= 750000)  return 12.0; // BBB
  if (achInt >= 700000)  return 11.2; // BB
  if (achInt >= 600000)  return  9.6; // B
  if (achInt >= 500000)  return  8.0; // C
  if (achInt >= 400000)  return  6.4; // D
  if (achInt >= 300000)  return  4.8;
  if (achInt >= 200000)  return  3.2;
  if (achInt >= 100000)  return  1.6;
  return 0.0;
}

// fc 마크가 AP/AP+면 곡별 레이팅에 +1 보너스 (maimai DX 공식)
export function calcSongRating(achievementVal: number, level: number, fc?: string): number {
  const achInt = Math.round(achievementVal * 10000);
  const coeff = maimaiCoefficient(achInt);
  if (coeff === 0) return 0;
  const capped = Math.min(achInt, 1005000);
  const apBonus = fc === "AP" || fc === "AP+" ? 1 : 0;
  return Math.floor((level * capped / 1000000) * coeff) + apBonus;
}
