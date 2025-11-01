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
import { writeFile, mkdir, readdir, stat, unlink } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import fs from "fs";
import axios from "axios";
import { ensureAudioForMerge, cleanupTempAudioFiles } from "./lib/audio.js";
import { generateNepaliVoice, verifyAudioFile } from "./lib/tts.js";

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

// Serve generated outputs (op.mp4 etc.) from project-level ./output
try {
  const outputsStatic = join(__dirname, "..", "output");
  if (!fs.existsSync(outputsStatic)) {
    // create so express.static won't fail later
    await mkdir(outputsStatic, { recursive: true });
  }
  app.use("/output", express.static(outputsStatic));
  console.log(`ℹ️ Serving output files from: ${outputsStatic} at /output`);
} catch (e) {
  console.warn(`⚠️ Could not set up static output serving: ${e.message}`);
}

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

    const scenePlan = await feedbackLoop(generateScenePlan, {
      description,
      language: targetLanguage,
    });
    if (!scenePlan.scene_name) throw new Error("Scene plan generation failed");

    console.log("📝 Scene plan generated:", JSON.stringify(scenePlan, null, 2));

    const fixedCodeResult = await generateUntilNoManimErrors(scenePlan);

    if (!fixedCodeResult.videoPath) {
      return res.status(500).json({
        status: "error",
        message: "Manim did not produce a video after retries",
        details: fixedCodeResult.errors,
        attempts: fixedCodeResult.attempts,
      });
    }

    const narrationText = scenePlan.narration || description;
    console.log("🎤 Generating voice for:", narrationText);
    console.log(`📝 Narration language: ${targetLanguage}`);

    const voicePath = await generateNepaliVoice(narrationText);

    console.log("🎬 Merging video and audio...");
    const finalVideoPath = await mergeVideoAndAudio(
      fixedCodeResult.videoPath,
      voicePath,
      {
        outputName: `${scenePlan.scene_name}_final_${Date.now()}.mp4`,
        audioBitrate: 192,
      }
    );

    let opPath = null;
    try {
      const projectOutputDir = join(__dirname, "..", "output");
      await mkdir(projectOutputDir, { recursive: true });
      opPath = join(projectOutputDir, "op.mp4");

      const audioToUseForOp = await ensureAudioForMerge(
        fixedCodeResult.videoPath,
        voicePath,
        projectOutputDir
      );

      console.log(`🔁 Creating fallback combined file at: ${opPath}`);

      await new Promise((resolve, reject) => {
        // Transcode into H.264 + AAC for broad browser compatibility
        const ff = spawn("ffmpeg", [
          "-y",
          "-i",
          fixedCodeResult.videoPath,
          "-i",
          audioToUseForOp,
          // ensure output is H.264 (widely supported) and audio is AAC
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-pix_fmt",
          "yuv420p",
          "-profile:v",
          "high",
          "-level",
          "4.0",
          "-movflags",
          "+faststart",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          opPath,
        ]);

        let stderr = "";
        ff.stderr.on("data", (d) => {
          const txt = d.toString();
          stderr += txt;
          if (txt.includes("time=") || txt.includes("frame="))
            process.stdout.write(`\r${txt.trim()}`);
        });

        ff.on("error", (err) => reject(err));
        ff.on("close", (code) => {
          console.log();
          if (code === 0 && fs.existsSync(opPath)) {
            console.log(`✅ Wrote op file: ${opPath}`);
            // cleanup temp audio files used for op generation
            try {
              const opDir = projectOutputDir;
              cleanupTempAudioFiles(opDir).catch(() => {});
            } catch (e) {}
            resolve();
          } else {
            reject(new Error(`ffmpeg failed (${code})\n${stderr}`));
          }
        });
      });
    } catch (e) {
      console.error(`❌ Failed to create ./output/op.mp4: ${e.message}`);
      opPath = null;
    }

    // --- AI feedback generation (optional, post-processing)
    let feedbackJSON = { summary: null };
    let feedbackVideoPath = null;
    let feedbackAudioPath = null;
    try {
      console.log("🧠 Generating AI feedback on video...");

      const feedbackPrompt = `
You are an AI video critique assistant.
The following scene was generated based on the description below.
Provide a JSON object with clear, structured feedback including:
1. \"summary\": concise explanation of what the video covers
2. \"visual_feedback\": how the visuals could be improved
3. \"narration_feedback\": how the narration could be made more engaging
4. \"manim_code\": a short Manim scene visualizing your feedback or a related concept (if relevant)

Return only valid JSON.

DESCRIPTION: ${description}
SCENE PLAN: ${JSON.stringify(scenePlan, null, 2)}
`;

      const feedbackResp = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content: "You are a precise and structured JSON-only responder.",
          },
          { role: "user", content: feedbackPrompt },
        ],
      });

      try {
        const raw = feedbackResp.choices?.[0]?.message?.content || "";
        const clean = raw.replace(/^```json\n?/, "").replace(/```$/, "");
        feedbackJSON = JSON.parse(clean);
        console.log("🧠 Feedback generated successfully:", feedbackJSON);
      } catch (err) {
        console.warn("⚠️ Failed to parse feedback JSON, storing raw response.");
        feedbackJSON = {
          summary: null,
          raw: feedbackResp.choices?.[0]?.message?.content || "",
        };
      }

      // Optional: render feedback into a Manim scene if manim_code present
      if (feedbackJSON.manim_code) {
        try {
          const fbFilePath = join(
            __dirname,
            "scripts",
            `FeedbackScene_${Date.now()}.py`
          );
          await writeFile(fbFilePath, feedbackJSON.manim_code, "utf-8");

          // attempt to detect class name from the provided code
          const classMatch = (feedbackJSON.manim_code || "").match(
            /class\s+([A-Za-z0-9_]+)\s*\(/
          );
          const sceneNameForFb = classMatch ? classMatch[1] : "FeedbackScene";

          const fbResult = await runManim(fbFilePath, sceneNameForFb);
          feedbackVideoPath = fbResult.videoPath || null;
        } catch (e) {
          console.error("❌ Failed to render feedback Manim scene:", e.message);
          feedbackVideoPath = null;
        }
      }

      // Optional: generate voice for the feedback summary
      if (feedbackJSON.summary) {
        try {
          feedbackAudioPath = await generateNepaliVoice(feedbackJSON.summary);
        } catch (e) {
          console.error("❌ Failed to generate feedback audio:", e.message);
          feedbackAudioPath = null;
        }
      }
    } catch (e) {
      console.error("❌ Feedback generation failed:", e.message || e);
      feedbackJSON = { summary: null };
    }

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
      feedback: feedbackJSON,
      feedbackVideo: feedbackVideoPath,
      feedbackAudio: feedbackAudioPath,
      opPath,
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

// TTS helpers moved to server/lib/tts.js (generateNepaliVoice, verifyAudioFile)

// Audio helpers are implemented in server/lib/audio.js and TTS helpers in server/lib/tts.js

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

  // Validate video exists
  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  // Prepare output dir and ensure audio matches video duration
  await mkdir(outputDir, { recursive: true });
  const outFile = join(outputDir, outputName);
  const audioToUse = await ensureAudioForMerge(videoPath, audioPath, outputDir);

  console.log(`🎬 Merging video and audio (prepared audio):`);
  console.log(`   📹 Video: ${videoPath}`);
  console.log(`   🎤 Audio: ${audioToUse}`);
  console.log(`   💾 Output: ${outFile}`);

  return new Promise((resolve, reject) => {
    const ffmpegArgs = [
      "-y",
      "-i",
      videoPath,
      "-i",
      audioToUse,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      videoCodec,
      "-c:a",
      audioCodec,
    ];

    if (audioCodec !== "copy") ffmpegArgs.push("-b:a", `${audioBitrate}k`);
    // audio already matches video duration; shortest is safe but optional
    if (shortest) ffmpegArgs.push("-shortest");
    ffmpegArgs.push(outFile);

    console.log(`🔧 Running ffmpeg with args: ${ffmpegArgs.join(" ")}`);

    const ff = spawn("ffmpeg", ffmpegArgs);
    let stderr = "";
    ff.stderr.on("data", (data) => {
      const text = data.toString();
      stderr += text;
      if (text.includes("time=") || text.includes("frame="))
        process.stdout.write(`\r${text.trim()}`);
    });
    ff.on("error", (error) =>
      reject(new Error(`Failed to start ffmpeg: ${error.message}`))
    );
    ff.on("close", (code) => {
      console.log();
      if (code === 0 && fs.existsSync(outFile)) {
        const stats = fs.statSync(outFile);
        if (stats.size > 0) {
          // attempt cleanup of temp audio files in outputDir
          try {
            cleanupTempAudioFiles(outputDir).catch(() => {});
          } catch (e) {}
          console.log(`✅ Successfully merged video and audio`);
          console.log(
            `   📊 Output size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`
          );
          console.log(`   📍 Location: ${outFile}`);
          resolve(outFile);
        } else reject(new Error("Output file created but has zero size"));
      } else {
        reject(new Error(`ffmpeg exited with code ${code}\n${stderr}`));
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

  await mkdir(outputDir, { recursive: true });
  const outFile = join(outputDir, outputName);
  const audioToUse = await ensureAudioForMerge(videoPath, audioPath, outputDir);

  console.log(`🎬 Merging with volume adjustment (${volumeLevel}x):`);
  console.log(`   📹 Video: ${videoPath}`);
  console.log(`   🎤 Audio: ${audioToUse}`);
  console.log(`   💾 Output: ${outFile}`);

  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-y",
      "-i",
      videoPath,
      "-i",
      audioToUse,
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

  await mkdir(outputDir, { recursive: true });
  const outFile = join(outputDir, outputName);
  const audioToUse = await ensureAudioForMerge(videoPath, audioPath, outputDir);

  console.log(`🎬 Merging with audio fade effects:`);
  console.log(`   📹 Video: ${videoPath}`);
  console.log(`   🎤 Audio: ${audioToUse}`);
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
        audioToUse,
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

  await mkdir(outputDir, { recursive: true });
  const outFile = join(outputDir, outputName);
  const audioToUse = await ensureAudioForMerge(videoPath, audioPath, outputDir);

  console.log(`🎬 Merging with custom audio filter:`);
  console.log(`   📹 Video: ${videoPath}`);
  console.log(`   🎤 Audio: ${audioToUse}`);
  console.log(`   🎛️  Filter: ${audioFilter}`);
  console.log(`   💾 Output: ${outFile}`);

  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-y",
      "-i",
      videoPath,
      "-i",
      audioToUse,
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
