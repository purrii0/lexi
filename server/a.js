/**
 * ElevenLabs Voice ID Finder
 * Run this to see all available voices and their IDs
 *
 * Usage:
 * 1. Save as getVoices.js
 * 2. Create .env with: ELEVENLABS_API_KEY=your_key_here
 * 3. Run: node getVoices.js
 */

import axios from "axios";
import "dotenv/config";

const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;

async function getAllVoices() {
  if (!ELEVENLABS_KEY) {
    console.error("❌ Please set ELEVENLABS_API_KEY in your .env file");
    process.exit(1);
  }

  try {
    console.log("🔍 Fetching all available voices from ElevenLabs...\n");

    const response = await axios.get("https://api.elevenlabs.io/v1/voices", {
      headers: {
        "xi-api-key": ELEVENLABS_KEY,
      },
    });

    const voices = response.data.voices;

    console.log(`✅ Found ${voices.length} voices:\n`);
    console.log("=".repeat(80));

    voices.forEach((voice, index) => {
      console.log(`\n${index + 1}. ${voice.name}`);
      console.log(`   Voice ID: ${voice.voice_id}`);
      console.log(`   Category: ${voice.category || "N/A"}`);
      console.log(`   Description: ${voice.description || "No description"}`);
      console.log(`   Labels: ${JSON.stringify(voice.labels || {})}`);

      // Check if it supports multiple languages
      if (voice.labels?.language) {
        console.log(`   Language: ${voice.labels.language}`);
      }

      // Check if it's a cloned or premade voice
      if (voice.category) {
        console.log(`   Type: ${voice.category}`);
      }
    });

    console.log("\n" + "=".repeat(80));
    console.log("\n💡 Tips:");
    console.log("   - For Nepali, use voices that support 'multilingual'");
    console.log("   - Copy the Voice ID you want to use");
    console.log("   - Add it to your .env: ELEVENLABS_VOICE_ID=your_voice_id");
    console.log("\n📝 Recommended multilingual voices:");

    const multilingualVoices = voices.filter(
      (v) =>
        v.name?.toLowerCase().includes("multi") ||
        v.description?.toLowerCase().includes("multi") ||
        v.labels?.use_case?.includes("multilingual")
    );

    if (multilingualVoices.length > 0) {
      multilingualVoices.forEach((voice) => {
        console.log(`   - ${voice.name}: ${voice.voice_id}`);
      });
    } else {
      console.log(
        "   - Use any premade voice with eleven_multilingual_v2 model"
      );
    }

    // Show some popular default voices
    console.log("\n🎤 Popular Default Voices:");
    const popularNames = ["Rachel", "Adam", "Domi", "Bella", "Antoni"];
    voices
      .filter((v) => popularNames.includes(v.name))
      .forEach((voice) => {
        console.log(`   - ${voice.name}: ${voice.voice_id}`);
      });
  } catch (error) {
    console.error("❌ Error fetching voices:", error.message);

    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(
        `   Message: ${error.response.data?.detail || error.response.data}`
      );

      if (error.response.status === 401) {
        console.error(
          "\n⚠️  Your API key appears to be invalid. Please check:"
        );
        console.error("   1. You have a valid ElevenLabs account");
        console.error("   2. Your API key is correct in .env");
        console.error(
          "   3. Get your API key from: https://elevenlabs.io/app/settings/api-keys"
        );
      }
    }
  }
}

// Alternative: Test a specific voice
async function testVoice(voiceId, testText = "Hello, this is a test.") {
  if (!ELEVENLABS_KEY) {
    console.error("❌ Please set ELEVENLABS_API_KEY in your .env file");
    process.exit(1);
  }

  try {
    console.log(`🎤 Testing voice: ${voiceId}`);
    console.log(`📝 Text: "${testText}"\n`);

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
    const payload = {
      text: testText,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    };

    const response = await axios.post(url, payload, {
      headers: {
        "xi-api-key": ELEVENLABS_KEY,
        "Content-Type": "application/json",
      },
      responseType: "arraybuffer",
      timeout: 30000,
    });

    console.log("✅ Voice test successful!");
    console.log(`   Audio size: ${response.data.length} bytes`);
    console.log(`   This voice ID works: ${voiceId}`);
  } catch (error) {
    console.error("❌ Voice test failed:", error.message);

    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      const errorText = Buffer.from(error.response.data).toString("utf-8");
      console.error(`   Error: ${errorText}`);
    }
  }
}

// Run the script
const args = process.argv.slice(2);

if (args.length > 0 && args[0] === "test") {
  // Test a specific voice: node getVoices.js test VOICE_ID
  const voiceId = args[1];
  const testText = args[2] || "Hello, this is a test.";

  if (!voiceId) {
    console.error("❌ Usage: node getVoices.js test VOICE_ID [test_text]");
    process.exit(1);
  }

  testVoice(voiceId, testText);
} else {
  // List all voices
  getAllVoices();
}
