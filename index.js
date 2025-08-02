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

const queue = new Map();

client.on("ready", () => {
  console.log(`Logged in as ${client.user.tag}!`);
  client.user.setActivity("music with !play", { type: "PLAYING" });
});

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

  switch (command) {
    case "play":
      await handlePlay(message, args, serverQueue);
      break;
    case "skip":
      handleSkip(message, serverQueue);
      break;
    case "stop":
      handleStop(message, serverQueue);
      break;
    case "queue":
      handleQueue(message, serverQueue);
      break;
    case "shuffle":
      handleShuffle(message, serverQueue);
      break;
    case "loop":
      handleLoop(message, serverQueue);
      break;
  }
});

async function handlePlay(message, args, serverQueue) {
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
      "I need permissions to join and speak in your voice channel!"
    );
  }

  const url = args.join(" ");
  if (!url) {
    return message.channel.send("Please provide a YouTube URL or search term!");
  }

  const searchingMessage = await message.channel.send(
    `🔎 Searching for \`${url}\`...`
  );
  let songs = [];

  try {
    const validation = await play.validate(url);
    if (validation === "yt_playlist") {
      const playlist = await play.playlist_info(url, { incomplete: true });
      const videos = await playlist.all_videos();
      songs = videos.map((video) => ({ title: video.title, url: video.url }));
      await searchingMessage.edit(
        `✅ Added **${songs.length}** songs to the queue!`
      );
    } else {
      const searchResults =
        validation === "yt_video"
          ? [await play.video_info(url)]
          : await play.search(url, { limit: 1 });
      if (searchResults.length === 0) {
        return await searchingMessage.edit(
          `❌ Could not find any results for \`${url}\`.`
        );
      }
      const video =
        validation === "yt_video"
          ? searchResults[0].video_details
          : searchResults[0];
      songs.push({ title: video.title, url: video.url });
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

  if (!serverQueue) {
    const newQueue = {
      textChannel: message.channel,
      voiceChannel: voiceChannel,
      connection: null,
      songs: songs,
      player: createAudioPlayer({ behaviors: { noSubscriber: "stop" } }),
      playing: true,
      loop: false, // Add loop state
    };
    queue.set(message.guild.id, newQueue);

    try {
      newQueue.connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
      });
      playSong(message.guild.id, newQueue.songs[0]);
    } catch (err) {
      console.log(err);
      queue.delete(message.guild.id);
      return message.channel.send(err.message);
    }
  } else {
    serverQueue.songs.push(...songs);
    if (serverQueue.player.state.status === AudioPlayerStatus.Idle) {
      playSong(message.guild.id, serverQueue.songs[0]);
    }
  }
}

function handleSkip(message, serverQueue) {
  if (!message.member.voice.channel) {
    return message.channel.send("You have to be in a voice channel to skip!");
  }
  if (!serverQueue) {
    return message.channel.send("There is no song that I could skip!");
  }
  serverQueue.player.stop();
  message.channel.send("⏭️ Skipped the song!");
}

function handleStop(message, serverQueue) {
  if (!message.member.voice.channel) {
    return message.channel.send("You have to be in a voice channel to stop!");
  }
  if (!serverQueue) {
    return message.channel.send("There is nothing to stop!");
  }
  serverQueue.songs = [];
  serverQueue.loop = false;
  serverQueue.connection.destroy();
  queue.delete(message.guild.id);
  message.channel.send("⏹️ Stopped the music and cleared the queue.");
}

function handleQueue(message, serverQueue) {
  if (!serverQueue || serverQueue.songs.length === 0) {
    return message.channel.send("The queue is currently empty!");
  }
  let queueMessage = `**Now Playing:** ${serverQueue.songs[0].title}\n\n**Up Next:**\n`;
  serverQueue.songs.slice(1, 11).forEach((song, i) => {
    queueMessage += `${i + 1}. ${song.title}\n`;
  });
  if (serverQueue.songs.length > 11) {
    queueMessage += `...and ${serverQueue.songs.length - 11} more.`;
  }
  message.channel.send(queueMessage);
}

function handleShuffle(message, serverQueue) {
  if (!message.member.voice.channel) {
    return message.channel.send(
      "You have to be in a voice channel to shuffle the queue!"
    );
  }
  if (!serverQueue || serverQueue.songs.length < 2) {
    return message.channel.send(
      "There aren't enough songs in the queue to shuffle."
    );
  }

  // Keep the current song playing, but shuffle the rest
  const nowPlaying = serverQueue.songs.shift();
  for (let i = serverQueue.songs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [serverQueue.songs[i], serverQueue.songs[j]] = [
      serverQueue.songs[j],
      serverQueue.songs[i],
    ];
  }
  serverQueue.songs.unshift(nowPlaying);

  message.channel.send("🔀 The queue has been shuffled!");
}

function handleLoop(message, serverQueue) {
  if (!message.member.voice.channel) {
    return message.channel.send(
      "You have to be in a voice channel to change the loop settings!"
    );
  }
  if (!serverQueue) {
    return message.channel.send("There is no queue to loop.");
  }

  serverQueue.loop = !serverQueue.loop;
  message.channel.send(
    `🔁 Looping is now **${serverQueue.loop ? "ON" : "OFF"}**.`
  );
}

async function playSong(guildId, song) {
  const serverQueue = queue.get(guildId);
  if (!serverQueue) {
    return;
  }

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
    }, 300000); // 5-minute timeout
    return;
  }

  let resource;
  try {
    const stream = ytdl(song.url, {
      filter: "audioonly",
      quality: "highestaudio",
      highWaterMark: 1 << 25,
    });
    resource = createAudioResource(stream);
  } catch (error) {
    console.error(`Streaming error for ${song.title}: ${error.message}`);
    serverQueue.textChannel.send(`Error playing **${song.title}**. Skipping.`);
    serverQueue.songs.shift();
    playSong(guildId, serverQueue.songs[0]);
    return;
  }

  serverQueue.player.play(resource);
  serverQueue.connection.subscribe(serverQueue.player);

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

  await serverQueue.textChannel.send(`🎶 Now playing: **${song.title}**`);
}

client.login(process.env.DISCORD_TOKEN);
