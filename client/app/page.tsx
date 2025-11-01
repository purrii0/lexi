"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useState, useEffect } from "react";

function GeneratorCard() {
  const [prompt, setPrompt] = useState("");
  const [language, setLanguage] = useState("nepali");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [opCandidate, setOpCandidate] = useState<string | null>(null);
  const [opProbeError, setOpProbeError] = useState<string | null>(null);
  const [cacheBust, setCacheBust] = useState<number>(Date.now());

  async function callGenerate(body: any) {
    const endpoints = [
      `${window.location.origin}/generateVideo`,
      `http://localhost:5000/generateVideo`,
      `http://localhost:4000/generateVideo`,
    ];

    let lastErr = null;
    for (const url of endpoints) {
      try {
        setProgress(`Posting to ${url}`);
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!resp.ok) {
          const txt = await resp.text().catch(() => "");
          lastErr = new Error(`Status ${resp.status}: ${txt}`);
          continue;
        }

        const json = await resp.json();
        return { json, base: new URL(url).origin };
      } catch (e: any) {
        lastErr = e;
        // try next endpoint
      }
    }
    throw lastErr || new Error("All endpoints failed");
  }

  async function handleGenerate() {
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      if (!prompt || prompt.trim().length < 3) {
        setError("Please enter a longer prompt (3+ chars).");
        setLoading(false);
        return;
      }

      setProgress("Starting generation...");

      const payload = { description: prompt.trim(), language };

      const { json, base } = await callGenerate(payload);

      setProgress("Completed. Preparing result...");
  setResult({ data: json, base });
  // update cache bust so UI reloads any video element
  setCacheBust(Date.now());
      // clear previous probe state
      setOpCandidate(null);
      setOpProbeError(null);
      setProgress(null);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || String(e));
      setProgress(null);
    } finally {
      setLoading(false);
    }
  }

  // Probe for the op file when result becomes available
  useEffect(() => {
    let c = false;
    async function probe() {
      setOpCandidate(null);
      setOpProbeError(null);
      if (!result) return;
      const r = result.data || result;
      const opPath = r.opPath || r.opPath || r.opPath;
      if (!opPath) {
        setOpProbeError("No opPath returned by the server");
        return;
      }

      const bases = [result.base, window.location.origin, "http://localhost:5000", "http://localhost:4000"].filter(Boolean);

      // Normalize opPath: it might be an HTTP URL, a unix path (/output/op.mp4),
      // or a Windows absolute path (C:\...\output\op.mp4). If it's a filesystem
      // absolute path, extract the basename and map to /output/<basename>.
      let relativePath = opPath;
      try {
        // If it's an http URL, we'll use it as-is
        if (/^https?:\/\//i.test(opPath)) {
          relativePath = opPath;
        } else if (/^[A-Za-z]:\\|\\\\|\//.test(opPath)) {
          // Windows absolute (C:\...) or UNC (\\server\...) or unix absolute (/...)
          const parts = opPath.split(/[/\\]+/);
          const basename = parts.pop() || parts.pop();
          relativePath = basename ? `/output/${basename}` : opPath;
        } else {
          // relative or starts with /
          if (!opPath.startsWith("/")) relativePath = `/${opPath}`;
        }
      } catch (e) {
        relativePath = opPath;
      }

      const candidates = bases.map((b: string) => {
        if (/^https?:\/\//i.test(relativePath)) return relativePath;
        return `${b.replace(/\/$/, "")}${relativePath}`;
      });

      let lastErr: any = null;
      for (const url of candidates) {
        if (c) return;
        try {
          setProgress(`Probing ${url}`);
          // Try HEAD first
          let resp = await fetch(url, { method: "HEAD" }).catch(() => null);
          if (!resp || !resp.ok) {
            // Try a small GET range request as some static servers don't accept HEAD
            resp = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" } }).catch(() => null);
          }
          if (!resp) {
            lastErr = `No response from ${url}`;
            continue;
          }
          if (!resp.ok) {
            lastErr = `HTTP ${resp.status} from ${url}`;
            continue;
          }
          const ct = resp.headers.get("content-type") || "";
          const cl = resp.headers.get("content-length") || "";
          // Accept if content-type looks like video or audio or generic binary
          if (/(video|audio)\//i.test(ct) || ct === "application/octet-stream" || Number(cl) > 0) {
            setOpCandidate(url);
            setOpProbeError(null);
            setProgress(null);
            return;
          } else {
            lastErr = `Unsupported content-type '${ct}' from ${url}`;
            continue;
          }
        } catch (e: any) {
          lastErr = e?.message || String(e);
        }
      }
      if (!c) setOpProbeError(lastErr || "Could not find playable op file");
      setProgress(null);
    }
    probe();
    return () => {
      c = true;
    };
  }, [result]);

  return (
    <div>
      <div className="flex gap-3 mb-4">
        <Input
          value={prompt}
          onChange={(e: any) => setPrompt(e.target.value)}
          placeholder="Explain the theory of..."
          className="flex-1 bg-[#262255] text-white border-none focus:ring-2 focus:ring-[#FF9D47]"
        />
        <Button
          onClick={handleGenerate}
          disabled={loading}
          className="bg-gradient-to-r from-[#FF9D47] to-[#D4945C] hover:opacity-90 shadow-md shadow-[#FF9D47]/30"
        >
          {loading ? "Generating..." : "Generate"}
        </Button>
      </div>

      <div className="text-sm text-gray-300 mb-2">
        {progress && <div className="mb-2">{progress}</div>}
        {error && <div className="text-red-400">Error: {error}</div>}
      </div>

      {result && (
        <div className="mt-4">
          <div className="text-sm text-gray-300 mb-2">Result JSON:</div>
          <pre className="text-xs p-2 bg-black/30 rounded mb-4 max-h-48 overflow-auto">
            {JSON.stringify(result.data, null, 2)}
          </pre>

          {opCandidate ? (
            <div>
              <div className="text-sm text-gray-300 mb-2">Final Video (op.mp4):</div>
              <video
                key={String(cacheBust) + (opCandidate ?? "")}
                src={`${opCandidate}${opCandidate && opCandidate.includes("?") ? "&" : "?"}cb=${cacheBust}`}
                controls
                className="w-full rounded-lg shadow-lg border border-[#ffffff26]"
              />
              <div className="mt-2">
                <a
                  className="text-sm underline"
                  href={`${opCandidate}${opCandidate && opCandidate.includes("?") ? "&" : "?"}cb=${cacheBust}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in new tab
                </a>
              </div>
            </div>
          ) : (
            opProbeError && (
              <div className="text-sm text-yellow-300">Probe error: {opProbeError}</div>
            )
          )}
        </div>
      )}
    </div>
  );
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: { y: 0, opacity: 1 },
};

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-[#0f0c29] via-[#302b63] to-[#24243e] text-white">
      <section className="pt-32 pb-20 px-4">
        <div className="container mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center max-w-4xl mx-auto"
          >
            {/* Title */}
            <motion.h1
              className="text-5xl md:text-6xl font-bold mb-6 leading-tight"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#FFD580] to-[#FF9D47]">
                संसारको दोस्रो
              </span>{" "}
              AI शिक्षक
              <br />
              <span className="gradient-text bg-clip-text text-transparent bg-gradient-to-r from-[#FF9D47] via-[#FF7E5F] to-[#FEB47B]">
                प्रत्यक्ष अडियो-भिडियो व्याख्याको साथ
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-xl text-gray-300 mb-12"
            >
              Learn smarter, faster, and more interactively.
            </motion.p>

            {/* Input + Upload Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              whileHover={{ scale: 1.02 }}
              className="max-w-2xl mx-auto mb-12"
            >
              <Card className="bg-[#1b1838]/80 border border-[#ffb36b]/30 shadow-lg shadow-[#ff9d47]/10 backdrop-blur-md rounded-2xl">
                <CardContent className="p-6">
                  <GeneratorCard />
                </CardContent>
              </Card>
            </motion.div>

            {/* Features */}
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="flex flex-wrap justify-center gap-6 mb-12"
            >
              {[
                "🎧 Live Audio & Video Explanations",
                "📊 Personalized Performance Guidance",
                "🌐 Multilingual Audio Support",
              ].map((feature, index) => (
                <motion.div
                  key={index}
                  variants={itemVariants}
                  whileHover={{ scale: 1.07 }}
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#ffffff0d] border border-[#FF9D47]/30 text-sm md:text-base hover:bg-[#ffffff1a] transition-all duration-300"
                >
                  <span className="w-2 h-2 rounded-full bg-gradient-to-r from-[#FF9D47] to-[#D4945C] animate-pulse"></span>
                  <span>{feature}</span>
                </motion.div>
              ))}
            </motion.div>

            {/* Subtext or CTA */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8 }}
            >
            </motion.div>
          </motion.div>
        </div>
      </section>
    </main>
  );
}
