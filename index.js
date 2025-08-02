require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
  client.user.setActivity("music with buttons!", { type: "PLAYING" });
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

// Listener for button interactions
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  const serverQueue = queue.get(interaction.guildId);

  switch (interaction.customId) {
    case "skip":
      await interaction.deferUpdate();
      handleSkip(interaction, serverQueue);
      break;
    case "stop":
      handleStop(interaction, serverQueue);
      break;
    case "queue":
      handleQueue(interaction, serverQueue);
      break;
    case "shuffle":
      await handleShuffle(interaction, serverQueue);
      break;
    case "loop":
      await handleLoop(interaction, serverQueue);
      break;
  }
});

function createButtonRow(serverQueue) {
  const isLooping = serverQueue?.loop || false;
  const isShuffling = serverQueue?.shuffle || false; // Check shuffle state

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("skip")
      .setLabel("Skip")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("⏭️"),
    new ButtonBuilder()
      .setCustomId("stop")
      .setLabel("Stop")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("⏹️"),
    new ButtonBuilder()
      .setCustomId("queue")
      .setLabel("Queue")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("📜"),
    new ButtonBuilder()
      .setCustomId("shuffle")
      .setLabel(isShuffling ? "Shuffle: On" : "Shuffle: Off") // Update Label
      .setStyle(isShuffling ? ButtonStyle.Success : ButtonStyle.Secondary) // Update Style
      .setEmoji("🔀"),
    new ButtonBuilder()
      .setCustomId("loop")
      .setLabel(isLooping ? "Loop: On" : "Loop: Off")
      .setStyle(isLooping ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setEmoji("🔁")
  );
}

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
      songs = videos.map((video) => ({
        title: video.title,
        url: video.url,
        requestedBy: message.author.tag,
      }));
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
      songs.push({
        title: video.title,
        url: video.url,
        requestedBy: message.author.tag,
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
  if (!serverQueue) {
    const newQueue = {
      textChannel: message.channel,
      voiceChannel: voiceChannel,
      connection: null,
      songs: songs,
      player: createAudioPlayer({ behaviors: { noSubscriber: "stop" } }),
      playing: true,
      loop: false,
      shuffle: false,
      nowPlayingMessage: null, // Track the message
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

function handleSkip(source, serverQueue) {
  const user = source.member;
  if (!user.voice.channel || !serverQueue) {
    return;
  }
  serverQueue.player.stop();
}

function handleStop(source, serverQueue) {
  const user = source.member;
  if (!user.voice.channel) {
    return source.channel.send("You have to be in a voice channel to stop!");
  }
  if (!serverQueue) {
    return source.channel.send("There is nothing to stop!");
  }

  // Delete the "Now Playing" message
  if (serverQueue.nowPlayingMessage) {
    serverQueue.nowPlayingMessage.delete().catch(console.error);
  }

  serverQueue.songs = [];
  serverQueue.loop = false;
  serverQueue.connection.destroy();
  queue.delete(source.guild.id);
  source.channel.send("⏹️ Stopped the music and cleared the queue.");
}

function handleQueue(source, serverQueue) {
  if (!serverQueue || serverQueue.songs.length === 0) {
    return source.channel.send("The queue is currently empty!");
  }
  // Use an embed for a cleaner look
  const { EmbedBuilder } = require("discord.js");
  const queueEmbed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle("Music Queue")
    .setDescription(
      `**Now Playing:** [${serverQueue.songs[0].title}](${serverQueue.songs[0].url})\n*Requested by: ${serverQueue.songs[0].requestedBy}*`
    )
    .setTimestamp();

  const nextSongs = serverQueue.songs
    .slice(1, 11)
    .map((song, i) => {
      // We shorten this line to save characters
      return `${i + 1}. ${song.title}`;
    })
    .join("\n");

  if (nextSongs) {
    // FIX: Truncate the field value if it exceeds the 1024 character limit
    const fieldValue =
      nextSongs.length > 1024
        ? nextSongs.substring(0, 1021) + "..."
        : nextSongs;
    queueEmbed.addFields({ name: "Up Next", value: fieldValue });
  }

  if (serverQueue.songs.length > 11) {
    queueEmbed.setFooter({
      text: `...and ${serverQueue.songs.length - 11} more.`,
    });
  }

  // Interactions need a reply, messages can just send
  if (source.isButton()) {
    source.user.send({ embeds: [queueEmbed] }).catch(() => {
      source.channel
        .send(
          "I couldn't DM you the queue! Please check your privacy settings."
        )
        .then((msg) => setTimeout(() => msg.delete(), 10000));
    });
    source.channel
      .send("I've sent you a DM with the queue!")
      .then((msg) => setTimeout(() => msg.delete(), 5000));
  } else {
    source.channel.send({ embeds: [queueEmbed] });
  }
}

async function handleShuffle(interaction, serverQueue) {
  const user = interaction.member;
  if (!user.voice.channel) {
    return interaction.reply({
      content: "You must be in a voice channel to shuffle!",
      ephemeral: true,
    });
  }
  if (!serverQueue) {
    return interaction.reply({
      content: "There is no queue to enable shuffle mode on.",
      ephemeral: true,
    });
  }

  // Acknowledge the interaction
  await interaction.deferUpdate();

  // Toggle the shuffle state
  serverQueue.shuffle = !serverQueue.shuffle;

  // Update the message with the new button state
  const row = createButtonRow(serverQueue);
  if (serverQueue.nowPlayingMessage) {
    await serverQueue.nowPlayingMessage.edit({ components: [row] });
  }
}

// MODIFIED - Updates the buttons instead of sending a message
async function handleLoop(interaction, serverQueue) {
  const user = interaction.member;
  if (!user.voice.channel || !serverQueue) {
    return interaction.reply({
      content: "You must be in a voice channel to use this!",
      ephemeral: true,
    });
  }

  // Acknowledge the interaction
  await interaction.deferUpdate();

  serverQueue.loop = !serverQueue.loop;

  // Update the message with the new button state
  const row = createButtonRow(serverQueue);
  if (serverQueue.nowPlayingMessage) {
    await serverQueue.nowPlayingMessage.edit({ components: [row] });
  }
}

async function playSong(guildId, song) {
  const serverQueue = queue.get(guildId);
  if (!serverQueue) {
    return;
  }
  if (!song) {
    setTimeout(() => {
      const currentQueue = queue.get(guildId);
      if (currentQueue) {
        if (currentQueue.nowPlayingMessage) {
          currentQueue.nowPlayingMessage.delete().catch(console.error);
        }
        currentQueue.connection.destroy();
        queue.delete(guildId);
      }
    }, 300000);
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
      // Handle loop mode
      if (currentQueue.loop) {
        currentQueue.songs.push(currentQueue.songs.shift());
      } else {
        currentQueue.songs.shift();
      }

      // If shuffle is on, pick a random next song and move it to the front
      if (currentQueue.songs.length > 0 && currentQueue.shuffle) {
        const randomIndex = Math.floor(
          Math.random() * currentQueue.songs.length
        );
        // Remove the random song from its position and place it at the front
        const nextSong = currentQueue.songs.splice(randomIndex, 1)[0];
        currentQueue.songs.unshift(nextSong);
      }

      // Play whatever is now at the front of the queue
      playSong(guildId, currentQueue.songs[0]);
    }
  });

  const row = createButtonRow(serverQueue);
  const messagePayload = {
    content: `🎶 Now playing: **${song.title}** (Requested by: *${song.requestedBy}*)`,
    components: [row],
  };

  try {
    if (serverQueue.nowPlayingMessage) {
      await serverQueue.nowPlayingMessage.edit(messagePayload);
    } else {
      serverQueue.nowPlayingMessage = await serverQueue.textChannel.send(
        messagePayload
      );
    }
  } catch (error) {
    console.error("Error updating 'Now Playing' message:", error);
    serverQueue.nowPlayingMessage = await serverQueue.textChannel.send(
      messagePayload
    );
  }
}

client.login(process.env.DISCORD_TOKEN);
