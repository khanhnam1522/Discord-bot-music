const { Events } = require("discord.js");

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot || !message.content.startsWith(process.env.PREFIX))
      return;

    const args = message.content
      .slice(process.env.PREFIX.length)
      .trim()
      .split(/ +/);
    const commandName = args.shift().toLowerCase();

    const command = message.client.commands.get(commandName);

    if (!command) return;

    try {
      // For message commands, we pass the message itself.
      // Commands will need to be adapted to handle either a message or an interaction.
      await command.execute(message);
    } catch (error) {
      console.error(error);
      await message.reply({
        content: "There was an error while executing this command!",
        ephemeral: true,
      });
    }
  },
};
