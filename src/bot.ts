import {
  Client, Events, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, MessageFlags,
  ChatInputCommandInteraction, REST, Routes,
  AttachmentBuilder, PermissionsBitField, GuildMember,
} from "discord.js";
import { initEncryption } from "./crypto";
import { startWebServer, buildBookmarklet, setBaseUrl, getBaseUrl } from "./web";
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
  new SlashCommandBuilder().setName("프로필").setDescription("내 maimai DX 프로필 보기"),
  new SlashCommandBuilder().setName("북마클릿").setDescription("프로필 동기화용 북마클릿 코드 받기"),
  new SlashCommandBuilder().setName("역할설정").setDescription("레이팅에 따라 Discord 역할 자동 부여"),
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
});

function buildAvatarAttachment(userId: string): AttachmentBuilder | null {
  const buf = getAvatarBlob(userId);
  if (!buf) return null;
  return new AttachmentBuilder(buf, { name: "avatar.png" });
}

function ratingColor(r: number): number {
  if (r >= 15000) return 0x8b00ff;
  if (r >= 14000) return 0xffd700;
  if (r >= 13000) return 0x8c8c8c;
  if (r >= 12000) return 0xcd7f32;
  if (r >= 10000) return 0xbd5dc7;
  if (r >= 8000)  return 0xd95656;
  if (r >= 6000)  return 0xf09c3c;
  if (r >= 4000)  return 0x5fba63;
  if (r >= 2000)  return 0x4d9eea;
  return 0x95a5a6;
}

const RATING_ROLES: [number, string, number][] = [
  [15000, "MAIMAI 무지개", 0x8b00ff],
  [14000, "MAIMAI 금",     0xffd700],
  [13000, "MAIMAI 은",     0x8c8c8c],
  [12000, "MAIMAI 동",     0xcd7f32],
  [10000, "MAIMAI 보라",   0xbd5dc7],
  [6000,  "MAIMAI 파랑",   0x4d9eea],
  [2000,  "MAIMAI 청동",   0x95a5a6],
];

function ratingRoleName(r: number): { name: string; color: number } | null {
  for (const [min, name, color] of RATING_ROLES) {
    if (r >= min) return { name, color };
  }
  return null;
}

function sep(label: string, totalW = 36): string {
  const frame = Math.max(0, totalW - label.length - 2);
  const left = "─".repeat(Math.floor(frame / 2));
  const right = "─".repeat(Math.ceil(frame / 2));
  return left + " " + label + " " + right;
}

function profileEmb(p: NonNullable<ReturnType<typeof getCachedProfile>>, hasAvatar: boolean) {
  const stars = p.stars && p.stars !== "0" ? " · ★×" + p.stars : "";
  const emb = new EmbedBuilder()
    .setColor(ratingColor(p.rating))
    .setAuthor({ name: sep("Profile") })
    .setTitle(p.trophy || "칭호 없음")
    .setDescription(
      `**${p.playerName || "이름 없음"}**  ·  **${p.rating || 0}**\n` +
      `플레이 ${p.playCount || 0}회${stars}`
    )
    .setFooter({ text: `마지막 동기화: ${new Date(p.lastSyncedAt).toLocaleString("ko-KR")}` });
  if (hasAvatar) emb.setThumbnail("attachment://avatar.png");
  return emb;
}

function getSongList(p: NonNullable<ReturnType<typeof getCachedProfile>>): any[] {
  const raw = JSON.parse(p.recentJson || "{}");
  return Array.isArray(raw) ? raw : (raw.recent || []);
}

function songEmbeds(p: NonNullable<ReturnType<typeof getCachedProfile>>, userId: string, port: number): EmbedBuilder[] {
  const records = getSongList(p);
  const server = getBaseUrl(port);
  if (records.length === 0) {
    return [new EmbedBuilder().setColor(0x2b2d31).setDescription("기록 없음")];
  }
  const pageSize = records[0]?.track || 3;
  const slice = records.slice(0, pageSize);
  return slice.map((r: any, i: number) => {
    const kind = r.musicKind ? ` [${r.musicKind}]` : "";
    const emb = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setAuthor({ name: sep("#" + (i + 1), 34) })
      .setTitle(r.title + kind)
      .setDescription(`\`${r.diff} ${r.level}\``)
      .addFields(
        { name: "달성률", value: r.achievement, inline: true },
        { name: "플레이일", value: r.date || "-", inline: true },
      );
    emb.setThumbnail(`${server}/jacket?user=${userId}&idx=${i}`);
    return emb;
  });
}

function buildProfileReply(cached: NonNullable<ReturnType<typeof getCachedProfile>>, userId: string) {
  const avatar = buildAvatarAttachment(userId);
  const files = avatar ? [avatar] : [];
  return {
    embeds: [profileEmb(cached, !!avatar), ...songEmbeds(cached, userId, PORT)],
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
        await interaction.reply(buildProfileReply(cached, userId));
        return;
      }
    }
    await interaction.reply({
      content: "아직 프로필이 등록되지 않았습니다. `/북마클릿` 명령어로 먼저 등록해주세요.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.commandName === "북마클릿") {
    const token = getUserSyncToken(userId);
    await interaction.reply({
      embeds: [new EmbedBuilder().setTitle("📋 프로필 등록").setColor(0x888888)
        .setDescription(`[maimai DX net](https://maimaidx-eng.com/maimai-mobile/)에서 북마클릿 실행`)
        .addFields({ name: "코드", value: `\`\`\`js\n${buildBookmarklet(token, PORT)}\n\`\`\`` })],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.commandName === "역할설정") {
    await handleRole(interaction, userId);
    return;
  }
}

async function handleRole(interaction: ChatInputCommandInteraction, userId: string) {
  if (!interaction.guild) {
    await interaction.reply({ content: "서버에서만 사용 가능합니다.", flags: MessageFlags.Ephemeral });
    return;
  }
  const botMember = interaction.guild.members.me;
  if (!botMember?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    await interaction.reply({ content: "봇에 '역할 관리' 권한이 필요합니다.", flags: MessageFlags.Ephemeral });
    return;
  }
  const stored = loadUserSession(userId);
  if (!stored?.friendCode) {
    await interaction.reply({ content: "먼저 `/북마클릿`으로 프로필을 등록해주세요.", flags: MessageFlags.Ephemeral });
    return;
  }
  const cached = getCachedProfile(stored.friendCode);
  if (!cached) {
    await interaction.reply({ content: "프로필 데이터가 없습니다. `/북마클릿`으로 동기화해주세요.", flags: MessageFlags.Ephemeral });
    return;
  }
  const roleInfo = ratingRoleName(cached.rating);
  if (!roleInfo) {
    await interaction.reply({ content: "레이팅이 2000 미만이라 역할이 부여되지 않습니다.", flags: MessageFlags.Ephemeral });
    return;
  }
  const member = interaction.member as GuildMember;
  if (!member) {
    await interaction.reply({ content: "멤버 정보를 불러올 수 없습니다.", flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    const oldRoles = member.roles.cache.filter((r) => r.name.startsWith("MAIMAI "));
    if (oldRoles.size > 0) await member.roles.remove(oldRoles);

    let targetRole = interaction.guild.roles.cache.find((r) => r.name === roleInfo.name);
    if (!targetRole) {
      targetRole = await interaction.guild.roles.create({
        name: roleInfo.name,
        color: roleInfo.color,
        reason: "maimai 레이팅 자동 역할",
      });
    }

    if (targetRole.position >= botMember.roles.highest.position) {
      await interaction.reply({
        content: `"${roleInfo.name}" 역할이 봇보다 높거나 같아서 부여할 수 없습니다. 관리자가 역할 순서를 조정해주세요.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const allTierRoles = interaction.guild.roles.cache.filter((r) =>
      RATING_ROLES.some(([, name]) => r.name === name)
    );
    await member.roles.remove(allTierRoles);
    await member.roles.add(targetRole);

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(roleInfo.color)
        .setDescription(`레이팅 **${cached.rating}** → **${roleInfo.name}** 역할 부여 완료!`)],
      flags: MessageFlags.Ephemeral,
    });
  } catch (e: any) {
    console.error("[role]", e);
    await interaction.reply({
      content: `역할 부여 실패: ${e.message || "알 수 없는 오류"}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

process.on("SIGINT", () => { closeDb(); process.exit(0); });
process.on("SIGTERM", () => { closeDb(); process.exit(0); });
client.login(CONFIG.token);
