import { spawn } from "child_process";
import { writeFile, readdir, stat, unlink, mkdir } from "fs/promises";
import fs from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function getMediaDuration(filePath) {
  return new Promise((resolve) => {
    const p = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    let out = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.on("close", (code) => {
      if (code === 0) {
        const v = parseFloat(out.trim());
        resolve(isNaN(v) ? 0 : v);
      } else resolve(0);
    });
    p.on("error", () => resolve(0));
  });
}

export function createSilentAudio(durationSec, destPath) {
  return new Promise((resolve, reject) => {
    const dur = Math.max(0.5, Number(durationSec) || 1).toFixed(2);
    const args = [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `anullsrc=channel_layout=stereo:sample_rate=44100`,
      "-t",
      dur,
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      destPath,
    ];

    const ff = spawn("ffmpeg", args);
    let stderr = "";
    ff.stderr.on("data", (d) => (stderr += d.toString()));
    ff.on("close", (code) => {
      if (code === 0 && fs.existsSync(destPath)) resolve(destPath);
      else reject(new Error(`createSilentAudio failed: ${stderr}`));
    });
    ff.on("error", (e) => reject(e));
  });
}

export async function padOrTrimAudioToMatch(videoPath, audioPath, outputDir) {
  await mkdir(outputDir, { recursive: true });
  // If audio doesn't exist, create silent audio of video duration
  if (!audioPath || !fs.existsSync(audioPath)) {
    const videoDur = await getMediaDuration(videoPath);
    const out = join(outputDir, `silent_${Date.now()}.m4a`);
    await createSilentAudio(videoDur || 1, out);
    return out;
  }

  const videoDur = await getMediaDuration(videoPath);
  const audioDur = await getMediaDuration(audioPath);
  const eps = 0.05;

  // If audio is longer than video, trim it
  if (audioDur > videoDur + eps) {
    const out = join(outputDir, `audio_trim_${Date.now()}.m4a`);
    await new Promise((resolve, reject) => {
      const ff = spawn("ffmpeg", [
        "-y",
        "-i",
        audioPath,
        "-t",
        `${videoDur.toFixed(2)}`,
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        out,
      ]);
      let stderr = "";
      ff.stderr.on("data", (d) => (stderr += d.toString()));
      ff.on("close", (code) => {
        if (code === 0 && fs.existsSync(out)) resolve(out);
        else reject(new Error(`trim failed: ${stderr}`));
      });
      ff.on("error", (e) => reject(e));
    });
    return out;
  }

  // If audio is shorter, append silence
  if (audioDur < videoDur - eps) {
    const diff = Math.max(0.5, videoDur - audioDur);
    const silentPart = join(outputDir, `pad_silent_${Date.now()}.m4a`);
    await createSilentAudio(diff, silentPart);

    const out = join(outputDir, `audio_padded_${Date.now()}.m4a`);
    await new Promise((resolve, reject) => {
      // concat two audio streams
      const ff = spawn("ffmpeg", [
        "-y",
        "-i",
        audioPath,
        "-i",
        silentPart,
        "-filter_complex",
        "[0:a][1:a]concat=n=2:v=0:a=1[a]",
        "-map",
        "[a]",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        out,
      ]);
      let stderr = "";
      ff.stderr.on("data", (d) => (stderr += d.toString()));
      ff.on("close", (code) => {
        if (code === 0 && fs.existsSync(out)) resolve(out);
        else reject(new Error(`pad concat failed: ${stderr}`));
      });
      ff.on("error", (e) => reject(e));
    });
    return out;
  }

  // Durations close enough — return original audioPath
  return audioPath;
}

export async function ensureAudioForMerge(videoPath, audioPath, outputDir) {
  await mkdir(outputDir, { recursive: true });
  const prepared = await padOrTrimAudioToMatch(videoPath, audioPath, outputDir);
  return prepared;
}

export async function cleanupTempAudioFiles(dir) {
  try {
    const items = await readdir(dir);
    const patterns = [
      /^silent_/,
      /^audio_trim_/,
      /^audio_padded_/,
      /^pad_silent_/,
    ];
    for (const name of items) {
      try {
        if (patterns.some((rx) => rx.test(name))) {
          const full = join(dir, name);
          if (fs.existsSync(full)) {
            await unlink(full);
            console.log(`🧹 Removed temp audio: ${full}`);
          }
        }
      } catch (e) {
        // ignore individual delete errors
      }
    }
  } catch (e) {
    // ignore cleanup failures
  }
}
