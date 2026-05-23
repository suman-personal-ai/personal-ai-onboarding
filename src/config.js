require('dotenv').config();

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  baseUrl: process.env.BASE_URL || 'https://personal-ai-onboarding-production.up.railway.app',
  telnyx: {
    apiKey: process.env.TELNYX_API_KEY,
    publicKey: process.env.TELNYX_PUBLIC_KEY,
    // Optional: reuse an existing messaging profile instead of creating one per user
    defaultMessagingProfileId: process.env.TELNYX_MESSAGING_PROFILE_ID || '40019e52-dacd-4c66-9a67-b7fb5e4fe26d',
    // Optional: call control application ID for voice
    callControlAppId: process.env.TELNYX_CALL_CONTROL_APP_ID || null,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
  db: {
    path: process.env.DB_PATH || './data/app.db',
  },
};

module.exports = config;
