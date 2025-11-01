/**
 * AI Video Generator Backend (single file)
 * ----------------------------------------
 * Groq (LLM) -> Manim CE (auto-fix loop) -> ElevenLabs TTS -> ffmpeg merge
 *
 * Requirements:
 * - .env with GROQ_API_KEY and ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID
 * - A Python venv with manim installed at ./scripts/myvenv (Activate.ps1 for Windows)
 * - ffmpeg available in PATH
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
const MANIM_TIMEOUT_MS = parseInt(process.env.MANIM_TIMEOUT_MS || "120000"); // default 2 min

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => res.send("✅ AI Video Generator Backend Running"));

/**
 * Debug endpoint to test Manim manually
 */
app.post("/testManim", async (req, res) => {
  try {
    const scriptsPath = join(__dirname, "scripts");

    // Create a simple test scene
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
 * Main route
 */
app.post("/generateVideo", async (req, res) => {
  try {
    const { description } = req.body;
    if (!description)
      return res.status(400).json({ error: "Description is required" });

    // 1) Scene plan with narration
    const scenePlan = await feedbackLoop(generateScenePlan, description);
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

    // 3) Generate Nepali voice using the narration from scene plan
    const narrationText = scenePlan.narration || description;
    console.log("🎤 Generating voice for:", narrationText);
    const voicePath = await generateNepaliVoice(narrationText);

    // 4) Merge video + audio (enhanced version)
    console.log("🎬 Merging video and audio...");
    const finalVideoPath = await mergeVideoAndAudio(
      fixedCodeResult.videoPath,
      voicePath,
      {
        outputName: `${scenePlan.scene_name}_final_${Date.now()}.mp4`,
        audioBitrate: 192,
      }
    );

    res.json({
      status: "success",
      scenePlan,
      manimCode: fixedCodeResult.manimCode,
      finalVideo: finalVideoPath,
      voice: voicePath,
      manimOutput: fixedCodeResult.output,
      manimErrors: fixedCodeResult.errors,
      attempts: fixedCodeResult.attempts,
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
   CORE: generateUntilNoManimErrors -> feedbackLoop -> runManim -> findLatestMp4
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

    // A: Generate code (with JSON feedback loop)
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

    // Save script
    const filePath = join(scriptsPath, `${scenePlan.scene_name}.py`);
    await writeFile(filePath, manimCodeJSON.manim_code, "utf-8");

    console.log(`💾 Saved Manim code to: ${filePath}`);
    console.log(
      `📝 Code preview (first 500 chars):\n${manimCodeJSON.manim_code.substring(
        0,
        500
      )}...`
    );

    // B: Run Manim and attempt to find produced mp4
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

    // C: Prepare for correction - include limited error & previous code
    scenePlan = {
      ...scenePlan,
      previous_code: manimCodeJSON.manim_code,
      manim_error: (manimResult.errors || "").slice(0, 2000),
      manim_video_missing: !hasVideo,
    };

    // small delay before retrying
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

/* -------------------- feedbackLoop -------------------- */
/**
 * Repeatedly calls generateFn(input) and parses returned JSON content.
 * Expects generateFn to return an LLM response object (with choices[0].message.content).
 */
async function feedbackLoop(generateFn, input, maxRetries = 3) {
  let lastRawContent = "";
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const aiResponse = await generateFn(input);
      const content = aiResponse.choices?.[0]?.message?.content || "";
      lastRawContent = content.trim();

      // strip triple-backtick fences if present
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
      // Build a concise repair prompt as next input
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

async function generateScenePlan(description) {
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
  "narration": "Clear, educational narration text that explains the concept (in English or Nepali as appropriate)",
  "captions": [
    {"text": "Caption 1", "start_time": 0, "duration": 3},
    {"text": "Caption 2", "start_time": 3, "duration": 4}
  ]
}

Captions should sync with the narration timing and be concise.
`,
      },
      {
        role: "user",
        content: `Create a scene plan with narration and captions for: "${description}". Return ONLY JSON.`,
      },
    ],
  });
}

/**
 * When scenePlanJSON includes manim_error and previous_code, the model should fix the code.
 */
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

/**
 * Spawns a PowerShell process that activates the venv and runs manim.
 * Finds the newest mp4 under scripts/media/videos (prefer sceneName folder).
 * Adds a timeout to avoid indefinite hangs.
 */
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

    // Use -o flag to specify output directory explicitly
    const outputDir = join(scriptsPath, "media", "videos", sceneName);

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

    // collect logs
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

    // safety timeout
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

      // Log actual output to see what happened
      console.log(`\n📝 FULL MANIM OUTPUT:\n${output}\n`);
      if (errors) {
        console.log(`\n❌ FULL MANIM ERRORS:\n${errors}\n`);
      }

      // Manim might output the video path in its logs
      // Look for patterns like "File ready at" or ".mp4"
      const outputLines = output.split("\n");
      let detectedVideoPath = null;

      for (const line of outputLines) {
        if (
          line.includes(".mp4") &&
          (line.includes("File ready") || line.includes("ready at"))
        ) {
          // Extract path from line
          const match = line.match(/['"]([^'"]+\.mp4)['"]/);
          if (match) {
            detectedVideoPath = match[1];
            console.log(
              `🎯 Detected video path from output: ${detectedVideoPath}`
            );
          }
        }
      }

      // Try multiple search strategies
      const mediaRoot = join(scriptsPath, "media", "videos");
      console.log(`🔍 Searching for video in: ${mediaRoot}`);

      let videoPath = null;

      // Strategy 1: Check if detected path exists
      if (detectedVideoPath && fs.existsSync(detectedVideoPath)) {
        videoPath = detectedVideoPath;
        console.log(`✅ Strategy 1: Using detected path from Manim output`);
      }

      // Strategy 2: Use findLatestMp4
      if (!videoPath) {
        console.log(`📁 Media root exists: ${fs.existsSync(mediaRoot)}`);

        if (fs.existsSync(mediaRoot)) {
          // List all subdirectories
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

      // Strategy 3: Search entire scripts directory for any new mp4
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
            // Sort by modification time
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

/**
 * Recursively gather mp4 files and return the newest one.
 * Prefer the folder mediaRoot/sceneName if it exists.
 */
async function findLatestMp4(mediaRoot, sceneName) {
  console.log(`🔍 findLatestMp4 called with:`);
  console.log(`   mediaRoot: ${mediaRoot}`);
  console.log(`   sceneName: ${sceneName}`);

  // ensure mediaRoot exists
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

  // helper recursion
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

  // try scene folder first with quality subfolder
  let candidates = [];

  // Manim creates videos in mediaRoot/sceneName/quality/sceneName.mp4
  // Quality folders: 480p15, 720p30, 1080p60, etc.
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

  // Also check scene folder root
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

  // if none, search whole mediaRoot
  if (!candidates.length) {
    console.log(`🔍 Searching entire media root...`);
    candidates = await gatherMp4(mediaRoot, []);
    console.log(`   Found ${candidates.length} total videos`);
  }

  if (!candidates.length) {
    console.log(`❌ No mp4 files found`);
    return null;
  }

  // pick most recently modified
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
/**
 * Generate Nepali voice using ElevenLabs (11labs) API.
 * Expects ELEVENLABS_KEY and ELEVENLABS_VOICE_ID env vars.
 */
async function generateNepaliVoice(text) {
  if (!ELEVENLABS_KEY) throw new Error("ELEVENLABS_API_KEY not set in .env");

  const scriptsPath = join(__dirname, "scripts");
  await mkdir(scriptsPath, { recursive: true });
  const outputPath = join(scriptsPath, `voice_${Date.now()}.mp3`);

  const voiceId = ELEVENLABS_VOICE_ID;

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const payload = {
    text,
    model_id: "eleven_multilingual_v2",
    voice_settings: { stability: 0.5, similarity_boost: 0.75 },
  };

  console.log(`🎤 Requesting TTS from ElevenLabs for voice ID: ${voiceId}`);

  const resp = await axios.post(url, payload, {
    headers: {
      "xi-api-key": ELEVENLABS_KEY,
      "Content-Type": "application/json",
    },
    responseType: "arraybuffer",
    timeout: 120000,
  });

  await writeFile(outputPath, Buffer.from(resp.data));
  console.log(`✅ Voice generated at: ${outputPath}`);
  return outputPath;
}

/* ==================================================================================
   ENHANCED FFMPEG MERGE FUNCTIONS
   ================================================================================== */

/**
 * Enhanced function to merge video and audio using ffmpeg
 *
 * @param {string} videoPath - Path to the video file
 * @param {string} audioPath - Path to the audio file
 * @param {Object} options - Optional configuration
 * @param {string} options.outputDir - Custom output directory (default: scripts/outputs)
 * @param {string} options.outputName - Custom output filename (default: final_TIMESTAMP.mp4)
 * @param {string} options.videoCodec - Video codec (default: 'copy' for no re-encoding)
 * @param {string} options.audioCodec - Audio codec (default: 'aac')
 * @param {boolean} options.shortest - Use shortest stream (default: true)
 * @param {number} options.audioBitrate - Audio bitrate in kbps (default: 192)
 * @returns {Promise<string>} Path to the merged video file
 */
async function mergeVideoAndAudio(videoPath, audioPath, options = {}) {
  const {
    outputDir = join(__dirname, "scripts", "outputs"),
    outputName = `final_${Date.now()}.mp4`,
    videoCodec = "copy",
    audioCodec = "aac",
    shortest = true,
    audioBitrate = 192,
  } = options;

  // Validate inputs
  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }
  if (!audioPath || !fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });

  const outFile = join(outputDir, outputName);

  console.log(`🎬 Merging video and audio:`);
  console.log(`   📹 Video: ${videoPath}`);
  console.log(`   🎤 Audio: ${audioPath}`);
  console.log(`   💾 Output: ${outFile}`);

  return new Promise((resolve, reject) => {
    const ffmpegArgs = [
      "-y", // Overwrite output file
      "-i",
      videoPath, // Input video
      "-i",
      audioPath, // Input audio
      "-map",
      "0:v:0", // Map video from first input
      "-map",
      "1:a:0", // Map audio from second input
      "-c:v",
      videoCodec, // Video codec
      "-c:a",
      audioCodec, // Audio codec
    ];

    // Add audio bitrate if not copying
    if (audioCodec !== "copy") {
      ffmpegArgs.push("-b:a", `${audioBitrate}k`);
    }

    // Use shortest stream to avoid issues with different lengths
    if (shortest) {
      ffmpegArgs.push("-shortest");
    }

    ffmpegArgs.push(outFile);

    console.log(`🔧 Running ffmpeg with args: ${ffmpegArgs.join(" ")}`);

    const ff = spawn("ffmpeg", ffmpegArgs);

    let stdout = "";
    let stderr = "";

    ff.stdout.on("data", (data) => {
      const text = data.toString();
      stdout += text;
      console.log("[ffmpeg stdout]", text);
    });

    ff.stderr.on("data", (data) => {
      const text = data.toString();
      stderr += text;
      // ffmpeg outputs progress to stderr
      if (text.includes("time=") || text.includes("frame=")) {
        process.stdout.write(`\r${text.trim()}`);
      }
    });

    ff.on("error", (error) => {
      reject(new Error(`Failed to start ffmpeg: ${error.message}`));
    });

    ff.on("close", (code) => {
      console.log(); // New line after progress output

      if (code === 0) {
        // Verify output file exists and has size > 0
        if (fs.existsSync(outFile)) {
          const stats = fs.statSync(outFile);
          if (stats.size > 0) {
            console.log(`✅ Successfully merged video and audio`);
            console.log(
              `   📊 Output size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`
            );
            console.log(`   📍 Location: ${outFile}`);
            resolve(outFile);
          } else {
            reject(new Error("Output file created but has zero size"));
          }
        } else {
          reject(new Error("Output file was not created"));
        }
      } else {
        const errorMsg = `ffmpeg exited with code ${code}\n${stderr}`;
        console.error(`❌ ${errorMsg}`);
        reject(new Error(errorMsg));
      }
    });
  });
}

/**
 * Alternative: Merge with audio volume adjustment
 * Useful when audio is too loud or too quiet
 *
 * @param {string} videoPath - Path to the video file
 * @param {string} audioPath - Path to the audio file
 * @param {number} volumeLevel - Volume multiplier (1.0 = 100%, 0.5 = 50%, 2.0 = 200%)
 * @param {Object} options - Optional configuration
 * @returns {Promise<string>} Path to the merged video file
 */
async function mergeVideoAndAudioWithVolume(
  videoPath,
  audioPath,
  volumeLevel = 1.0,
  options = {}
) {
  const {
    outputDir = join(__dirname, "scripts", "outputs"),
    outputName = `final_volume_${Date.now()}.mp4`,
  } = options;

  // Validate inputs
  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }
  if (!audioPath || !fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  await mkdir(outputDir, { recursive: true });
  const outFile = join(outputDir, outputName);

  console.log(`🎬 Merging with volume adjustment (${volumeLevel}x):`);
  console.log(`   📹 Video: ${videoPath}`);
  console.log(`   🎤 Audio: ${audioPath}`);
  console.log(`   💾 Output: ${outFile}`);

  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-y",
      "-i",
      videoPath,
      "-i",
      audioPath,
      "-filter_complex",
      `[1:a]volume=${volumeLevel}[a]`,
      "-map",
      "0:v:0",
      "-map",
      "[a]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-shortest",
      outFile,
    ]);

    let stderr = "";

    ff.stderr.on("data", (data) => {
      const text = data.toString();
      stderr += text;
      if (text.includes("time=")) {
        process.stdout.write(`\r${text.trim()}`);
      }
    });

    ff.on("close", (code) => {
      console.log();
      if (code === 0 && fs.existsSync(outFile)) {
        console.log(
          `✅ Successfully merged with volume adjustment: ${outFile}`
        );
        resolve(outFile);
      } else {
        reject(new Error(`ffmpeg failed with code ${code}\n${stderr}`));
      }
    });
  });
}

/**
 * Alternative: Merge and add fade in/out effects to audio
 * Creates professional-sounding transitions
 *
 * @param {string} videoPath - Path to the video file
 * @param {string} audioPath - Path to the audio file
 * @param {number} fadeInDuration - Fade in duration in seconds (default: 0.5)
 * @param {number} fadeOutDuration - Fade out duration in seconds (default: 0.5)
 * @param {Object} options - Optional configuration
 * @returns {Promise<string>} Path to the merged video file
 */
async function mergeVideoAndAudioWithFade(
  videoPath,
  audioPath,
  fadeInDuration = 0.5,
  fadeOutDuration = 0.5,
  options = {}
) {
  const {
    outputDir = join(__dirname, "scripts", "outputs"),
    outputName = `final_fade_${Date.now()}.mp4`,
  } = options;

  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }
  if (!audioPath || !fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  await mkdir(outputDir, { recursive: true });
  const outFile = join(outputDir, outputName);

  console.log(`🎬 Merging with audio fade effects:`);
  console.log(`   📹 Video: ${videoPath}`);
  console.log(`   🎤 Audio: ${audioPath}`);
  console.log(
    `   ⏱️  Fade in: ${fadeInDuration}s, Fade out: ${fadeOutDuration}s`
  );
  console.log(`   💾 Output: ${outFile}`);

  return new Promise((resolve, reject) => {
    // First, get video duration
    const ffprobe = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ]);

    let duration = "";
    ffprobe.stdout.on("data", (data) => {
      duration += data.toString();
    });

    ffprobe.on("close", () => {
      const durationSec = parseFloat(duration.trim());
      const fadeOutStart = Math.max(0, durationSec - fadeOutDuration);

      console.log(`   📊 Video duration: ${durationSec.toFixed(2)}s`);

      const ff = spawn("ffmpeg", [
        "-y",
        "-i",
        videoPath,
        "-i",
        audioPath,
        "-filter_complex",
        `[1:a]afade=t=in:st=0:d=${fadeInDuration},afade=t=out:st=${fadeOutStart}:d=${fadeOutDuration}[a]`,
        "-map",
        "0:v:0",
        "-map",
        "[a]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-shortest",
        outFile,
      ]);

      let stderr = "";

      ff.stderr.on("data", (data) => {
        const text = data.toString();
        stderr += text;
        if (text.includes("time=")) {
          process.stdout.write(`\r${text.trim()}`);
        }
      });

      ff.on("close", (code) => {
        console.log();
        if (code === 0 && fs.existsSync(outFile)) {
          console.log(`✅ Successfully merged with fade effects: ${outFile}`);
          resolve(outFile);
        } else {
          reject(new Error(`ffmpeg failed with code ${code}\n${stderr}`));
        }
      });
    });

    ffprobe.on("error", (error) => {
      reject(new Error(`Failed to get video duration: ${error.message}`));
    });
  });
}

/**
 * Advanced: Merge video and audio with custom audio filters
 * Allows for complex audio processing
 *
 * @param {string} videoPath - Path to the video file
 * @param {string} audioPath - Path to the audio file
 * @param {string} audioFilter - Custom ffmpeg audio filter string
 * @param {Object} options - Optional configuration
 * @returns {Promise<string>} Path to the merged video file
 */
async function mergeVideoAndAudioWithFilter(
  videoPath,
  audioPath,
  audioFilter,
  options = {}
) {
  const {
    outputDir = join(__dirname, "scripts", "outputs"),
    outputName = `final_custom_${Date.now()}.mp4`,
  } = options;

  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }
  if (!audioPath || !fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  await mkdir(outputDir, { recursive: true });
  const outFile = join(outputDir, outputName);

  console.log(`🎬 Merging with custom audio filter:`);
  console.log(`   📹 Video: ${videoPath}`);
  console.log(`   🎤 Audio: ${audioPath}`);
  console.log(`   🎛️  Filter: ${audioFilter}`);
  console.log(`   💾 Output: ${outFile}`);

  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-y",
      "-i",
      videoPath,
      "-i",
      audioPath,
      "-filter_complex",
      `[1:a]${audioFilter}[a]`,
      "-map",
      "0:v:0",
      "-map",
      "[a]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-shortest",
      outFile,
    ]);

    let stderr = "";

    ff.stderr.on("data", (data) => {
      const text = data.toString();
      stderr += text;
      if (text.includes("time=")) {
        process.stdout.write(`\r${text.trim()}`);
      }
    });

    ff.on("close", (code) => {
      console.log();
      if (code === 0 && fs.existsSync(outFile)) {
        console.log(`✅ Successfully merged with custom filter: ${outFile}`);
        resolve(outFile);
      } else {
        reject(new Error(`ffmpeg failed with code ${code}\n${stderr}`));
      }
    });
  });
}
