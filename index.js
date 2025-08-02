// index.js - Updated to use ytdl-core and yt-search

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
const ytdl = require("@distube/ytdl-core"); // Primary streaming library
const yts = require("yt-search"); // Library for searching YouTube

// Create a new Discord client with necessary intents
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

    const query = args.join(" ");
    if (!query) {
      return message.channel.send(
        "Please provide a YouTube URL or search term!"
      );
    }

    const searchingMessage = await message.channel.send(
      `🔎 Searching for \`${query}\`...`
    );

    let songs = [];

    try {
      // Check if the query is a YouTube playlist URL
      if (
        query.match(
          /^(https?:\/\/)?(www\.)?(m\.)?(youtube\.com|youtu\.be)\/playlist\?list=([a-zA-Z0-9_-]+)/
        )
      ) {
        const playlistId = query.split("list=")[1].split("&")[0];
        const playlist = await yts({ listId: playlistId });
        songs = playlist.videos.map((video) => ({
          title: video.title,
          url: video.url,
        }));
        await searchingMessage.edit(
          `✅ Added **${songs.length}** songs from the playlist **${playlist.title}** to the queue!`
        );
      }
      // Check if the query is a standard YouTube video URL
      else if (ytdl.validateURL(query)) {
        const songInfo = await ytdl.getInfo(query);
        songs.push({
          title: songInfo.videoDetails.title,
          url: songInfo.videoDetails.video_url,
        });
        await searchingMessage.edit(
          `✅ Added **${songs[0].title}** to the queue!`
        );
      }
      // Otherwise, treat it as a search term
      else {
        const { videos } = await yts(query);
        if (!videos.length) {
          return await searchingMessage.edit(
            `❌ Could not find any results for \`${query}\`.`
          );
        }
        const video = videos[0];
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
        "There was an error processing your request."
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
      if (
        currentQueue &&
        currentQueue.player.state.status === AudioPlayerStatus.Idle
      ) {
        currentQueue.connection.destroy();
        queue.delete(guildId);
      }
    }, 300000);
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

  try {
    const stream = ytdl(song.url, {
      filter: "audioonly",
      quality: "highestaudio",
      highWaterMark: 1 << 25, // 32MB
    });

    const resource = createAudioResource(stream);

    serverQueue.player.play(resource);
    serverQueue.connection.subscribe(serverQueue.player);

    serverQueue.player.once(AudioPlayerStatus.Idle, () => {
      // FIX: Add a guard clause to ensure the queue still exists before proceeding.
      const currentQueue = queue.get(guildId);
      if (!currentQueue) {
        return;
      }
      currentQueue.songs.shift();
      playSong(guildId, currentQueue.songs[0]);
    });

    await serverQueue.textChannel.send(`🎶 Now playing: **${song.title}**`);
  } catch (error) {
    console.error(`Error playing song: ${song.url}`);
    console.error(error);
    serverQueue.textChannel.send(
      `Error playing **${song.title}**. Skipping to the next song.`
    );
    serverQueue.songs.shift();
    playSong(guildId, serverQueue.songs[0]);
  }
}

// Login to Discord with your client's token
client.login(process.env.DISCORD_TOKEN);
