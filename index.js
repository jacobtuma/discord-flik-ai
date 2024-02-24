import { Client, GatewayIntentBits, VoiceState } from "discord.js";
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
} from "@discordjs/voice";
import AWS from "aws-sdk";
import dotenv from "dotenv";

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
});

// TaskQueue class for sequential task execution
class TaskQueue {
  constructor(player) {
    this.queue = [];
    this.running = false;
    this.player = player;
  }

  enqueue(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      if (!this.running) {
        this.runNext();
      }
    });
  }

  async runNext() {
    console.log(this.player.state.status);
    if (this.queue.length === 0) {
      if (
        this.player.state.status !== "playing" &&
        this.player.state.status !== "buffering"
      ) {
        this.running = false;
      }
      return;
    }

    this.running = true;
    const { task, resolve, reject } = this.queue.shift();

    try {
      await task(); // Wait for the task to complete
      resolve(); // Resolve the promise once the task is done
    } catch (error) {
      reject(error);
    } finally {
      this.runNext();
    }
  }

  clearQueue() {
    this.queue = [];
  }
}

// Configure AWS SDK with your credentials
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION, // e.g., 'us-east-1'
});

const polly = new AWS.Polly();

// Create a global player object
const player = createAudioPlayer({
  behaviors: {
    noSubscriber: NoSubscriberBehavior.Pause,
  },
});

// Create a new instance of TaskQueue
const taskQueue = new TaskQueue(player);

// Event listener for player state changes
player.on("stateChange", (oldOne, newOne) => {
  if (newOne.status == "idle") {
    console.log("Audio playback finished");
    taskQueue.runNext();
  }
});

// Event listener for when the bot gets kicked from a voice channel
client.on("voiceStateUpdate", (oldState, newState) => {
  if (newState && newState.id === client.user.id && !newState.channelId) {
    console.log("Bot got kicked from the voice channel.");
    taskQueue.clearQueue(); // Clear the queue when the bot gets kicked
  }
});

client.on("ready", () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on("messageCreate", async (message) => {
    
  // Ignore messages from bots or without content
  if (message.author.bot || !message.content) return;

  const voiceMap = {
    "1210757391776219167": "Brian",
    "1210759746274197597": "Ivy",
  };
  if (message.content.startsWith("!kickbot")) {
    taskQueue.clearQueue(); //
    player.stop();
  } else if (Object.keys(voiceMap).includes(message.channelId)) {
    // Extract the text after the command
    const text = message.content;

    // Define the task to generate audio from text using Amazon Polly
    const task = async () => {
      // Join the user's voice channel if they are in one
      if (message.member && message.member.voice.channel) {
        const connection = joinVoiceChannel({
          channelId: message.member.voice.channel.id,
          guildId: message.member.voice.channel.guild.id,
          adapterCreator:
            message.member.voice.channel.guild.voiceAdapterCreator,
        });

        connection.subscribe(player);

        const params = {
          OutputFormat: "mp3",
          Text: text,
          VoiceId: voiceMap[message.channelId], // Amazon Polly's Brian voice
        };

        const audioStream = polly.synthesizeSpeech(params).createReadStream();

        const resource = createAudioResource(audioStream);
        player.play(resource);
      } else {
        throw new Error("User not in a voice channel");
      }
    };

    // Enqueue the task
    taskQueue
      .enqueue(task)
      .then(() => console.log("Task completed successfully"))
      .catch((error) => console.error("Task failed:", error.message));
  }
});

client.login(process.env.DISCORD_TOKEN);
