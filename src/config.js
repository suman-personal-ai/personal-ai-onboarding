require('dotenv').config();

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  baseUrl: process.env.BASE_URL || 'https://personal-ai-onboarding-production.up.railway.app',
  telnyx: {
    apiKey: process.env.TELNYX_API_KEY,
    publicKey: process.env.TELNYX_PUBLIC_KEY,
  },
  personalAi: {
    apiKey: process.env.PERSONAL_AI_API_KEY,
    baseUrl: 'https://api.personal.ai/v1',
  },
  db: {
    path: process.env.DB_PATH || './data/app.db',
  },
};

module.exports = config;
