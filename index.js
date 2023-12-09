const Discord = require("discord.js");
const {
  joinVoiceChannel,
  EndBehaviorType,
} = require("@discordjs/voice");
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const ffmpeg = require("fluent-ffmpeg");
ffmpeg.setFfmpegPath(ffmpegPath);
const wav = require('wav');
const decode = require("./decodeOpus.js");
const fs = require("fs");
const path = require("path");
const opus = require("@discordjs/opus");
const { Leopard } = require("@picovoice/leopard-node");
const { forEach } = require("underscore");
const { log } = require("console");

const intents = [
  Discord.Intents.FLAGS.GUILDS, // Required to receive guild-related events
  Discord.Intents.FLAGS.GUILD_MESSAGES, // Required to receive messages in text channels
  Discord.Intents.FLAGS.GUILD_VOICE_STATES, // Required for voice state updates in voice channels
];

var config = JSON.parse(fs.readFileSync("./settings.json", "utf-8"));

const prefix = config.prefix;
const discord_token =
  "MTA2OTk0NjAxODc5MzI3MTM3Ng.GGsTdy.4ie_4Zy5b1jj-HC_weF7L50M4sHbNvmMflwwfY";
const PicoVoiceAPI = "i0wRNxPCGJtkCiJs5PCNuCMThx09qqfeDv+2qyN78jy+YZ5XMpv4BQ==";
const handle = new Leopard(PicoVoiceAPI);

const client = new Discord.Client({ intents });
var dispatcher = null;
var voiceChannel = null;
var textChannel = null;
var listenConnection = null;
var listenReceiver = null;
var listenStreams = new Map();
var listening = false;
var target;

client.login(discord_token);

client.on("ready", handleReady.bind(this));

client.on("message", handleMessage.bind(this));

client.on("guildMemberSpeaking", handleSpeaking.bind(this));

async function handleReady() {
  console.log("started");
}

function handleMessage(message) {
  if (!message.content.startsWith(prefix)) {
    return;
  }
  
  var command = message.content.toLowerCase().slice(1).split(" ");
  if (
    (command[0] == "play" && command[1] == "list") ||
    command[0] == "playlist"
  ) {
    command = "playlist";
  } else {
    command = command[0];
  }

  switch (command) {
    case "leave":
      commandLeave();
      break;
    case "test":
      commandTest();
      break;
    case "initiate":
      commandInitiate(message);
      break;
    case "listen":
      textChannel = message.channel;
      commandListen(message);
      break;
    case "stop":
      commandStop();
      break;
    case "clear":
      commandReset();
      break;
    default:
      message.reply(
        " command not recognized! Type '!help' for a list of commands."
      );
  }
}

function handleSpeech(member, speech) {
  var command = speech.toLowerCase().split(" ");
  if (
    (command[0] == "play" && command[1] == "list") ||
    command[0] == "playlist"
  ) {
    command = "playlist";
  } else {
    command = command[0];
  }
  switch (command) {
    case "listen":
      speechListen();
      break;
    case "test":
      commandTest();
      break;
    case "leave":
      speechLeave();
      break;
    case "reset":
    case "clear":
      commandReset();
      break;
    default:
  }
}

function commandTest() {
  console.log(listenConnection);
}

function handleSpeaking(member, speaking) {
  // Close the writeStream when a member stops speaking
  if (!speaking && member.voiceChannel) {
    let stream = listenStreams.get(member.id);
    if (stream) {
      listenStreams.delete(member.id);
      stream.end((err) => {
        if (err) {
          console.error(err);
        }

        let basename = path.basename(stream.path, ".opus_string");

        // decode file into pcm
        decode.convertOpusStringToRawPCM(
          stream.path,
          basename,
          function () {
            processRawToWav(
              path.join("./recordings", basename + ".raw_pcm"),
              path.join("./recordings", basename + ".wav"),
              function (data) {
                if (data != null) {
                  handleSpeech(member, data._text);
                }
              }.bind(this),
              basename
            );
          }.bind(this)
        );
      });
    }
  }
}

async function commandInitiate(msg) {
  msg.channel.send("depricated");
}

function commandStop() {
  if (listenReceiver) {
    listening = false;
    listenReceiver.destroy();
    listenReceiver = null;
    textChannel.send("Stopped listening!");
  }
}

async function commandListen(message) {
  member = message.member;
  voiceChannel = member.voice.channel;
  if (!member) {
    return;
  }
  if (!voiceChannel) {
    message.reply(" you need to be in a voice channel first.");
    return;
  }
  if (listening) {
    message.reply(" a voice channel is already being listened to!");
    return;
  }

  listening = true;
  textChannel.send("Listening in to **" + member.voice.channel.name + "**!");

  var recordingsPath = path.join(".", "recordings");
  makeDir(recordingsPath);

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfeDeaf: false,
    selfeMute: false,
  });

  const encoder = new opus.OpusEncoder(48000, 2);
  let mapIdToAudioData = new Map;

  for(const [key,value] of voiceChannel.members){
    mapIdToAudioData.set(key,[]);
    console.log(member.id);
    console.log(key);
    makeDir(`./recordings/${key}`);

    let subscribtion = connection.receiver.subscribe(key, {
      end: { type: EndBehaviorType.AfterInactivity, duration: 500 },
    });

    let counter = 0;
    let usefull = true;

    subscribtion.on("data", (chunk) => {
      mapIdToAudioData.get(key).push(encoder.decode(chunk));
      console.log(encoder.decode(chunk));
      //console.log(chunk);
  
      if (
        mapIdToAudioData.get(key).length > 2 &&
        mapIdToAudioData.get(key)[mapIdToAudioData.get(key).length - 1].equals(
          mapIdToAudioData.get(key)[mapIdToAudioData.get(key).length - 2]
        )
      ) {
        if (counter > 6 && usefull) {
          usefull = false;
          handleBufferArray(mapIdToAudioData.get(key).slice(), key);
        } else counter++;
      } else if (!usefull) {
        counter = 0;
        usefull = true;
        mapIdToAudioData.set(key,[]);
      }
    });
  
    subscribtion.on("end", () => {
      console.log("wenigschtens eppes");
    });
  
    subscribtion.on("error", (error) => {
      console.error("Voice connection error:", error);
    });
  }
}

function handleBufferArray(bufferArray, key) {
  console.log("bufferArray:   " + bufferArray.length);
  if(bufferArray.length < 250)
    return;
  let concattedBuffer = Buffer.concat(bufferArray);
  const timestamp = new Date().getTime();

  const fileWriter = new wav.FileWriter(`./recordings/${key}/${timestamp}.wav`, {
  channels: 2, // Adjust channels based on your audio
  sampleRate: 48000, // Adjust sample rate based on your audio
  bitDepth: 16 // Adjust bit depth based on your audio
});

// Write the WAV header
//fileWriter.pipe(fs.createWriteStream(`${timestamp}.wav`));

fileWriter.on('error', err => {
  console.error('Error writing WAV file:', err);
});

fileWriter.on('finish', () => {
  console.log('WAV file written successfully');
});

// Write the raw PCM audio data to the file
fileWriter.write(concattedBuffer);

// Close the WAV file writer
fileWriter.end();
}
  

function commandLeave() {
  listening = false;
  queue = [];
  if (dispatcher) {
    dispatcher.end();
  }
  dispatcher = null;
  commandStop();
  if (listenReceiver) {
    listenReceiver.destroy();
    listenReceiver = null;
  }
  if (listenConnection) {
    listenConnection.disconnect();
    listenConnection = null;
  }
  if (voiceChannel) {
    voiceChannel.leave();
    voiceChannel = null;
  }
}

//processes raw to wave
//then check if flippi is to be delete and finally deletes the file
function processRawToWav(filepath, outputpath, cb, basename) {
  fs.closeSync(fs.openSync(outputpath, "w"));
}

function makeDir(dir) {
  try {
    fs.mkdirSync(dir);
  } catch (err) {}
}
