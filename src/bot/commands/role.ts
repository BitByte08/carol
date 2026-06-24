import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { handleRole } from "../utils/roles";

export const data = new SlashCommandBuilder()
  .setName("역할설정")
  .setDescription("레이팅에 따라 Discord 역할 자동 부여");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await handleRole(interaction, interaction.user.id);
}
