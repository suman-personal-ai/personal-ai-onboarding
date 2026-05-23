const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a Personal AI assistant that handles calls, texts, and messages on behalf of your user. You answer as their dedicated AI — professional, helpful, and concise.

When someone contacts this number:
- Greet them warmly and ask how you can help
- Answer questions about the user's availability and services based on what you know
- For leads: qualify them (name, company, what they need, timeline) and offer to have the user follow up
- For family/friends: be warm and let them know the user will get back to them
- Keep responses brief and natural — this is SMS/voice, not email

You have memory of the user's preferences from their onboarding setup. Use that context to respond appropriately.`;

/**
 * Send a message to Claude and get an AI response
 * @param {string} userMessage - The incoming message
 * @param {string} userPhone - E.164 phone of the AI owner (used to load context/history)
 * @param {string} sourceName - Channel: SMS, WhatsApp, Voice
 * @returns {Promise<{message: string, tokens: number}>}
 */
async function sendMessage(userMessage, userPhone, sourceName = 'SMS') {
  try {
    const memories = db.getMemories(userPhone);
    const recentMessages = db.getMessages(userPhone, 20).reverse();

    const memoryContext = memories.length > 0
      ? '\n\nUser preferences and context:\n' + memories.map(m => `- ${m.label}`).join('\n')
      : '';

    const systemWithContext = SYSTEM_PROMPT + memoryContext;

    // Build conversation history from DB (exclude the current message)
    const history = [];
    for (const msg of recentMessages) {
      if (msg.direction === 'inbound' && msg.content) {
        history.push({ role: 'user', content: msg.content });
      } else if (msg.direction === 'outbound' && msg.content && !isOnboardingMessage(msg.content)) {
        history.push({ role: 'assistant', content: msg.content });
      }
    }

    // Trim to last 10 turns to stay within limits
    const trimmedHistory = history.slice(-20);

    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 500,
      thinking: { type: 'adaptive' },
      system: [
        {
          type: 'text',
          text: systemWithContext,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        ...trimmedHistory,
        { role: 'user', content: `[${sourceName}] ${userMessage}` },
      ],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    const message = textBlock?.text || "I'm here. What can I help you with?";
    const tokens = response.usage?.output_tokens || 0;

    return { message, tokens, raw: response };
  } catch (error) {
    console.error('Claude API error:', error.message);
    return {
      message: getFallbackResponse(userMessage),
      tokens: 0,
      error: error.message,
    };
  }
}

/**
 * Store a memory in the local DB (replaces Personal.ai memory upload)
 */
async function uploadMemory(memoryText, userPhone, category = 'general', tags = []) {
  try {
    db.saveMemory({
      userPhone,
      category,
      label: memoryText,
      source: tags[0] || 'onboarding',
    });
    return { success: true };
  } catch (error) {
    console.error('Memory save error:', error.message);
    return null;
  }
}

async function uploadMemories(memories, userPhone) {
  const results = [];
  for (const mem of memories) {
    const result = await uploadMemory(mem.text, userPhone, mem.category, mem.tags || []);
    results.push(result);
  }
  return results;
}

function isOnboardingMessage(text) {
  const markers = [
    "It's me — your Personal AI",
    "Good picks. Starting with call screening",
    "Got it. Professional",
    "To do that well",
    "One more — family",
    "All set! I'm ready",
  ];
  return markers.some(m => text.includes(m));
}

function getFallbackResponse(message) {
  const lower = message.toLowerCase();
  if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
    return "Hey! I'm your Personal AI. What's on your mind?";
  }
  if (lower.includes('help')) {
    return "I'm your Personal AI assistant — I can screen your calls, handle leads, and keep in touch with family when you're busy.";
  }
  if (lower.includes('call') || lower.includes('screen')) {
    return "Call screening is one of my best features. I'll answer unknown calls, find out who's calling and why, then send you a transcript.";
  }
  if (lower.includes('lead')) {
    return "I can qualify leads for you — capture their info and even schedule calls on your calendar.";
  }
  return "Got it! I'll pass your message along. How can I help?";
}

module.exports = {
  sendMessage,
  uploadMemory,
  uploadMemories,
  getFallbackResponse,
};
