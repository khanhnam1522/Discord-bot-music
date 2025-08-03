const { createAudioResource, AudioPlayerStatus } = require("@discordjs/voice");
const ytdl = require("@distube/ytdl-core");
const queue = require("./queue");
const { generatePanelPayload, updatePanel } = require("./ui");

async function playSong(guildId, song) {
  const serverQueue = queue.get(guildId);
  if (!serverQueue) return;

  if (!song) {
    if (serverQueue.nowPlayingMessage) {
      serverQueue.nowPlayingMessage.delete().catch(console.error);
    }
    serverQueue.connection.destroy();
    queue.delete(guildId);
    serverQueue.textChannel.send("✅ Queue finished. Leaving voice channel.");
    return;
  }

  try {
    const stream = ytdl(song.url, {
      filter: "audioonly",
      quality: "highestaudio",
      highWaterMark: 1 << 25,
    });
    const resource = createAudioResource(stream);
    serverQueue.player.play(resource);
    serverQueue.connection.subscribe(serverQueue.player);
  } catch (error) {
    console.error(`Streaming error for ${song.title}: ${error.message}`);
    serverQueue.textChannel.send(
      `❌ Error playing **${song.title}**. Skipping.`
    );
    serverQueue.songs.shift();
    playSong(guildId, serverQueue.songs[0]);
    return;
  }

  serverQueue.player.once(AudioPlayerStatus.Idle, () => {
    const currentQueue = queue.get(guildId);
    if (currentQueue) {
      const songThatFinished = currentQueue.songs.shift();

      if (currentQueue.loop) {
        currentQueue.songs.push(songThatFinished);
      }
      playSong(guildId, currentQueue.songs[0]);
    }
  });

  serverQueue.currentPage = 0; // Reset to page 1 every time a new song plays

  // Create or update the 'Now Playing' panel
  const payload = generatePanelPayload(serverQueue);
  if (serverQueue.nowPlayingMessage) {
    await updatePanel(serverQueue);
  } else {
    serverQueue.nowPlayingMessage = await serverQueue.textChannel.send(payload);
  }
}

module.exports = { playSong };
