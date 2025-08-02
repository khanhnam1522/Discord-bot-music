require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
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

  // The 'queue' command is removed as it's now part of the main panel
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
    case "shuffle":
      handleShuffle(
        { member: message.member, channel: message.channel },
        serverQueue
      );
      break;
    case "loop":
      await handleLoop(
        { member: message.member, isButton: () => false },
        serverQueue
      );
      break;
  }
});

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
    case "shuffle":
      await interaction.deferUpdate();
      await handleShuffle(interaction, serverQueue);
      break;
    case "loop":
      await handleLoop(interaction, serverQueue);
      break;
    case "panel_prev":
    case "panel_next":
      handlePagination(interaction, serverQueue);
      break;
  }
});

// This function now creates all buttons for the main panel
function createButtonRow(serverQueue) {
  const isLooping = serverQueue?.loop || false;
  const songsPerPage = 10;
  // We need to check if songs exist before calculating totalPages
  const totalPages = serverQueue?.songs?.length
    ? Math.ceil(serverQueue.songs.length / songsPerPage)
    : 1;

  // First row for main controls
  const playbackControls = new ActionRowBuilder().addComponents(
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
      .setCustomId("shuffle")
      .setLabel("Shuffle")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔀"),
    new ButtonBuilder()
      .setCustomId("loop")
      .setLabel(isLooping ? "Loop: On" : "Loop: Off")
      .setStyle(isLooping ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setEmoji("🔁")
  );

  // Second row for pagination
  const paginationControls = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("panel_prev")
      .setLabel("Back")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("◀️")
      .setDisabled(serverQueue.currentPage === 0),
    new ButtonBuilder()
      .setCustomId("panel_next")
      .setLabel("Next")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("▶️")
      .setDisabled(serverQueue.currentPage >= totalPages - 1)
  );

  // Return an array of both rows
  return [playbackControls, paginationControls];
}

function generatePanelPayload(serverQueue) {
  if (!serverQueue || serverQueue.songs.length === 0) {
    return { content: "The queue is empty.", embeds: [], components: [] };
  }

  const songsPerPage = 10;
  const totalPages = Math.ceil(serverQueue.songs.length / songsPerPage);
  const currentPage = serverQueue.currentPage || 0;
  const start = currentPage * songsPerPage;
  const end = start + songsPerPage;

  const upcomingSongs = serverQueue.songs.slice(1);
  const pageSongs = upcomingSongs.slice(start, end);

  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle("Now Playing")
    .setDescription(
      `**[${serverQueue.songs[0].title}](${serverQueue.songs[0].url})**\n*Requested by: ${serverQueue.songs[0].requestedBy}*`
    )
    .setFooter({
      text: `Page ${currentPage + 1} of ${totalPages} | ${
        serverQueue.songs.length
      } songs total`,
    });

  if (pageSongs.length > 0) {
    let description = pageSongs
      .map((song, index) => `**${start + index + 1}.** ${song.title}`)
      .join("\n");

    // --- FIX: Add the length check and truncate if necessary ---
    if (description.length > 1024) {
      description = description.substring(0, 1021) + "...";
    }
    // -----------------------------------------------------------

    embed.addFields({ name: "Up Next", value: description });
  } else {
    embed.addFields({ name: "Up Next", value: "No more songs in the queue." });
  }

  const components = createButtonRow(serverQueue);
  return { embeds: [embed], components };
}

// This new helper function updates the panel
async function updatePanel(serverQueue) {
  if (!serverQueue.nowPlayingMessage) return;
  const payload = generatePanelPayload(serverQueue);
  try {
    await serverQueue.nowPlayingMessage.edit(payload);
  } catch (error) {
    console.error("Failed to edit panel:", error);
  }
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
      loop: true,
      shuffle: false, // Shuffle is now a one-time action, not a mode
      currentPage: 0, // Add current page for pagination
      nowPlayingMessage: null,
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
    await updatePanel(serverQueue); // Update panel when songs are added
  }
}

function handleSkip(source, serverQueue) {
  if (!source.member.voice.channel || !serverQueue) return;
  serverQueue.player.stop();
}

function handleStop(source, serverQueue) {
  if (!source.member.voice.channel)
    return source.channel.send("You have to be in a voice channel to stop!");
  if (!serverQueue) return source.channel.send("There is nothing to stop!");
  if (serverQueue.nowPlayingMessage) {
    serverQueue.nowPlayingMessage.delete().catch(console.error);
  }
  serverQueue.connection.destroy();
  queue.delete(source.guild.id);
  source.channel.send("⏹️ Stopped the music and cleared the queue.");
}

async function handleShuffle(interaction, serverQueue) {
  if (
    !interaction.member.voice.channel ||
    !serverQueue ||
    serverQueue.songs.length < 2
  ) {
    return;
  }

  const nowPlaying = serverQueue.songs.shift();
  for (let i = serverQueue.songs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [serverQueue.songs[i], serverQueue.songs[j]] = [
      serverQueue.songs[j],
      serverQueue.songs[i],
    ];
  }
  serverQueue.songs.unshift(nowPlaying);
  serverQueue.currentPage = 0; // Reset to the first page to show the new order

  // The visual feedback is the panel updating, no message needed.
  await updatePanel(serverQueue);
}

async function handleLoop(interaction, serverQueue) {
  if (!interaction.member.voice.channel) return;
  if (!serverQueue) return;

  serverQueue.loop = !serverQueue.loop;

  if (interaction.isButton()) {
    await interaction.deferUpdate();
  }
  await updatePanel(serverQueue);
}

async function handlePagination(interaction, serverQueue) {
  if (!serverQueue) return;
  const songsPerPage = 10;
  const totalPages = Math.ceil(serverQueue.songs.length / songsPerPage);

  if (interaction.customId === "panel_next") {
    if (serverQueue.currentPage < totalPages - 1) {
      serverQueue.currentPage++;
    }
  } else if (interaction.customId === "panel_prev") {
    if (serverQueue.currentPage > 0) {
      serverQueue.currentPage--;
    }
  }
  await interaction.deferUpdate();
  await updatePanel(serverQueue);
}

async function playSong(guildId, song) {
  const serverQueue = queue.get(guildId);
  if (!serverQueue) return;

  if (!song) {
    if (serverQueue.nowPlayingMessage) {
      serverQueue.nowPlayingMessage.delete().catch(console.error);
    }
    serverQueue.connection.destroy();
    queue.delete(guildId);
    serverQueue.textChannel.send("Queue finished. Leaving voice channel.");
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

  serverQueue.currentPage = 0; // Reset to page 1 every time a new song plays
  const payload = generatePanelPayload(serverQueue);

  try {
    if (serverQueue.nowPlayingMessage) {
      await serverQueue.nowPlayingMessage.edit(payload);
    } else {
      serverQueue.nowPlayingMessage = await serverQueue.textChannel.send(
        payload
      );
    }
  } catch (error) {
    console.error("Error updating 'Now Playing' message:", error);
    serverQueue.nowPlayingMessage = await serverQueue.textChannel.send(payload);
  }
}

client.login(process.env.DISCORD_TOKEN);
