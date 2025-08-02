const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");
const songsPerPage = 10;

function createActionRows(serverQueue) {
  const isPaused = serverQueue.player.state.status === "paused";
  const currentPage = serverQueue.currentPage || 0;
  const totalPages =
    serverQueue.songs.length > 0
      ? Math.ceil(serverQueue.songs.length / songsPerPage)
      : 1;

  const hasMultipleSongs = serverQueue.songs.length > 1;

  // --- ROW 1: Playback Controls ---
  const playbackControls = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("skip")
      .setLabel("Skip")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("⏭️")
      .setDisabled(!hasMultipleSongs), // Disable if there's only one song

    new ButtonBuilder()
      .setCustomId("toggle_playback")
      .setLabel(isPaused ? "Resume" : "Pause")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(isPaused ? "▶️" : "⏸️"),

    new ButtonBuilder()
      .setCustomId("stop")
      .setLabel("Stop")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("⏹️"),

    new ButtonBuilder()
      .setCustomId("shuffle")
      .setLabel("Shuffle")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔀")
      .setDisabled(!hasMultipleSongs),

    new ButtonBuilder()
      .setCustomId("jump_modal")
      .setLabel("Jump")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🚀")
      .setDisabled(!hasMultipleSongs)
  );

  // --- ROW 2: Pagination Controls ---
  const paginationControls = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("panel_prev")
      .setLabel("Back")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("◀️")
      .setDisabled(currentPage === 0),

    new ButtonBuilder()
      .setCustomId("panel_next")
      .setLabel("Next")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("▶️")
      .setDisabled(currentPage >= totalPages - 1)
  );

  return [playbackControls, paginationControls];
}

function generatePanelPayload(serverQueue) {
  if (!serverQueue || serverQueue.songs.length === 0) {
    return { content: "The queue is empty.", embeds: [], components: [] };
  }

  const currentPage = serverQueue.currentPage || 0;
  const start = currentPage * songsPerPage;
  const end = start + songsPerPage;
  const totalPages = Math.ceil(serverQueue.songs.length / songsPerPage);

  const pageSongs = serverQueue.songs.slice(1).slice(start, end);

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
    const description = pageSongs
      .map((song, index) => `**${start + index + 1}.** ${song.title}`)
      .join("\n")
      .substring(0, 1024);
    embed.addFields({ name: "Up Next", value: description });
  } else {
    embed.addFields({ name: "Up Next", value: "No more songs in the queue." });
  }
  const components = createActionRows(serverQueue);
  return { embeds: [embed], components };
}

async function updatePanel(serverQueue) {
  if (!serverQueue || !serverQueue.nowPlayingMessage) return;
  const payload = generatePanelPayload(serverQueue);
  try {
    await serverQueue.nowPlayingMessage.edit(payload);
  } catch (error) {
    console.error("Failed to edit panel:", error);
  }
}

module.exports = { createActionRows, generatePanelPayload, updatePanel };
