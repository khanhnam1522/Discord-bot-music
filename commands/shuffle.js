const { SlashCommandBuilder } = require("discord.js");
const queue = require("../music/queue");
const { handleShuffle } = require("../music/actions");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("shuffle")
    .setDescription("Shuffles the songs in the queue."),

  async execute(interaction) {
    const serverQueue = queue.get(interaction.guild.id);
    await handleShuffle(interaction, serverQueue);
    // The handleShuffle function already updates the panel,
    // so we just need an ephemeral confirmation.
    await interaction.reply({
      content: "🔀 The queue has been shuffled!",
      ephemeral: true,
    });
  },
};
