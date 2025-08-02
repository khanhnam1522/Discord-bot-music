const { SlashCommandBuilder } = require("discord.js");
const queue = require("../music/queue");
const { handleSkip } = require("../music/actions");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skips the current song."),
  execute(interactionOrMessage) {
    const serverQueue = queue.get(interactionOrMessage.guild.id);
    handleSkip(interactionOrMessage, serverQueue);
  },
};
