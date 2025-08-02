const { SlashCommandBuilder } = require("discord.js");
const queue = require("../music/queue");
const { handleTogglePlayback } = require("../music/actions");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("toggle")
    .setDescription("Pauses or resumes the current song."),

  async execute(interaction) {
    const serverQueue = queue.get(interaction.guild.id);
    if (!serverQueue) {
      return interaction.reply({
        content: "There is nothing playing to toggle.",
        ephemeral: true,
      });
    }

    await handleTogglePlayback(interaction, serverQueue);
    // The handleTogglePlayback function updates the panel,
    // so we just provide a silent confirmation.
    const playerState = serverQueue.player.state.status;
    await interaction.reply({
      content: `Player is now **${playerState}**!`,
      ephemeral: true,
    });
  },
};
