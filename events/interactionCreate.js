const {
  Events,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require("discord.js");
const queue = require("../music/queue");
const actions = require("../music/actions");

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    const serverQueue = queue.get(interaction.guildId);

    // Handle Modal Submissions
    if (interaction.isModalSubmit()) {
      if (interaction.customId === "jump_modal_submit") {
        await interaction.deferUpdate(); // Defer here after modal submission
        await actions.handleModalJump(interaction, serverQueue);
      }
      return;
    }

    // Handle Button Interactions
    if (interaction.isButton()) {
      // The global deferUpdate() has been removed from here.

      switch (interaction.customId) {
        case "previous": // Add this case
          await interaction.deferUpdate();
          actions.handlePrevious(interaction, serverQueue);
          break;
        case "jump_modal":
          // We do NOT defer here. showModal() is the only reply.
          const modal = new ModalBuilder()
            .setCustomId("jump_modal_submit")
            .setTitle("Jump to Song");
          const songNumberInput = new TextInputBuilder()
            .setCustomId("song_number_input")
            .setLabel("Enter the song number from the queue")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("e.g., 5")
            .setRequired(true);
          modal.addComponents(
            new ActionRowBuilder().addComponents(songNumberInput)
          );
          await interaction.showModal(modal);
          break;
        case "skip":
          await interaction.deferUpdate(); // Defer inside the case
          actions.handleSkip(interaction, serverQueue);
          break;
        case "stop":
          await interaction.deferUpdate(); // Defer inside the case
          actions.handleStop(interaction, serverQueue);
          break;
        case "shuffle":
          await interaction.deferUpdate(); // Defer inside the case
          actions.handleShuffle(interaction, serverQueue);
          break;
        case "toggle_playback":
          await interaction.deferUpdate(); // Defer inside the case
          actions.handleTogglePlayback(interaction, serverQueue);
          break;
        case "panel_prev":
        case "panel_next":
          await interaction.deferUpdate(); // Defer inside the case
          actions.handlePagination(interaction, serverQueue);
          break;
      }
      return;
    }

    // Handle Slash Commands
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({
            content: "There was an error while executing this command!",
            ephemeral: true,
          });
        } else {
          await interaction.reply({
            content: "There was an error while executing this command!",
            ephemeral: true,
          });
        }
      }
    }
  },
};
