import { spawn } from "child_process";
import fs from "fs";
import { readdir, stat } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MANIM_TIMEOUT_MS = parseInt(process.env.MANIM_TIMEOUT_MS || "120000");

export async function runManim(filePath, sceneName) {
  return new Promise((resolve) => {
    const scriptsPath = join(__dirname, "..", "scripts");
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
          const match = line.match(/['"]([^'\"]+\.mp4)['"]/);
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

export async function findLatestMp4(mediaRoot, sceneName) {
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
