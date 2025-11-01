/**
 * AI Video Generator Backend (Complete with Audio Fixes)
 * --------------------------------------------------------
 * Groq (LLM) -> Manim CE (auto-fix loop) -> ElevenLabs TTS -> ffmpeg merge
 *
 * Requirements:
 * - .env with GROQ_API_KEY and ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID
 * - A Python venv with manim installed at ./scripts/myvenv (Activate.ps1 for Windows)
 * - ffmpeg and ffprobe available in PATH
 */

import express from "express";
import cors from "cors";
import Groq from "groq-sdk";
import "dotenv/config";
import { writeFile, mkdir, readdir, stat } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import fs from "fs";
import axios from "axios";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "YOUR_VOICE_ID";
const MANIM_TIMEOUT_MS = parseInt(process.env.MANIM_TIMEOUT_MS || "120000");
const NARRATION_LANGUAGE = process.env.NARRATION_LANGUAGE || "nepali"; // "nepali" or "english"

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => res.send("✅ AI Video Generator Backend Running"));

/**
 * Debug endpoint to test Manim manually
 */
app.post("/testManim", async (req, res) => {
  try {
    const scriptsPath = join(__dirname, "scripts");

    const testCode = `from manim import *

class TestScene(Scene):
    def construct(self):
        circle = Circle(radius=1, color=BLUE, fill_opacity=0.5)
        text = Text("Test Video", font_size=48).next_to(circle, DOWN)
        self.play(Create(circle))
        self.play(Write(text))
        self.wait(2)
`;

    const filePath = join(scriptsPath, "TestScene.py");
    await writeFile(filePath, testCode, "utf-8");

    console.log("🧪 Running test Manim scene...");
    const result = await runManim(filePath, "TestScene");

    res.json({
      status: result.videoPath ? "success" : "failed",
      videoPath: result.videoPath,
      output: result.output,
      errors: result.errors,
      scriptsPath,
      mediaPath: join(scriptsPath, "media", "videos"),
    });
  } catch (error) {
    console.error("❌ Test failed:", error);
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
});

/**
 * Debug endpoint to test audio generation
 */
app.post("/testAudio", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }

    console.log("🎤 Testing audio generation...");
    const audioPath = await generateNepaliVoice(text);

    const audioInfo = await verifyAudioFile(audioPath);

    res.json({
      status: "success",
      audioPath,
      audioInfo,
      fileSize: (await stat(audioPath)).size,
    });
  } catch (error) {
    console.error("❌ Audio test failed:", error);
    res.status(500).json({
      status: "error",
      message: error.message,
      stack: error.stack,
    });
  }
});

/**
 * Test merging endpoint
 */
app.post("/testMerge", async (req, res) => {
  try {
    const { videoPath, audioPath } = req.body;
    if (!videoPath || !audioPath) {
      return res
        .status(400)
        .json({ error: "videoPath and audioPath required" });
    }

    console.log("🎬 Testing merge...");
    const finalVideo = await mergeVideoAndAudio(videoPath, audioPath);

    res.json({
      status: "success",
      finalVideo,
      fileSize: (await stat(finalVideo)).size,
    });
  } catch (error) {
    console.error("❌ Merge test failed:", error);
    res.status(500).json({
      status: "error",
      message: error.message,
      stack: error.stack,
    });
  }
});

/**
 * Main route
 */
app.post("/generateVideo", async (req, res) => {
  try {
    const { description, language } = req.body;
    if (!description)
      return res.status(400).json({ error: "Description is required" });

    const targetLanguage = language || NARRATION_LANGUAGE;
    console.log(`🌐 Target language: ${targetLanguage}`);

    // 1) Scene plan with narration
    const scenePlan = await feedbackLoop(generateScenePlan, {
      description,
      language: targetLanguage,
    });
    if (!scenePlan.scene_name) throw new Error("Scene plan generation failed");

    console.log("📝 Scene plan generated:", JSON.stringify(scenePlan, null, 2));

    // 2) Generate & fix Manim until no errors and video exists
    const fixedCodeResult = await generateUntilNoManimErrors(scenePlan);

    if (!fixedCodeResult.videoPath) {
      return res.status(500).json({
        status: "error",
        message: "Manim did not produce a video after retries",
        details: fixedCodeResult.errors,
        attempts: fixedCodeResult.attempts,
      });
    }

    // 3) Generate voice using the narration from scene plan
    const narrationText = scenePlan.narration || description;
    console.log("🎤 Generating voice for:", narrationText);
    console.log(`📝 Narration language: ${targetLanguage}`);

    const voicePath = await generateNepaliVoice(narrationText);

    // 4) Merge video + audio
    console.log("🎬 Merging video and audio...");
    const finalVideoPath = await mergeVideoAndAudio(
      fixedCodeResult.videoPath,
      voicePath
    );

    res.json({
      status: "success",
      scenePlan,
      manimCode: fixedCodeResult.manimCode,
      silentVideo: fixedCodeResult.videoPath,
      finalVideo: finalVideoPath,
      voice: voicePath,
      manimOutput: fixedCodeResult.output,
      manimErrors: fixedCodeResult.errors,
      attempts: fixedCodeResult.attempts,
      language: targetLanguage,
    });
  } catch (error) {
    console.error("❌ Error in /generateVideo:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to generate video",
      details: error.message,
    });
  }
});

app.listen(PORT, () =>
  console.log(`🚀 Server running at http://localhost:${PORT}`)
);

/* =======================================================================
   CORE FUNCTIONS
   ======================================================================= */

async function generateUntilNoManimErrors(scenePlan, maxAttempts = 3) {
  const scriptsPath = join(__dirname, "scripts");
  await mkdir(scriptsPath, { recursive: true });
  let attempt = 0;
  let manimCodeJSON = null;
  let manimResult = { output: "", errors: "", videoPath: null };

  while (attempt < maxAttempts) {
    attempt++;
    console.log(`🌀 Attempt ${attempt}: generating and running Manim code...`);

    manimCodeJSON = await feedbackLoop(generateManimCode, scenePlan);
    if (!manimCodeJSON || !manimCodeJSON.manim_code) {
      console.warn("No manim_code produced; aborting attempt.");
      return {
        manimCode: manimCodeJSON,
        output: "",
        errors: "No manim_code",
        attempts: attempt,
      };
    }

    const filePath = join(scriptsPath, `${scenePlan.scene_name}.py`);
    await writeFile(filePath, manimCodeJSON.manim_code, "utf-8");

    console.log(`💾 Saved Manim code to: ${filePath}`);
    console.log(
      `📝 Code preview (first 500 chars):\n${manimCodeJSON.manim_code.substring(
        0,
        500
      )}...`
    );

    manimResult = await runManim(filePath, scenePlan.scene_name);

    const noErrors = !manimResult.errors || manimResult.errors.trim() === "";
    const hasVideo = !!manimResult.videoPath;

    if (noErrors && hasVideo) {
      console.log(
        "✅ Manim render succeeded and MP4 found:",
        manimResult.videoPath
      );
      return {
        manimCode: manimCodeJSON,
        output: manimResult.output,
        errors: manimResult.errors,
        filePath,
        videoPath: manimResult.videoPath,
        attempts: attempt,
      };
    }

    console.warn(
      "⚠️ Manim reported errors or no video. Preparing correction payload..."
    );

    scenePlan = {
      ...scenePlan,
      previous_code: manimCodeJSON.manim_code,
      manim_error: (manimResult.errors || "").slice(0, 2000),
      manim_video_missing: !hasVideo,
    };

    await new Promise((r) => setTimeout(r, 1000));
  }

  console.error("❌ Max attempts reached; returning last attempt result.");
  return {
    manimCode: manimCodeJSON,
    output: manimResult.output,
    errors: manimResult.errors,
    videoPath: manimResult.videoPath || null,
    attempts: maxAttempts,
  };
}

async function feedbackLoop(generateFn, input, maxRetries = 3) {
  let lastRawContent = "";
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const aiResponse = await generateFn(input);
      const content = aiResponse.choices?.[0]?.message?.content || "";
      lastRawContent = content.trim();

      const stripped = lastRawContent
        .replace(/^```(?:json)?\n?/, "")
        .replace(/```$/, "");

      const parsed = JSON.parse(stripped);
      return parsed;
    } catch (err) {
      console.warn(
        `⚠️ JSON attempt ${attempt} failed. Retrying... (${
          err?.message || "parse error"
        })`
      );
      input = {
        role: "user",
        content: `Previous output could not be parsed as valid JSON:\n${lastRawContent}\n\nPlease return a strict JSON object only, matching the expected schema. No explanation.`,
      };
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  console.error("❌ JSON parse failed after retries. Returning raw.");
  return { raw: lastRawContent };
}

/* -------------------- LLM helpers -------------------- */

async function generateScenePlan(input) {
  const { description, language } =
    typeof input === "string"
      ? { description: input, language: "nepali" }
      : input;

  const languageInstruction =
    language === "nepali"
      ? "Write the narration ONLY in Nepali (Devanagari script). This is CRITICAL - the narration MUST be in Nepali language."
      : "Write the narration in English.";

  return await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content: `
You are a precise Manim scene planner with narration abilities.
Return ONLY JSON in this format:

{
  "scene_name": "SceneName",
  "objects": ["list of objects"],
  "actions": ["list of actions in order"],
  "narration": "Clear, educational narration text",
  "captions": [
    {"text": "Caption 1", "start_time": 0, "duration": 3},
    {"text": "Caption 2", "start_time": 3, "duration": 4}
  ]
}

${languageInstruction}

IMPORTANT: The narration field must contain the actual narration text in ${language}, not a description of what to say.
Make the narration engaging and educational, explaining the concept clearly.
Captions should be concise and sync with narration timing.
`,
      },
      {
        role: "user",
        content: `Create a scene plan with narration (in ${language}) and captions for: "${description}". 

Remember: Write the narration text in ${language} language. Return ONLY JSON.`,
      },
    ],
  });
}

async function generateManimCode(scenePlanJSON) {
  const messages = [
    {
      role: "system",
      content: `
You are a Manim CE expert programmer.
Return only strict JSON:

{
  "scene_name": "SceneName",
  "manim_code": "Full valid Manim CE Python code string"
}

CRITICAL RULES:
1. Import: from manim import *
2. Class name MUST match scene_name exactly
3. Use Text() for captions, MathTex() only for math equations
4. For MathTex with special symbols:
   - Use single backslash in raw strings: r"M_{\\odot}" NOT r"M_{\\\\odot}"
   - Subscripts need braces: M_{\\odot} not M_\\odot
   - Example: MathTex(r"F = G \\frac{M_1 M_2}{r^2}")
5. Use get_opacity()/set_opacity() methods, not .opacity attribute
6. Do not chain methods after .become()
7. Use self.play() for all animations
8. Use self.wait() between major actions
9. Add captions from scenePlanJSON.captions at bottom of screen
10. Each caption should: Text(cap["text"], font_size=28).to_edge(DOWN)
11. Use Write() for captions with run_time matching duration
12. FadeOut previous caption before showing next one

Example structure:
from manim import *

class SceneName(Scene):
    def construct(self):
        # Create objects
        obj = Circle()
        self.play(Create(obj))
        
        # Show caption
        caption1 = Text("First caption", font_size=28).to_edge(DOWN)
        self.play(Write(caption1), run_time=3)
        self.play(FadeOut(caption1))
        
        # More animations
        self.play(obj.animate.shift(RIGHT))
        self.wait(2)

If fixing code, only change what's broken. Keep working parts unchanged.
`,
    },
  ];

  if (scenePlanJSON.manim_error && scenePlanJSON.previous_code) {
    messages.push({
      role: "user",
      content: `Fix this Manim code. Error:\n${scenePlanJSON.manim_error}\n\nCode:\n${scenePlanJSON.previous_code}\n\nReturn corrected code as JSON. Only fix the error, keep everything else the same.`,
    });
  } else {
    const captionsStr = scenePlanJSON.captions
      ? `\nCaptions (include these in the animation):\n${JSON.stringify(
          scenePlanJSON.captions,
          null,
          2
        )}`
      : "";

    messages.push({
      role: "user",
      content: `Create Manim CE code for this scene:\n${JSON.stringify(
        {
          scene_name: scenePlanJSON.scene_name,
          objects: scenePlanJSON.objects,
          actions: scenePlanJSON.actions,
        },
        null,
        2
      )}${captionsStr}\n\nReturn complete working code as JSON.`,
    });
  }

  return await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    temperature: 0.2,
    messages,
  });
}

/* -------------------- runManim + findLatestMp4 -------------------- */

async function runManim(filePath, sceneName) {
  return new Promise((resolve) => {
    const scriptsPath = join(__dirname, "scripts");
    const venvActivate = join(scriptsPath, "myvenv", "Scripts", "Activate.ps1");

    let output = "";
    let errors = "";
    let finished = false;

    console.log(`🎬 Running Manim:`);
    console.log(`   File: ${filePath}`);
    console.log(`   Scene: ${sceneName}`);
    console.log(`   Venv: ${venvActivate}`);
    console.log(`   Working dir: ${scriptsPath}`);

    const ps = spawn(
      "powershell.exe",
      [
        "-ExecutionPolicy",
        "ByPass",
        "-NoProfile",
        "-Command",
        `cd '${scriptsPath}'; . '${venvActivate}'; manim -pql --media_dir '${join(
          scriptsPath,
          "media"
        )}' '${filePath}' ${sceneName}`,
      ],
      {
        windowsHide: true,
        cwd: scriptsPath,
      }
    );

    ps.stdout.on("data", (d) => {
      const txt = d.toString();
      output += txt;
      console.log("[manim stdout]", txt);
    });
    ps.stderr.on("data", (d) => {
      const txt = d.toString();
      errors += txt;
      console.error("[manim stderr]", txt);
    });

    const timeout = setTimeout(() => {
      if (!finished) {
        console.warn("⏱ Manim timed out; killing process");
        try {
          ps.kill();
        } catch (e) {}
      }
    }, MANIM_TIMEOUT_MS);

    ps.on("close", async (code) => {
      finished = true;
      clearTimeout(timeout);

      console.log(`✅ Manim process exited with code: ${code}`);
      console.log(`📊 Output length: ${output.length} chars`);
      console.log(`📊 Errors length: ${errors.length} chars`);

      console.log(`\n📝 FULL MANIM OUTPUT:\n${output}\n`);
      if (errors) {
        console.log(`\n❌ FULL MANIM ERRORS:\n${errors}\n`);
      }

      const outputLines = output.split("\n");
      let detectedVideoPath = null;

      for (const line of outputLines) {
        if (
          line.includes(".mp4") &&
          (line.includes("File ready") || line.includes("ready at"))
        ) {
          const match = line.match(/['"]([^'"]+\.mp4)['"]/);
          if (match) {
            detectedVideoPath = match[1];
            console.log(
              `🎯 Detected video path from output: ${detectedVideoPath}`
            );
          }
        }
      }

      const mediaRoot = join(scriptsPath, "media", "videos");
      console.log(`🔍 Searching for video in: ${mediaRoot}`);

      let videoPath = null;

      if (detectedVideoPath && fs.existsSync(detectedVideoPath)) {
        videoPath = detectedVideoPath;
        console.log(`✅ Strategy 1: Using detected path from Manim output`);
      }

      if (!videoPath) {
        console.log(`📁 Media root exists: ${fs.existsSync(mediaRoot)}`);

        if (fs.existsSync(mediaRoot)) {
          try {
            const subdirs = await readdir(mediaRoot, { withFileTypes: true });
            console.log(
              `📂 Subdirectories in media/videos:`,
              subdirs.map((d) => d.name)
            );
          } catch (e) {
            console.log(`❌ Error listing subdirs: ${e.message}`);
          }
        }

        try {
          videoPath = await findLatestMp4(mediaRoot, sceneName);
          if (videoPath) {
            console.log(`✅ Strategy 2: Found via findLatestMp4`);
          }
        } catch (err) {
          console.error(`❌ Error in findLatestMp4:`, err);
        }
      }

      if (!videoPath) {
        console.log(`🔍 Strategy 3: Searching entire scripts directory`);
        try {
          const allMp4s = [];

          async function searchDir(dir) {
            try {
              const items = await readdir(dir, { withFileTypes: true });
              for (const item of items) {
                const fullPath = join(dir, item.name);
                if (
                  item.isDirectory() &&
                  !item.name.includes("node_modules") &&
                  !item.name.includes("myvenv")
                ) {
                  await searchDir(fullPath);
                } else if (item.isFile() && item.name.endsWith(".mp4")) {
                  const stats = await stat(fullPath);
                  allMp4s.push({ path: fullPath, mtime: stats.mtimeMs });
                }
              }
            } catch (e) {}
          }

          await searchDir(scriptsPath);

          if (allMp4s.length > 0) {
            allMp4s.sort((a, b) => b.mtime - a.mtime);
            videoPath = allMp4s[0].path;
            console.log(
              `✅ Found ${allMp4s.length} mp4 files, using newest: ${videoPath}`
            );
          }
        } catch (e) {
          console.log(`❌ Strategy 3 failed: ${e.message}`);
        }
      }

      console.log(`🎥 Final video path: ${videoPath}`);

      resolve({
        output,
        errors,
        videoPath: videoPath || null,
        success: code === 0 && !!videoPath,
      });
    });
  });
}

async function findLatestMp4(mediaRoot, sceneName) {
  console.log(`🔍 findLatestMp4 called with:`);
  console.log(`   mediaRoot: ${mediaRoot}`);
  console.log(`   sceneName: ${sceneName}`);

  try {
    const s = await stat(mediaRoot);
    if (!s.isDirectory()) {
      console.log(`❌ mediaRoot is not a directory`);
      return null;
    }
  } catch (err) {
    console.log(`❌ mediaRoot doesn't exist: ${err.message}`);
    return null;
  }

  async function gatherMp4(dir, acc = []) {
    let list;
    try {
      list = await readdir(dir, { withFileTypes: true });
    } catch {
      return acc;
    }
    for (const ent of list) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        await gatherMp4(full, acc);
      } else if (ent.isFile() && ent.name.toLowerCase().endsWith(".mp4")) {
        console.log(`   📹 Found mp4: ${full}`);
        acc.push(full);
      }
    }
    return acc;
  }

  let candidates = [];

  const possibleQualityFolders = ["480p15", "720p30", "1080p60", "2160p60"];

  for (const quality of possibleQualityFolders) {
    const qualityPath = join(mediaRoot, sceneName, quality);
    console.log(`🔍 Checking quality folder: ${qualityPath}`);

    if (fs.existsSync(qualityPath)) {
      const videosInQuality = await gatherMp4(qualityPath, []);
      candidates.push(...videosInQuality);
      console.log(`   Found ${videosInQuality.length} videos in ${quality}`);
    }
  }

  const sceneFolder = join(mediaRoot, sceneName);
  console.log(`🔍 Checking scene folder: ${sceneFolder}`);

  try {
    const sceneFolderExists = fs.existsSync(sceneFolder);
    console.log(`   Scene folder exists: ${sceneFolderExists}`);

    if (sceneFolderExists) {
      const sceneFolderVideos = await gatherMp4(sceneFolder, []);
      candidates.push(...sceneFolderVideos);
      console.log(
        `   Found ${sceneFolderVideos.length} videos in scene folder`
      );
    }
  } catch (err) {
    console.log(`   Error checking scene folder: ${err.message}`);
  }

  if (!candidates.length) {
    console.log(`🔍 Searching entire media root...`);
    candidates = await gatherMp4(mediaRoot, []);
    console.log(`   Found ${candidates.length} total videos`);
  }

  if (!candidates.length) {
    console.log(`❌ No mp4 files found`);
    return null;
  }

  let newest = null;
  let newestMtime = 0;
  for (const f of candidates) {
    try {
      const s = await stat(f);
      if (s.mtimeMs > newestMtime) {
        newestMtime = s.mtimeMs;
        newest = f;
      }
    } catch {}
  }

  console.log(`✅ Newest video: ${newest}`);
  return newest;
}

/* -------------------- 11Labs TTS -------------------- */

async function generateNepaliVoice(text) {
  if (!ELEVENLABS_KEY) throw new Error("ELEVENLABS_API_KEY not set in .env");
  if (!text || text.trim().length === 0) {
    throw new Error("Cannot generate voice for empty text");
  }

  const scriptsPath = join(__dirname, "scripts");
  await mkdir(scriptsPath, { recursive: true });
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

/* -------------------- Verify Audio File -------------------- */
async function verifyAudioFile(audioPath) {
  return new Promise((resolve) => {
    const ffprobe = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration,size,bit_rate",
      "-show_entries",
      "stream=codec_name,sample_rate,channels",
      "-of",
      "json",
      audioPath,
    ]);

    let output = "";
    let error = "";

    ffprobe.stdout.on("data", (d) => {
      output += d.toString();
    });

    ffprobe.stderr.on("data", (d) => {
      error += d.toString();
    });

    ffprobe.on("close", (code) => {
      if (code === 0) {
        try {
          const info = JSON.parse(output);
          console.log(`🔍 Audio file info:`, JSON.stringify(info, null, 2));

          const duration = parseFloat(info.format?.duration || 0);
          if (duration === 0) {
            console.warn("⚠️ Audio file has 0 duration!");
          } else {
            console.log(`✅ Audio duration: ${duration.toFixed(2)}s`);
          }

          resolve(info);
        } catch (e) {
          console.warn("⚠️ Could not parse ffprobe output:", e.message);
          resolve(null);
        }
      } else {
        console.warn(`⚠️ ffprobe failed (code ${code}):`, error);
        resolve(null);
      }
    });
  });
}

/* -------------------- Get Media Duration Helper -------------------- */
async function getMediaDuration(mediaPath) {
  return new Promise((resolve) => {
    const ffprobe = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      mediaPath,
    ]);

    let output = "";

    ffprobe.stdout.on("data", (d) => {
      output += d.toString();
    });

    ffprobe.on("close", (code) => {
      if (code === 0) {
        const duration = parseFloat(output.trim());
        resolve(isNaN(duration) ? 0 : duration);
      } else {
        resolve(0);
      }
    });
  });
}

/* -------------------- IMPROVED FFMPEG Merge -------------------- */
async function mergeVideoAndAudio(videoPath, audioPath) {
  if (!videoPath || !fs.existsSync(videoPath))
    throw new Error("Video not found for merging: " + videoPath);
  if (!audioPath || !fs.existsSync(audioPath))
    throw new Error("Audio not found for merging: " + audioPath);

  const outDir = join(__dirname, "scripts", "outputs");
  await mkdir(outDir, { recursive: true });
  const outFile = join(outDir, `final_${Date.now()}.mp4`);

  console.log(`🎬 Merging video and audio:`);
  console.log(`   Video: ${videoPath}`);
  console.log(`   Audio: ${audioPath}`);
  console.log(`   Output: ${outFile}`);

  // Get duration of both files first
  const videoDuration = await getMediaDuration(videoPath);
  const audioDuration = await getMediaDuration(audioPath);

  console.log(`📊 Video duration: ${videoDuration?.toFixed(2)}s`);
  console.log(`📊 Audio duration: ${audioDuration?.toFixed(2)}s`);

  // Check if video actually has no audio stream (silent video)
  const videoHasAudio = await checkHasAudioStream(videoPath);
  console.log(`🔊 Video has audio stream: ${videoHasAudio}`);

  return new Promise((resolve, reject) => {
    let ffmpegArgs;

    if (audioDuration > videoDuration + 0.5) {
      // Audio is longer - trim audio to match video
      console.log("🎵 Audio is longer than video - will trim audio");
      ffmpegArgs = [
        "-y",
        "-i",
        videoPath,
        "-i",
        audioPath,
        "-t",
        videoDuration.toString(),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        outFile,
      ];
    } else if (videoDuration > audioDuration + 0.5) {
      // Video is longer - pad audio with silence
      console.log(
        "🎬 Video is longer than audio - will pad audio with silence"
      );
      ffmpegArgs = [
        "-y",
        "-i",
        videoPath,
        "-i",
        audioPath,
        "-filter_complex",
        `[1:a]apad=whole_dur=${videoDuration}[a]`,
        "-map",
        "0:v:0",
        "-map",
        "[a]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        outFile,
      ];
    } else {
      // Durations match closely
      console.log("✅ Video and audio durations match");
      ffmpegArgs = [
        "-y",
        "-i",
        videoPath,
        "-i",
        audioPath,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        outFile,
      ];
    }

    console.log(`🔧 FFmpeg command: ffmpeg ${ffmpegArgs.join(" ")}`);

    const ff = spawn("ffmpeg", ffmpegArgs);

    let stdout = "";
    let stderr = "";

    ff.stdout.on("data", (d) => {
      stdout += d.toString();
    });

    ff.stderr.on("data", (d) => {
      stderr += d.toString();
      const text = d.toString();
      // Show progress
      if (text.includes("time=") || text.includes("speed=")) {
        process.stdout.write(".");
      }
    });

    ff.on("close", async (code) => {
      console.log("\n");

      if (code === 0 && fs.existsSync(outFile)) {
        // Verify output has audio
        const finalHasAudio = await checkHasAudioStream(outFile);
        const stats = await stat(outFile);

        console.log(`✅ Final video created successfully`);
        console.log(`   Path: ${outFile}`);
        console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   Has audio: ${finalHasAudio}`);

        if (!finalHasAudio) {
          console.warn(
            "⚠️ WARNING: Final video does not have an audio stream!"
          );
          console.warn("   This might indicate an ffmpeg issue.");
          console.warn("   Full stderr output:");
          console.warn(stderr);
        }

        resolve(outFile);
      } else {
        console.error("❌ FFmpeg merge failed");
        console.error(`   Exit code: ${code}`);
        console.error(`   Error output:\n${stderr}`);
        reject(new Error(`ffmpeg merge failed with code ${code}\n${stderr}`));
      }
    });

    ff.on("error", (err) => {
      console.error("❌ FFmpeg spawn error:", err.message);
      reject(err);
    });
  });
}

/* -------------------- Check if file has audio stream -------------------- */
async function checkHasAudioStream(filePath) {
  return new Promise((resolve) => {
    const ffprobe = spawn("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "a",
      "-show_entries",
      "stream=codec_type",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);

    let output = "";

    ffprobe.stdout.on("data", (d) => {
      output += d.toString();
    });

    ffprobe.on("close", (code) => {
      // If there's any output, it means there's an audio stream
      resolve(output.trim().length > 0);
    });

    ffprobe.on("error", () => {
      resolve(false);
    });
  });
}
