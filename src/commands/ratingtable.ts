import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { RATING_ROLES } from "../utils/roles";

export const data = new SlashCommandBuilder()
  .setName("레이팅기준표")
  .setDescription("레이팅 티어 기준표 보기");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const lines = RATING_ROLES.map(([min, name]) => `${min.toLocaleString()}~  :  **${name}**`);
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("레이팅 티어 기준표")
        .setColor(0xbd5dc7)
        .setDescription(lines.join("\n"))
        .setFooter({ text: "/역할설정 으로 현재 레이팅에 맞는 역할 부여" }),
    ],
  });
}
