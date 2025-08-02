const { Events } = require("discord.js");
const queue = require("../music/queue");

module.exports = {
  name: Events.VoiceStateUpdate,
  execute(oldState, newState) {
    if (oldState.member.user.id !== oldState.client.user.id) return;

    if (oldState.channelId && !newState.channelId) {
      const serverQueue = queue.get(oldState.guild.id);
      if (serverQueue) {
        if (serverQueue.nowPlayingMessage) {
          serverQueue.nowPlayingMessage.delete().catch((err) => {
            if (err.code !== 10008)
              console.error(
                "Failed to delete 'Now Playing' message on disconnect:",
                err
              );
          });
        }
        queue.delete(oldState.guild.id);
      }
    }
  },
};
