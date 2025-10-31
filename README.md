app.post('/generate-video', async (req, res) => {
const { question } = req.body;

    try {
        // 1. Generate Manim script via AI
        const script = await generateManimScript(question);
        const scriptPath = saveTempScript(script);

        // 2. Run Manim to render video
        const videoPath = await renderManimVideo(scriptPath);

        // 3. Generate Nepali TTS
        const audioPath = await generateNepaliTTS(question);

        // 4. Merge audio + video
        const finalVideo = await mergeAudioVideo(videoPath, audioPath);

        // 5. Return URL
        res.json({ video_url: `http://localhost:${PORT}/videos/${path.basename(finalVideo)}` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Video generation failed' });
    }

});
