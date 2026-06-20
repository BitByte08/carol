import {
  Client, Events, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, MessageFlags,
  ChatInputCommandInteraction, REST, Routes, StringSelectMenuBuilder, ActionRowBuilder,
  StringSelectMenuInteraction, AttachmentBuilder,
} from "discord.js";
import { initEncryption } from "./crypto";
import { startWebServer, buildBookmarklet, setBaseUrl } from "./web";
import { getCachedProfile, loadUserSession, closeDb, getUserSyncToken, getAvatarBlob } from "./db";

const CONFIG = require("../config.json") as {
  token: string; clientId: string; guildId?: string; encryptionKey?: string;
  webPort?: number; baseUrl?: string;
};

initEncryption(CONFIG.encryptionKey);
const PORT = CONFIG.webPort ?? 3456;
if (CONFIG.baseUrl) setBaseUrl(CONFIG.baseUrl);
startWebServer(PORT);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder().setName("프로필").setDescription("내 maimai DX 프로필"),
  new SlashCommandBuilder().setName("친구검색").setDescription("친구 코드로 검색")
    .addStringOption((o) => o.setName("코드").setDescription("13자리 친구 코드").setRequired(true)),
].map((c) => c.toJSON());

client.once(Events.ClientReady, async (c) => {
  console.log(`[maimai] ${c.user.tag}`);
  const rest = new REST({ version: "10" }).setToken(CONFIG.token);
  await rest.put(CONFIG.guildId
    ? Routes.applicationGuildCommands(CONFIG.clientId, CONFIG.guildId)
    : Routes.applicationCommands(CONFIG.clientId), { body: commands });
  console.log("[maimai] 준비 완료");
});

client.on(Events.InteractionCreate, async (i) => {
  if (i.isChatInputCommand()) await handleCmd(i);
  if (i.isStringSelectMenu()) await handleSelect(i);
});

const TICON: Record<string, string> = { normal: "⚪", bronze: "🟤", silver: "⚪", gold: "🟡", rainbow: "🌈" };

function buildAvatarAttachment(userId: string): AttachmentBuilder | null {
  const buf = getAvatarBlob(userId);
  if (!buf) return null;
  return new AttachmentBuilder(buf, { name: "avatar.png" });
}

function profileEmb(p: NonNullable<ReturnType<typeof getCachedProfile>>, hasAvatar: boolean) {
  const emb = new EmbedBuilder()
    .setAuthor({ name: `${TICON[p.trophyClass] || "⚪"} ${p.trophy || ""}` })
    .setTitle(p.playerName || "???")
    .setColor(0x888888)
    .setDescription(`**레이팅 ${p.rating || 0}**${p.ratingMax ? ` (최대 ${p.ratingMax})` : ""}`)
    .addFields(
      { name: "등급", value: p.trophyClass || "-", inline: true },
      { name: "플레이 횟수", value: String(p.playCount || 0), inline: true },
      { name: "친구 코드", value: p.friendCode || "-", inline: true },
    )
    .setFooter({ text: `동기화: ${new Date(p.lastSyncedAt).toLocaleString("ko-KR")}` });
  if (hasAvatar) emb.setThumbnail("attachment://avatar.png");
  return emb;
}

function contentEmb(p: NonNullable<ReturnType<typeof getCachedProfile>>, view: string) {
  if (view === "recent") {
    const emb = new EmbedBuilder().setColor(0x666666).setTitle("🎵 최근 플레이");
    try {
      const r: { title: string; achievement: string; diff: string; level?: string; date?: string }[] = JSON.parse(p.recentJson || "[]");
      emb.setDescription(r.length
        ? r.map((s, i) => `\`${i + 1}.\` **${s.title}** \`${s.diff}${s.level ? " " + s.level : ""}\`\n　　${s.achievement}${s.date ? " · " + s.date : ""}`).join("\n")
        : "기록 없음");
    } catch { emb.setDescription("데이터 오류"); }
    return emb;
  }
  return new EmbedBuilder().setColor(0x666666).setDescription("준비 중...");
}

function selectMenu(view: string) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId("maimai_view").setPlaceholder("보기 선택")
      .addOptions(
        { label: "최근 플레이", value: "recent", default: view === "recent", emoji: { name: "🎵" } },
        { label: "TOP 5", value: "top5", default: view === "top5", emoji: { name: "⭐" } },
      ),
  );
}

function buildProfileReply(cached: NonNullable<ReturnType<typeof getCachedProfile>>, userId: string, view: string) {
  const avatar = buildAvatarAttachment(userId);
  const files = avatar ? [avatar] : [];
  return {
    embeds: [profileEmb(cached, !!avatar), contentEmb(cached, view)],
    components: [selectMenu(view)],
    files,
  };
}

async function handleCmd(interaction: ChatInputCommandInteraction) {
  const userId = interaction.user.id;
  if (interaction.commandName === "프로필") {
    const stored = loadUserSession(userId);
    if (stored?.friendCode) {
      const cached = getCachedProfile(stored.friendCode);
      if (cached) {
        await interaction.reply(buildProfileReply(cached, userId, "recent"));
        return;
      }
    }
    const token = getUserSyncToken(userId);
    await interaction.reply({
      embeds: [new EmbedBuilder().setTitle("📋 프로필 등록").setColor(0x888888)
        .setDescription(`[maimai DX net](https://maimaidx-eng.com/maimai-mobile/)에서 북마클릿 실행`)
        .addFields({ name: "코드", value: `\`\`\`js\n${buildBookmarklet(token, PORT)}\n\`\`\`` })],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (interaction.commandName === "친구검색") {
    const code = interaction.options.getString("코드", true);
    if (code.length !== 13 || !/^\d+$/.test(code)) { await interaction.reply({ content: "13자리 숫자.", flags: MessageFlags.Ephemeral }); return; }
    const cached = getCachedProfile(code);
    if (cached) { await interaction.reply(buildProfileReply(cached, userId, "recent")); }
    else { await interaction.reply({ content: "캐시 없음.", flags: MessageFlags.Ephemeral }); }
  }
}

async function handleSelect(interaction: StringSelectMenuInteraction) {
  if (interaction.customId !== "maimai_view") return;
  const userId = interaction.user.id;
  const stored = loadUserSession(userId);
  if (!stored?.friendCode) { await interaction.reply({ content: "먼저 /프로필로 등록하세요.", flags: MessageFlags.Ephemeral }); return; }
  const cached = getCachedProfile(stored.friendCode);
  if (!cached) { await interaction.reply({ content: "데이터 없음.", flags: MessageFlags.Ephemeral }); return; }
  const view = interaction.values[0];
  const avatar = buildAvatarAttachment(userId);
  const files = avatar ? [avatar] : [];
  await interaction.update({ embeds: [profileEmb(cached, !!avatar), contentEmb(cached, view)], components: [selectMenu(view)], files });
}

process.on("SIGINT", () => { closeDb(); process.exit(0); });
process.on("SIGTERM", () => { closeDb(); process.exit(0); });
client.login(CONFIG.token);
