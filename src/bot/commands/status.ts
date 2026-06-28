import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { getRegisteredUserCount, getLastSyncTime } from "../../db";

export const data = new SlashCommandBuilder()
  .setName("상태")
  .setDescription("봇 및 서버 상태 확인");

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}일`);
  if (h > 0) parts.push(`${h}시간`);
  parts.push(`${m}분`);
  return parts.join(" ");
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const ping = interaction.client.ws.ping;
  const uptime = formatUptime(Math.floor(process.uptime()));
  const userCount = getRegisteredUserCount();
  const lastSync = getLastSyncTime();
  const lastSyncStr = lastSync
    ? new Date(lastSync).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
    : "없음";

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle("서버 상태")
        .setColor(ping < 150 ? 0x22c55e : ping < 400 ? 0xf59e0b : 0xef4444)
        .addFields(
          { name: "핑", value: `${ping}ms`, inline: true },
          { name: "가동 시간", value: uptime, inline: true },
          { name: "등록 유저", value: `${userCount}명`, inline: true },
          { name: "마지막 동기화", value: lastSyncStr, inline: false },
        ),
    ],
  });
}
