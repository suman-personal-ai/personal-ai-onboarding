const express = require('express');
const router = express.Router();
const config = require('../config');
const db = require('../db');
const telnyxService = require('../services/telnyx');
const onboardingService = require('../services/onboarding');
const personalAiService = require('../services/personalai');

// Parse raw body for webhook signature verification
// (configured in server.js via express.raw)

/**
 * POST /webhook/telnyx
 * Main webhook receiver for all Telnyx events (SMS, WhatsApp, Voice)
 */
router.post('/', async (req, res) => {
  // Respond 200 immediately to avoid Telnyx retries
  res.status(200).json({ received: true });

  try {
    const payload = req.body;

    // Handle both wrapped and unwrapped payloads
    const eventType = payload?.data?.event_type || payload?.event_type;
    const eventData = payload?.data?.payload || payload?.payload || payload?.data || {};

    console.log(`[Webhook] Event type: ${eventType}`);

    switch (eventType) {
      case 'message.received':
        await handleMessageReceived(eventData);
        break;

      case 'call.initiated':
        await handleCallInitiated(eventData);
        break;

      case 'call.answered':
        await handleCallAnswered(eventData);
        break;

      case 'call.speak.ended':
        await handleCallSpeakEnded(eventData);
        break;

      case 'call.gather.ended':
        await handleCallGatherEnded(eventData);
        break;

      case 'call.hangup':
        console.log('[Voice] Call ended:', eventData?.call_control_id);
        break;

      case 'message.sent':
      case 'message.finalized':
        // Delivery receipts — log and ignore
        console.log(`[Webhook] Message status: ${eventType}`);
        break;

      default:
        console.log(`[Webhook] Unhandled event: ${eventType}`);
    }
  } catch (err) {
    console.error('[Webhook] Error processing event:', err.message, err.stack);
  }
});

/**
 * POST /webhook/telnyx/voice
 * Voice-specific webhook (TeXML)
 */
router.post('/voice', async (req, res) => {
  try {
    const { CallSid, From, To, SpeechResult } = req.body;

    if (SpeechResult) {
      return handleVoiceInput(req, res, From, To, SpeechResult);
    }

    // Initial answer
    const user = db.getUserByTelnyxNumber(To);
    const greeting = user?.setup_complete
      ? "Hi, I'm your Personal AI assistant. One moment while I check your preferences."
      : "Hi! You've reached a Personal AI number. The owner is setting up their account. Please try again soon.";

    res.set('Content-Type', 'text/xml');
    res.send(telnyxService.generateTeXML({
      message: greeting,
      gatherAction: '/webhook/telnyx/voice/input',
      gatherPrompt: 'What can I help you with?',
    }));
  } catch (err) {
    console.error('[Voice TeXML] Error:', err.message);
    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, an error occurred.</Say></Response>`);
  }
});

/**
 * POST /webhook/telnyx/voice/input
 * Handle gathered speech input
 */
router.post('/voice/input', async (req, res) => {
  try {
    const { From, To, SpeechResult } = req.body;
    return handleVoiceInput(req, res, From, To, SpeechResult);
  } catch (err) {
    console.error('[Voice Input] Error:', err.message);
    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, I didn't catch that. Goodbye.</Say></Response>`);
  }
});

// ---- Event Handlers ----

async function handleMessageReceived(data) {
  try {
    const from = data?.from?.phone_number || data?.from;
    const to = data?.to?.[0]?.phone_number || data?.to;
    const text = data?.text || '';
    const messageType = data?.type?.toLowerCase() || 'sms';

    if (!from || !to) {
      console.warn('[Message] Missing from/to in message payload');
      return;
    }

    // Determine channel
    let channel = 'sms';
    if (messageType === 'whatsapp') {
      channel = 'whatsapp_text';
    } else if (data?.media?.length > 0) {
      channel = 'sms'; // MMS falls back to SMS
    }

    // Find user by the Telnyx number (the "to" field)
    const user = db.getUserByTelnyxNumber(to);
    if (!user) {
      console.warn(`[Message] No user found for Telnyx number ${to}`);
      return;
    }

    const userPhone = user.user_phone;
    console.log(`[Message] ${channel} from ${userPhone}: "${text}"`);

    await onboardingService.processInboundMessage(userPhone, text, channel);
  } catch (err) {
    console.error('[Message] Error handling received message:', err.message);
  }
}

async function handleCallInitiated(data) {
  try {
    const callControlId = data?.call_control_id;
    const from = data?.from;
    const to = data?.to;

    if (!callControlId) return;

    console.log(`[Voice] Call initiated from ${from} to ${to}`);

    // Answer the call
    await telnyxService.answerCall(callControlId, `${config.baseUrl}/webhook/telnyx`);
  } catch (err) {
    console.error('[Voice] Error handling call.initiated:', err.message);
  }
}

async function handleCallAnswered(data) {
  try {
    const callControlId = data?.call_control_id;
    const from = data?.from;
    const to = data?.to;

    if (!callControlId) return;

    console.log(`[Voice] Call answered: ${callControlId}`);

    // Find the user
    const user = db.getUserByTelnyxNumber(to);

    // Greet and gather input
    await telnyxService.speakOnCall(
      callControlId,
      "Hi, I'm your Personal AI assistant. One moment while I check your preferences."
    );

    // Log the call
    if (user) {
      db.saveMessage({
        userPhone: user.user_phone,
        channel: 'voice',
        direction: 'inbound',
        content: '[Voice call initiated]',
      });
    }
  } catch (err) {
    console.error('[Voice] Error handling call.answered:', err.message);
  }
}

async function handleCallSpeakEnded(data) {
  try {
    const callControlId = data?.call_control_id;
    if (!callControlId) return;

    // After speaking, gather speech input
    await telnyxService.gatherSpeech(callControlId, {
      prompt: 'What can I help you with?',
    });
  } catch (err) {
    console.error('[Voice] Error handling call.speak.ended:', err.message);
  }
}

async function handleCallGatherEnded(data) {
  try {
    const callControlId = data?.call_control_id;
    const speechResult = data?.result || data?.speech?.result || '';
    const from = data?.from;
    const to = data?.to;

    if (!callControlId || !speechResult) {
      // No input received — say goodbye
      await telnyxService.speakOnCall(callControlId, "I didn't catch that. Please text me or try again. Goodbye!");
      await telnyxService.hangupCall(callControlId);
      return;
    }

    console.log(`[Voice] Speech input from ${from}: "${speechResult}"`);

    // Find user
    const user = db.getUserByTelnyxNumber(to);
    if (!user) {
      await telnyxService.speakOnCall(callControlId, "Sorry, this number is not yet configured. Please try again later.");
      await telnyxService.hangupCall(callControlId);
      return;
    }

    // Get AI response
    const aiResult = await personalAiService.sendMessage(speechResult, user.user_phone, 'Voice');

    // Log the interaction
    db.saveMessage({
      userPhone: user.user_phone,
      channel: 'voice',
      direction: 'inbound',
      content: speechResult,
      aiResponse: aiResult.message,
    });

    // Speak the response and gather again
    await telnyxService.speakOnCall(callControlId, aiResult.message);

  } catch (err) {
    console.error('[Voice] Error handling call.gather.ended:', err.message);
  }
}

async function handleVoiceInput(req, res, from, to, speechResult) {
  const user = db.getUserByTelnyxNumber(to);

  if (!speechResult || !user) {
    res.set('Content-Type', 'text/xml');
    return res.send(telnyxService.generateTeXML({
      message: "I didn't catch that. Please text me instead. Goodbye!",
    }));
  }

  const aiResult = await personalAiService.sendMessage(speechResult, user.user_phone, 'Voice');

  db.saveMessage({
    userPhone: user.user_phone,
    channel: 'voice',
    direction: 'inbound',
    content: speechResult,
    aiResponse: aiResult.message,
  });

  res.set('Content-Type', 'text/xml');
  res.send(telnyxService.generateTeXML({
    message: aiResult.message,
    gatherAction: '/webhook/telnyx/voice/input',
    gatherPrompt: 'Is there anything else I can help with?',
  }));
}

module.exports = router;
