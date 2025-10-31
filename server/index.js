import express from 'express';
import cors from 'cors';
import Groq from "groq-sdk";
import 'dotenv/config';

const app = express();
const PORT = process.env.PORT || 5000;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Server is running');
});

app.post("/generateVideo", async (req, res) => {
  try {
    const description = req.body.description;
    if (!description) {
      return res.status(400).json({ error: "Description is required" });
    }

    const scriptJSON = await generateManimScript(description);
  } catch (error) {
    console.error("Error generating video:", error);
    res.status(500).json({ status: "error", error: "Failed to generate video" });
  }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

async function generateManimScript(description) {
  const response = await groq.chat.completions.create({
    model: "openai/gpt-oss-20b",
    messages: [
      {
        role: "system",
        content: `
You are an expert Manim animator and educational content creator.
Your task is to always respond with a **strict JSON object** that defines a Manim scene plan.
Do not include any explanatory text outside the JSON.
The JSON must have the format:

{
  "scene_name": "SceneName",
  "objects": ["list of objects"],
  "actions": ["list of actions in order"]
}

Use simple shapes and clear action instructions suitable for Manim CE.
`
      },
      {
        role: "user",
        content: `Create a scene plan for the following concept: "${description}". Return ONLY the JSON in the specified format.`
      }
    ],
  });

  if (!response?.choices || response.choices.length === 0) {
    throw new Error("No choices returned from Groq AI");
  }

  const rawContent = response.choices[0].message.content;

  try {
    return JSON.parse(rawContent);
  } catch (err) {
    console.warn("Failed to parse AI response as JSON. Returning raw text.");
    return { raw: rawContent };
  }
}

async function generateManimCode(script) {
  try {
    const resposneCode = await groq.chat.completions.create({})
  } catch (error) {
    console.warn("Failed to parse AI response as JSON. Returning raw text.");
    return { raw: rawContent };
  }
}