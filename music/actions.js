const { updatePanel } = require("./ui");
const { playSong } = require("./player");
const queue = require("./queue");

// The 'source' parameter can be either a Message or an Interaction
function handleSkip(source, serverQueue) {
  if (
    !source.member.voice.channel ||
    !serverQueue ||
    serverQueue.songs.length < 2
  ) {
    return;
  }
  serverQueue.songs.push(serverQueue.songs.shift());
  playSong(source.guild.id, serverQueue.songs[0]);
}

function handleStop(source, serverQueue) {
  if (!source.member.voice.channel || !serverQueue) {
    return;
  }
  if (serverQueue.nowPlayingMessage) {
    serverQueue.nowPlayingMessage.delete().catch(console.error);
  }
  serverQueue.connection.destroy();
  queue.delete(source.guild.id);
}

async function handleShuffle(source, serverQueue) {
  if (
    !source.member.voice.channel ||
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
  serverQueue.currentPage = 0;
  await updatePanel(serverQueue);
}

async function handleTogglePlayback(source, serverQueue) {
  if (!serverQueue || !source.member.voice.channel) return;
  const playerState = serverQueue.player.state.status;
  if (playerState === "playing") {
    serverQueue.player.pause();
  } else if (playerState === "paused") {
    serverQueue.player.unpause();
  }
  await updatePanel(serverQueue);
}

async function handleModalJump(interaction, serverQueue) {
  if (!interaction.member.voice.channel || !serverQueue) {
    return interaction.followUp({
      content: "You are not in a voice channel or there is no queue.",
      ephemeral: true,
    });
  }

  const songNumberString =
    interaction.fields.getTextInputValue("song_number_input");
  const targetIndex = parseInt(songNumberString, 10);

  // The currently playing song is at index 0, so we can't jump to it or to a negative index.
  // We also check if the target index is outside the queue's bounds.
  if (
    isNaN(targetIndex) ||
    targetIndex < 1 ||
    targetIndex >= serverQueue.songs.length
  ) {
    // Use followUp because the interaction was already deferred. This is the fix.
    return interaction.followUp({
      content: `Invalid song number. Please provide a number between 1 and ${
        serverQueue.songs.length - 1
      }.`,
      ephemeral: true,
    });
  }

  // If validation passes, proceed with the logic.
  const songsToMove = serverQueue.songs.splice(1, targetIndex - 1);
  serverQueue.songs.push(...songsToMove);
  serverQueue.player.stop(); // This triggers the 'idle' event to play the "new" next song.
}

async function handlePagination(interaction, serverQueue) {
  if (!serverQueue) return;
  const songsPerPage = 10;
  const totalPages = Math.ceil(serverQueue.songs.length / songsPerPage);

  if (interaction.customId === "panel_next") {
    if (serverQueue.currentPage < totalPages - 1) serverQueue.currentPage++;
  } else if (interaction.customId === "panel_prev") {
    if (serverQueue.currentPage > 0) serverQueue.currentPage--;
  }
  await updatePanel(serverQueue);
}

module.exports = {
  handleSkip,
  handleStop,
  handleShuffle,
  handleTogglePlayback,
  handleModalJump,
  handlePagination,
};
