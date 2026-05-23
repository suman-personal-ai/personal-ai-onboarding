const axios = require('axios');
const config = require('../config');

const PAI_BASE = config.personalAi.baseUrl;
const PAI_KEY = config.personalAi.apiKey;

function paiHeaders() {
  return {
    'x-api-key': PAI_KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

/**
 * Send a message to Personal.ai and get AI response
 * @param {string} userMessage - The user's message
 * @param {string} userPhone - E.164 phone (will be used as DomainName without +)
 * @param {string} sourceName - Channel source (SMS, WhatsApp, Voice)
 * @returns {Promise<{message: string, score: number}>}
 */
async function sendMessage(userMessage, userPhone, sourceName = 'SMS') {
  const domainName = userPhone.replace('+', '');

  try {
    const response = await axios.post(`${PAI_BASE}/message`, {
      Text: userMessage,
      DomainName: domainName,
      UserName: 'PersonalAI',
      SourceName: sourceName,
      Score: 0.5,
    }, {
      headers: paiHeaders(),
      timeout: 15000,
    });

    const data = response.data;
    return {
      message: data.ai_message || data.message || '',
      score: data.ai_score || 0,
      raw: data,
    };
  } catch (error) {
    console.error('Personal.ai API error:', error.response?.data || error.message);
    // Return fallback response
    return {
      message: getFallbackResponse(userMessage),
      score: 0,
      error: error.message,
    };
  }
}

/**
 * Upload a memory to Personal.ai
 * @param {string} memoryText - Memory content
 * @param {string} userPhone - E.164 phone
 * @param {string} category - Memory category
 * @param {string[]} tags - Additional tags
 */
async function uploadMemory(memoryText, userPhone, category = 'general', tags = []) {
  const domainName = userPhone.replace('+', '');

  try {
    const response = await axios.post(`${PAI_BASE}/memory`, {
      Text: memoryText,
      DomainName: domainName,
      SourceName: 'onboarding',
      RawFeedText: memoryText,
      Tags: ['onboarding', category, ...tags],
    }, {
      headers: paiHeaders(),
      timeout: 10000,
    });

    return response.data;
  } catch (error) {
    console.error('Personal.ai memory upload error:', error.response?.data || error.message);
    return null;
  }
}

/**
 * Upload multiple memories in batch
 */
async function uploadMemories(memories, userPhone) {
  const results = [];
  for (const mem of memories) {
    const result = await uploadMemory(mem.text, userPhone, mem.category, mem.tags || []);
    results.push(result);
  }
  return results;
}

/**
 * Fallback responses when PAI API is unavailable
 */
function getFallbackResponse(message) {
  const lower = message.toLowerCase();

  if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
    return "Hey! I'm your Personal AI. I'm here to help. What's on your mind?";
  }

  if (lower.includes('help')) {
    return "I'm your Personal AI assistant. I can screen your calls, handle leads, and keep in touch with family when you're busy. What would you like to set up?";
  }

  if (lower.includes('call') || lower.includes('screen')) {
    return "Call screening is one of my best features! I'll answer unknown calls, find out who's calling and why, then send you a transcript. You decide what to do next.";
  }

  if (lower.includes('lead')) {
    return "I can handle leads for you — qualify them, capture their info, and even schedule calls on your calendar. Want me to set that up?";
  }

  if (lower.includes('family')) {
    return "I'll keep your family threads warm when you're heads-down. Quick, caring responses so they know you're thinking of them.";
  }

  return "Got it! I'm processing your message. I'll respond with the most relevant information for your Personal AI setup.";
}

module.exports = {
  sendMessage,
  uploadMemory,
  uploadMemories,
  getFallbackResponse,
};
