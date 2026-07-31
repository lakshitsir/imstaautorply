const express = require('express');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Anti-Spam Tracker (1 Hour Cooldown per user)
const userCooldowns = new Map();
const COOLDOWN_TIME = 60 * 60 * 1000; 

// Webhook Verification Endpoint
app.get('/api/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Incoming Message Webhook Endpoint
app.post('/api/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'instagram' || body.object === 'page') {
    res.status(200).send('EVENT_RECEIVED');

    for (const entry of body.entry) {
      const messaging = entry.messaging || (entry.changes && entry.changes[0] && entry.changes[0].value.messages);
      if (!messaging) continue;

      for (const event of messaging) {
        // Ignore bot's own sent messages (is_echo) & non-message events
        if (!event.sender || !event.message || event.message.is_echo) continue;

        const senderId = event.sender.id;
        const messageText = event.message.text;
        const replyToMessage = event.message.reply_to ? event.message.reply_to.text : null;

        if (senderId && messageText) {
          const trimmedText = messageText.trim();

          // Command check: Must start with .ai
          if (trimmedText.toLowerCase().startsWith('.ai')) {
            const prompt = trimmedText.slice(3).trim();

            if (!prompt) {
              const defaultMsg = "Lakshit is Currently Offline 🤧\n\nPlease add a question after `.ai`.\n\n— Userbot / Automated Bot 🐧";
              await sendInstaMessage(senderId, defaultMsg);
              continue;
            }

            // Anti-Spam / Cooldown Check
            const now = Date.now();
            const lastInteraction = userCooldowns.get(senderId) || 0;

            if (now - lastInteraction < COOLDOWN_TIME) {
              console.log(`Cooldown active for ${senderId}. Ignored.`);
              continue;
            }

            // Record timestamp
            userCooldowns.set(senderId, now);

            try {
              let fullContextPrompt = prompt;
              if (replyToMessage) {
                fullContextPrompt = `Context from replied message: "${replyToMessage}"\nUser query: "${prompt}"`;
              }

              const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: fullContextPrompt,
                config: {
                  systemInstruction: "You are an AI assistant responding on Lakshit's Instagram DM when he is offline. Keep responses direct, smart, clean, precise, and concise (under 3-4 sentences max)."
                }
              });

              const aiReply = response.text || "Unable to fetch response right now.";

              // Clean Format
              const finalMessage = `Lakshit is Currently Offline 🤧\n\n${aiReply.trim()}\n\n— Userbot / Automated Bot 🐧`;

              await sendInstaMessage(senderId, finalMessage);

            } catch (err) {
              console.error("Gemini Error:", err);
              // Reset cooldown on error so user isn't stuck
              userCooldowns.delete(senderId);
            }
          }
        }
      }
    }
  } else {
    res.sendStatus(404);
  }
});

// Meta Graph API Helper
async function sendInstaMessage(recipientId, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/me/messages`,
      {
        recipient: { id: recipientId },
        message: { text: text }
      },
      {
        params: { access_token: PAGE_ACCESS_TOKEN },
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error("Failed to send Insta DM:", error.response ? error.response.data : error.message);
  }
}

module.exports = app;
         
