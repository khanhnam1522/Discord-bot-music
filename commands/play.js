const { SlashCommandBuilder } = require("discord.js");
const { joinVoiceChannel, createAudioPlayer } = require("@discordjs/voice");
const play = require("play-dl");
const queue = require("../music/queue");
const { playSong } = require("../music/player");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Plays a song or playlist from YouTube.")
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("A YouTube URL or search term.")
        .setRequired(true)
    ),

  async execute(interactionOrMessage) {
    // This command can be adapted for slash commands or message commands.
    // For simplicity, we'll stick to the message-based logic you had.
    // In a real slash command, you'd use `interaction.options.getString('query')`.
    const isMessage = !!interactionOrMessage.content;
    const args = isMessage
      ? interactionOrMessage.content
          .slice(process.env.PREFIX.length)
          .trim()
          .split(/ +/)
          .slice(1)
      : [interactionOrMessage.options.getString("query")];
    const source = isMessage ? interactionOrMessage : interactionOrMessage;
    const guild = source.guild;
    const member = source.member;
    const channel = source.channel;

    const serverQueue = queue.get(guild.id);
    if (serverQueue && serverQueue.songs.length > 0) {
      return channel.send(
        "A playlist is already active! Please use the `/stop` command before playing a new one."
      );
    }
    const voiceChannel = member.voice.channel;
    if (!voiceChannel) {
      return channel.send("You need to be in a voice channel to play music!");
    }
    const permissions = voiceChannel.permissionsFor(guild.client.user);
    if (!permissions.has("Connect") || !permissions.has("Speak")) {
      return channel.send(
        "I need permissions to join and speak in your voice channel!"
      );
    }

    const url = args.join(" ");
    if (!url) {
      return channel.send("Please provide a YouTube URL or search term!");
    }

    // In a slash command, you would defer the reply
    const searchingMessage = await channel.send(
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
          requestedBy: member.user.tag,
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
          requestedBy: member.user.tag,
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
      playSong(guild.id, newQueue.songs[0]);
    } catch (err) {
      console.log(err);
      queue.delete(guild.id);
      return channel.send(err.message);
    }
  },
};
