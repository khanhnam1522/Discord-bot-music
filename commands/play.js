const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { joinVoiceChannel, createAudioPlayer } = require("@discordjs/voice");
const play = require("play-dl");
const queue = require("../music/queue");
const { playSong } = require("../music/player");

// Helper function to search for songs (to avoid duplicating code)
async function searchForSongs(query, requestedBy) {
  try {
    let songs = [];
    const validation = await play.validate(query);

    if (validation === "yt_playlist") {
      const playlist = await play.playlist_info(query, { incomplete: true });
      const videos = await playlist.all_videos();
      songs = videos.map((video) => ({
        title: video.title,
        url: video.url,
        requestedBy,
      }));
    } else {
      const searchResults =
        validation === "yt_video"
          ? [await play.video_info(query)]
          : await play.search(query, { limit: 1 });
      if (searchResults.length === 0)
        return { songs: [], error: "No results found." };

      const video =
        validation === "yt_video"
          ? searchResults[0].video_details
          : searchResults[0];
      songs.push({ title: video.title, url: video.url, requestedBy });
    }
    return { songs };
  } catch (e) {
    console.error(e);
    return { songs: [], error: "There was an error during the search." };
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Plays a song or replaces the current queue.")
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("A YouTube URL or search term.")
        .setRequired(true)
    ),

  async execute(source) {
    // --- Universal Setup ---
    const isMessage = source.content !== undefined;

    const query = isMessage
      ? source.content
          .slice(process.env.PREFIX.length)
          .trim()
          .split(/ +/)
          .slice(1)
          .join(" ")
      : source.options.getString("query");

    const { guild, member, channel } = source;
    const requestedBy = member.user.tag;
    const serverQueue = queue.get(guild.id);

    // --- Universal Reply Functions ---
    let replyObject;
    const initialReply = async (content) => {
      if (isMessage) {
        replyObject = await channel.send(content);
      } else {
        await source.reply(content);
        replyObject = source; // For slash commands, the original interaction is the reply object
      }
    };
    const editReply = async (content) => {
      if (isMessage) {
        await replyObject.edit(content);
      } else {
        await replyObject.editReply(content);
      }
    };

    // --- Validation and Logic ---
    if (!query) {
      return initialReply({
        content: "You need to provide a song name or URL!",
        ephemeral: true,
      });
    }

    const voiceChannel = member.voice.channel;
    if (!voiceChannel) {
      return initialReply({
        content: "You need to be in a voice channel to play music!",
        ephemeral: true,
      });
    }

    const permissions = voiceChannel.permissionsFor(guild.client.user);
    if (
      !permissions.has(PermissionFlagsBits.Connect) ||
      !permissions.has(PermissionFlagsBits.Speak)
    ) {
      return initialReply({
        content: "I need permissions to join and speak in your voice channel!",
        ephemeral: true,
      });
    }

    await initialReply(`🔎 Searching for \`${query}\`...`);

    const { songs, error } = await searchForSongs(query, requestedBy);
    if (error) {
      return editReply(`❌ ${error}`);
    }
    // If a queue exists, delete the old panel and replace the queue.
    if (serverQueue) {
      // 1. Delete the old UI panel message if it exists.
      if (serverQueue.nowPlayingMessage) {
        await serverQueue.nowPlayingMessage.delete().catch(() => {});
      }

      // 2. Reset the message reference so a new one will be created.
      serverQueue.nowPlayingMessage = null;

      // 3. Replace the song list and stop the player to trigger the next song.
      serverQueue.songs = songs;
      await editReply(
        `✅ Playlist has been replaced! Now playing **${songs[0].title}**.`
      );
      serverQueue.player.stop();
      return;
    }

    // If no queue exists, create a new one as normal.
    if (songs.length > 1) {
      for (let i = songs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [songs[i], songs[j]] = [songs[j], songs[i]];
      }
    }

    const newQueue = {
      textChannel: channel,
      voiceChannel,
      connection: null,
      songs,
      player: createAudioPlayer({ behaviors: { noSubscriber: "stop" } }),
      loop: true,
      currentPage: 0,
      nowPlayingMessage: null,
    };

    queue.set(guild.id, newQueue);

    try {
      newQueue.connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
      });
      await editReply(
        `✅ Added **${
          songs.length > 1 ? `${songs.length} songs` : songs[0].title
        }** to the queue!`
      );
      playSong(guild.id, newQueue.songs[0]);
    } catch (err) {
      console.log(err);
      queue.delete(guild.id);
      return editReply(`❌ Could not join the voice channel: ${err.message}`);
    }
  },
};
