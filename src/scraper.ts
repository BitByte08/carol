import * as cheerio from "cheerio";

export interface MaimaiProfile {
  playerName: string;
  rating: number;
  ratingMax: number;
  gradeImg: string;
  avatar: string;
  trophy: string;
  trophyClass: string;
  stars: string;
  playCount: number;
  friendCode?: string;
  comment?: string;
}

export interface SearchResult {
  found: boolean;
  profile?: MaimaiProfile;
  message?: string;
}

const BASE = "https://maimaidx-eng.com";

function absUrl(src: string | undefined): string {
  if (!src) return "";
  if (src.startsWith("http")) return src;
  return BASE + (src.startsWith("/") ? "" : "/") + src;
}

export function parseHome(html: string): Partial<MaimaiProfile> {
  const $ = cheerio.load(html);
  return {
    playerName: $(".name_block").first().text().trim(),
    rating: Number($(".rating_block").first().text().trim()) || 0,
    ratingMax: Number($(".p_r_5").first().text().trim()) || 0,
    avatar: absUrl($("img.w_112.f_l").attr("src") || $("img[src*='Icon']").attr("src") || $(".basic_block img").first().attr("src")),
    trophy: $(".trophy_inner_block span").first().text().trim(),
    trophyClass: ($(".trophy_block").attr("class") || "").split(/\s+/).find(c => c.match(/^trophy_(?!block)/i))?.replace(/^trophy_/i, "").toLowerCase() || "normal",
    gradeImg: absUrl($(".basic_block img.h_35").attr("src") || $("img.f_l.h_25").attr("src")),
    stars: $(".basic_block img.h_20").parent().text().trim() || "0",
    comment: $(".friend_comment_block").text().trim(),
    friendCode: $("input[name=idx]").attr("value"),
  };
}

export function parsePlayerData(html: string): { playCount: number } {
  const $ = cheerio.load(html);
  const body = $("body").text();
  const m = body.match(/(?:total\s*play|play\s*count)[：:\s]*([\d,]+)/i);
  return { playCount: m ? Number(m[1].replace(/,/g, "")) : 0 };
}

export function parseFriendCode(html: string): string {
  const $ = cheerio.load(html);
  const text = $(".see_through_block").first().text().trim();
  const m = text.match(/(\d{13})/);
  return m ? m[1] : "";
}

export function parseRecentRecords(html: string): { title: string; achievement: string; diff: string; level: string; date: string }[] {
  const $ = cheerio.load(html);
  const records: { title: string; achievement: string; diff: string; level: string; date: string }[] = [];
  $(".p_10.t_l.f_0.v_b").each((_: number, el: any) => {
    const block = $(el).find(".basic_block").first();
    const level = block.find(".playlog_level_icon").text().trim();
    const clone = block.clone();
    clone.find(".w_80").remove();
    const title = clone.text().trim();
    const ach = $(el).find(".playlog_achievement_txt").text().trim();
    const diffSrc = $(el).find(".playlog_diff").attr("src") || "";
    const diff = diffSrc.includes("remaster") ? "Re:M" : diffSrc.includes("master") ? "M" : diffSrc.includes("expert") ? "E" : diffSrc.includes("advanced") ? "A" : "B";
    const date = $(el).find(".playlog_top_container span").eq(1).text().trim();
    if (title) records.push({ title, achievement: ach || "?", diff, level, date });
  });
  return records.slice(0, 5);
}

export function parseSearchResult(html: string): SearchResult {
  const $ = cheerio.load(html);
  const block = $(".see_through_block");
  if (!block.length) return { found: false, message: "검색 결과 없음" };
  if (block.text().includes("WRONG CODE")) return { found: false, message: "잘못된 코드" };

  const profile = {
    playerName: $(".name_block", block).text().trim(),
    rating: Number($(".rating_block", block).text().trim()) || 0,
    ratingMax: 0,
    gradeImg: absUrl($("img.h_35", block).attr("src")),
    avatar: absUrl($("img.w_112", block).attr("src") || $("img", block).first().attr("src")),
    trophy: $(".trophy_inner_block span", block).text().trim(),
    trophyClass: ($(".trophy_block", block).attr("class") || "").split(/\s+/).find(c => c.match(/^trophy_(?!block)/i))?.replace(/^trophy_/i, "").toLowerCase() || "normal",
    stars: "0",
    playCount: 0,
    friendCode: $("input[name=idx]", block).attr("value"),
  };
  if (!profile.playerName) return { found: false, message: "찾을 수 없음" };
  return { found: true, profile };
}
