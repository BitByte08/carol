import {
  SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder,
  MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from "discord.js";
import { getUserFriendCode, getUserSyncToken } from "../../db";
import { getBaseUrl } from "../../web";
import { PORT } from "../../config";

export const data = new SlashCommandBuilder()
  .setName("설정")
  .setDescription("웹 설정 페이지 안내");

function buildSettingsContent(userId: string) {
  const settingsUrl = `${getBaseUrl(PORT)}/settings?code=${getUserSyncToken(userId)}`;
  const embed = new EmbedBuilder()
    .setTitle("⚙️ 웹 설정")
    .setColor(0x5865f2)
    .addFields({
      name: "설정 페이지에서 관리",
      value: "프로필 공개 여부, 프리셋 북마클릿, 추가 북마클릿을 웹에서 관리할 수 있습니다.",
    });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("웹 설정 열기")
      .setStyle(ButtonStyle.Link)
      .setURL(settingsUrl)
      .setEmoji("⚙️"),
  );

  return { embeds: [embed], components: [row] };
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!getUserFriendCode(interaction.user.id)) {
    await interaction.reply({
      content: "아직 프로필이 등록되지 않았습니다. `/북마클릿` 명령어로 먼저 등록해주세요.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.reply({ ...buildSettingsContent(interaction.user.id), flags: MessageFlags.Ephemeral });
}
