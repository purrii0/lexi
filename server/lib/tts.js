import axios from "axios";
import { writeFile, stat } from "fs/promises";
import { join } from "path";
import { spawn } from "child_process";
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "YOUR_VOICE_ID";

export async function generateNepaliVoice(text) {
  if (!ELEVENLABS_KEY) throw new Error("ELEVENLABS_API_KEY not set in .env");
  if (!text || text.trim().length === 0) {
    throw new Error("Cannot generate voice for empty text");
  }

  const scriptsPath = join(__dirname, "..", "scripts");
  await import("fs/promises").then((m) =>
    m.mkdir(scriptsPath, { recursive: true })
  );
  const outputPath = join(scriptsPath, `voice_${Date.now()}.mp3`);

  const voiceId = ELEVENLABS_VOICE_ID;

  console.log(`🎤 Requesting TTS from ElevenLabs`);
  console.log(`   Voice ID: ${voiceId}`);
  console.log(`   Text length: ${text.length} chars`);
  console.log(`   Text preview: ${text.substring(0, 100)}...`);

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const payload = {
    text: text.trim(),
    model_id: "eleven_multilingual_v2",
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.0,
      use_speaker_boost: true,
    },
  };

  try {
    const resp = await axios.post(url, payload, {
      headers: {
        "xi-api-key": ELEVENLABS_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      responseType: "arraybuffer",
      timeout: 120000,
      validateStatus: (status) => status < 500,
    });

    if (resp.status !== 200) {
      const errorText = Buffer.from(resp.data).toString("utf-8");
      console.error(`❌ ElevenLabs API error (${resp.status}):`, errorText);
      throw new Error(`ElevenLabs API returned ${resp.status}: ${errorText}`);
    }

    const audioBuffer = Buffer.from(resp.data);
    if (audioBuffer.length === 0) {
      throw new Error("ElevenLabs returned empty audio data");
    }

    console.log(`✅ Received ${audioBuffer.length} bytes of audio data`);

    await writeFile(outputPath, audioBuffer);

    const stats = await stat(outputPath);
    console.log(`✅ Voice file written: ${outputPath} (${stats.size} bytes)`);

    await verifyAudioFile(outputPath);

    return outputPath;
  } catch (error) {
    console.error("❌ ElevenLabs TTS error:", error.message);

    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Headers:`, error.response.headers);

      try {
        const errorBody = Buffer.from(error.response.data).toString("utf-8");
        console.error(`   Body: ${errorBody}`);
      } catch (e) {
        console.error(`   Could not parse error body`);
      }
    }

    throw error;
  }
}

export async function verifyAudioFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Audio file does not exist: ${filePath}`);
  }
  const s = await stat(filePath);
  const size = s.size || 0;
  return new Promise((resolve) => {
    const p = spawn("ffprobe", [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ]);
    let out = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.on("close", (code) => {
      if (code !== 0)
        return resolve({ exists: true, size, duration: 0, hasAudio: false });
      try {
        const info = JSON.parse(out || "{}");
        const streams = info.streams || [];
        const format = info.format || {};
        const hasAudio = streams.some((st) => st.codec_type === "audio");
        const duration = parseFloat(format.duration) || 0;
        resolve({
          exists: true,
          size,
          duration,
          hasAudio,
          format: format.format_name,
          streams,
        });
      } catch (e) {
        resolve({ exists: true, size, duration: 0, hasAudio: false });
      }
    });
    p.on("error", () =>
      resolve({ exists: true, size, duration: 0, hasAudio: false })
    );
  });
}
