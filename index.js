// index.js - Updated with a fallback streaming system

// Import necessary libraries
require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
} = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
} = require("@discordjs/voice");
const play = require("play-dl");
const ytdl = require("@distube/ytdl-core");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// A map to store the music queue for each server
const queue = new Map();

// When the bot is ready
client.on("ready", () => {
  console.log(`Logged in as ${client.user.tag}!`);
  client.user.setActivity("music with !play", { type: "PLAYING" });
});

// When a message is created
client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.content.startsWith(process.env.PREFIX)) {
    return;
  }

  const args = message.content
    .slice(process.env.PREFIX.length)
    .trim()
    .split(/ +/);
  const command = args.shift().toLowerCase();
  const serverQueue = queue.get(message.guild.id);

  if (command === "play") {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
      return message.channel.send(
        "You need to be in a voice channel to play music!"
      );
    }
    const permissions = voiceChannel.permissionsFor(message.client.user);
    if (
      !permissions.has(PermissionFlagsBits.Connect) ||
      !permissions.has(PermissionFlagsBits.Speak)
    ) {
      return message.channel.send(
        "I need the permissions to join and speak in your voice channel!"
      );
    }

    const url = args.join(" "); // Join args to support search terms with spaces
    if (!url) {
      return message.channel.send(
        "Please provide a YouTube URL or search term!"
      );
    }

    // Let the user know we're searching
    const searchingMessage = await message.channel.send(
      `🔎 Searching for \`${url}\`...`
    );

    let songs = [];

    try {
      // Validate the URL or search term using play-dl (it's best for metadata)
      const validation = await play.validate(url);

      if (validation === "yt_playlist") {
        const playlist = await play.playlist_info(url, { incomplete: true });
        const videos = await playlist.all_videos();
        songs = videos.map((video) => ({
          title: video.title,
          url: video.url,
        }));
        await searchingMessage.edit(
          `✅ Added **${songs.length}** songs from the playlist to the queue!`
        );
      } else if (validation === "yt_video") {
        const videoInfo = await play.video_info(url);
        songs.push({
          title: videoInfo.video_details.title,
          url: videoInfo.video_details.url,
        });
        await searchingMessage.edit(
          `✅ Added **${songs[0].title}** to the queue!`
        );
      } else {
        // If it's not a valid URL, treat it as a search query
        const searchResults = await play.search(url, { limit: 1 });
        if (searchResults.length === 0) {
          return await searchingMessage.edit(
            `❌ Could not find any results for \`${url}\`.`
          );
        }
        const video = searchResults[0];
        songs.push({
          title: video.title,
          url: video.url,
        });
        await searchingMessage.edit(
          `✅ Added **${songs[0].title}** to the queue!`
        );
      }
    } catch (error) {
      console.error(error);
      return await searchingMessage.edit(
        "There was an error processing your request. The video might be private or region-locked."
      );
    }

    // --- Queue Logic ---
    if (!serverQueue) {
      const queueContruct = {
        textChannel: message.channel,
        voiceChannel: voiceChannel,
        connection: null,
        songs: [],
        player: createAudioPlayer({
          behaviors: {
            noSubscriber: "stop",
          },
        }),
        playing: true,
      };
      queue.set(message.guild.id, queueContruct);
      queueContruct.songs = queueContruct.songs.concat(songs);

      try {
        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: message.guild.id,
          adapterCreator: message.guild.voiceAdapterCreator,
        });
        queueContruct.connection = connection;
        playSong(message.guild.id, queueContruct.songs[0]);
      } catch (err) {
        console.log(err);
        queue.delete(message.guild.id);
        return message.channel.send(err.message);
      }
    } else {
      serverQueue.songs = serverQueue.songs.concat(songs);
      // If music is not currently playing, and songs were added, start playing.
      if (serverQueue.player.state.status === AudioPlayerStatus.Idle) {
        playSong(message.guild.id, serverQueue.songs[0]);
      }
    }
  } else if (command === "skip") {
    if (!message.member.voice.channel)
      return message.channel.send(
        "You have to be in a voice channel to skip the music!"
      );
    if (!serverQueue)
      return message.channel.send("There is no song that I could skip!");
    serverQueue.player.stop();
    message.channel.send("⏭️ Skipped the song!");
  } else if (command === "stop") {
    if (!message.member.voice.channel)
      return message.channel.send(
        "You have to be in a voice channel to stop the music!"
      );
    if (!serverQueue) return message.channel.send("There is nothing to stop!");

    serverQueue.connection.destroy();
    queue.delete(message.guild.id);
    message.channel.send("⏹️ Stopped the music and cleared the queue.");
  } else if (command === "queue") {
    if (!serverQueue || serverQueue.songs.length === 0)
      return message.channel.send("The queue is currently empty!");

    let queueMessage = `**Now Playing:** ${serverQueue.songs[0].title}\n\n**Up Next:**\n`;

    serverQueue.songs.slice(1, 11).forEach((song, i) => {
      queueMessage += `${i + 1}. ${song.title}\n`;
    });

    if (serverQueue.songs.length > 11) {
      queueMessage += `...and ${serverQueue.songs.length - 11} more.`;
    }

    message.channel.send(queueMessage);
  }
});

async function playSong(guildId, song) {
  const serverQueue = queue.get(guildId);
  if (!song) {
    setTimeout(() => {
      const currentQueue = queue.get(guildId);
      // ---- FIX: Check if the queue still exists before using it ----
      if (!currentQueue) {
        return; // The queue was deleted by the 'stop' command, do nothing.
      }
      // ----------------------------------------------------------------
      if (currentQueue.player.state.status === AudioPlayerStatus.Idle) {
        currentQueue.connection.destroy();
        queue.delete(guildId);
      }
    }, 300000); // 5-minute timeout
    return;
  }

  if (!song.url || typeof song.url !== "string") {
    console.error("playSong was called with an invalid song object:", song);
    serverQueue.textChannel.send(
      "An error occurred with a song in the queue. Skipping it."
    );
    serverQueue.songs.shift();
    playSong(guildId, serverQueue.songs[0]);
    return;
  }

  let resource;

  try {
    const ytdlStream = ytdl(song.url, {
      filter: "audioonly",
      quality: "highestaudio",
      highWaterMark: 1 << 25,
    });
    resource = createAudioResource(ytdlStream);
    console.log("Successfully created stream with ytdl-core.");
  } catch (error) {
    console.error(`ytdl-core failed for ${song.url}. Reason: ${error.message}`);
    serverQueue.textChannel.send(`Error playing **${song.title}**. Skipping.`);
    serverQueue.songs.shift();
    playSong(guildId, serverQueue.songs[0]);
    return;
  }

  serverQueue.player.play(resource);
  serverQueue.connection.subscribe(serverQueue.player);

  serverQueue.player.once(AudioPlayerStatus.Idle, () => {
    serverQueue.songs.shift();
    playSong(guildId, serverQueue.songs[0]);
  });

  await serverQueue.textChannel.send(`🎶 Now playing: **${song.title}**`);
}

// Login to Discord with your client's token
client.login(process.env.DISCORD_TOKEN);
