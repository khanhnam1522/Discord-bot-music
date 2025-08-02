const { SlashCommandBuilder } = require("discord.js");
const queue = require("../music/queue");
const { handleStop } = require("../music/actions");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stops the music and clears the queue."),
  execute(interactionOrMessage) {
    const serverQueue = queue.get(interactionOrMessage.guild.id);
    handleStop(interactionOrMessage, serverQueue);
    if (interactionOrMessage.isCommand?.())
      interactionOrMessage.reply({
        content: "⏹️ Stopped the music!",
        ephemeral: true,
      });
  },
};
