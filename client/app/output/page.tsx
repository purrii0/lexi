"use client";

import { useState } from "react";
import styles from "./styles.module.css";

export default function OutputPage() {
  const [description, setDescription] = useState("");
  const [language, setLanguage] = useState("nepali");
  const [status, setStatus] = useState("idle");
  const [progressText, setProgressText] = useState("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setStatus("starting");
    setProgressText("Starting generation...");
    setVideoUrl(null);

    try {
      setStatus("rendering");
      setProgressText("Calling backend to generate scene + narration...");

      const resp = await fetch("http://localhost:4000/generateVideo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, language }),
      });

      const data = await resp.json();
      console.log("generateVideo response:", data);

      setProgressText("Finalizing video and creating output file...");
      // prefer the opPath if present (served at /output/op.mp4), otherwise try finalVideo
      if (data.opPath) {
        // opPath on server is absolute path; show the public URL
        setVideoUrl("/output/op.mp4");
      } else if (data.finalVideo) {
        // fallback: try to derive a public path from finalVideo filename
        try {
          const fname = data.finalVideo.split("\\").pop().split("/").pop();
          setVideoUrl(`/output/${fname}`);
        } catch (e) {
          setVideoUrl(null);
        }
      }

      setStatus("done");
      setProgressText("Finished — enjoy the video!");

      // perform a small reveal animation after a short delay
      setTimeout(() => {
        const frame = document.getElementById("video-frame");
        if (frame) frame.classList.add(styles.reveal);
      }, 400);
    } catch (err) {
      console.error(err);
      setStatus("error");
      setProgressText("Generation failed — check server logs.");
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Lexi — Generate & Preview</h1>
        <form onSubmit={handleGenerate} className={styles.form}>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the scene you want (e.g. Explain Newton's 2nd law)"
            className={styles.textarea}
            required
          />

          <div className={styles.row}>
            <label>
              Language:
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className={styles.select}
              >
                <option value="nepali">Nepali</option>
                <option value="english">English</option>
              </select>
            </label>

            <button type="submit" className={styles.button}>
              Generate
            </button>
          </div>

          <div className={styles.status}>
            <div className={styles.pulse} data-state={status}></div>
            <div>
              <strong>{status.toUpperCase()}</strong>
              <div className={styles.progressText}>{progressText}</div>
            </div>
          </div>
        </form>
      </div>

      <div id="video-frame" className={styles.videoFrame}>
        {videoUrl ? (
          <div className={styles.playerWrap}>
            <video
              className={styles.video}
              src={videoUrl}
              controls
              autoPlay
              playsInline
            />
            <div className={styles.overlay}>
              <div className={styles.badge}>Final Output</div>
              <a className={styles.download} href={videoUrl} download>
                Download
              </a>
            </div>
          </div>
        ) : (
          <div className={styles.placeholder}>
            <div className={styles.icon}>🎬</div>
            <div className={styles.placeholderText}>Output will appear here</div>
          </div>
        )}
      </div>
    </div>
  );
}
