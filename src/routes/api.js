const express = require('express');
const router = express.Router();
const db = require('../db');
const telnyxService = require('../services/telnyx');
const onboardingService = require('../services/onboarding');
const { normalizePhone, isValidPhone } = require('../utils/phone');

/**
 * POST /api/onboard
 * Body: { phone: "+14155550100" }
 * Provision a Telnyx number for the user and start onboarding
 */
router.post('/onboard', async (req, res) => {
  try {
    const rawPhone = req.body.phone;
    if (!rawPhone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const userPhone = normalizePhone(rawPhone);
    if (!isValidPhone(userPhone)) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }

    // Check if user already exists
    let user = db.getUserByPhone(userPhone);
    if (user && user.telnyx_number) {
      return res.json({
        success: true,
        alreadyProvisioned: true,
        user: sanitizeUser(user),
        message: `You already have a provisioned number: ${user.telnyx_number}`,
      });
    }

    // Create user record
    user = db.createUser(userPhone);
    db.createOnboardingState(userPhone);

    // Provision a Telnyx number
    console.log(`[Onboard] Provisioning number for ${userPhone}...`);
    let provisionResult;
    try {
      provisionResult = await telnyxService.provisionNumberForUser(userPhone);
    } catch (provisionErr) {
      console.error('[Onboard] Provisioning error:', provisionErr.message);
      return res.status(502).json({
        error: 'Failed to provision phone number',
        detail: provisionErr.message,
      });
    }

    // Update user with provisioned number
    user = db.updateUser(userPhone, {
      telnyx_number: provisionResult.phoneNumber,
      telnyx_number_id: provisionResult.numberRecordId,
      messaging_profile_id: provisionResult.messagingProfileId,
    });

    console.log(`[Onboard] Provisioned ${provisionResult.phoneNumber} for ${userPhone}`);

    // Send welcome SMS
    let welcomeSent = false;
    try {
      await onboardingService.sendWelcomeMessage(
        userPhone,
        provisionResult.phoneNumber,
        provisionResult.messagingProfileId
      );
      welcomeSent = true;
    } catch (smsErr) {
      console.error('[Onboard] Welcome SMS error:', smsErr.message);
      // Non-fatal — provisioning succeeded
    }

    return res.json({
      success: true,
      user: sanitizeUser(db.getUserByPhone(userPhone)),
      telnyxNumber: provisionResult.phoneNumber,
      welcomeMessageSent: welcomeSent,
      message: `Number provisioned! Text ${provisionResult.phoneNumber} to begin setup.`,
    });

  } catch (err) {
    console.error('[Onboard] Unexpected error:', err.message, err.stack);
    res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
});

/**
 * GET /api/users/:phone
 * Get user status and provisioned number
 */
router.get('/users/:phone', (req, res) => {
  try {
    const userPhone = normalizePhone(req.params.phone);
    const user = db.getUserByPhone(userPhone);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const state = db.getOnboardingState(userPhone);
    const memories = db.getMemories(userPhone);

    res.json({
      user: sanitizeUser(user),
      onboardingState: state,
      memoryCount: memories.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/users/:phone/messages
 * Get message history for a user
 */
router.get('/users/:phone/messages', (req, res) => {
  try {
    const userPhone = normalizePhone(req.params.phone);
    const limit = parseInt(req.query.limit || '50', 10);
    const messages = db.getMessages(userPhone, limit);

    res.json({ messages, count: messages.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/users/:phone/memories
 * Get memory log for a user
 */
router.get('/users/:phone/memories', (req, res) => {
  try {
    const userPhone = normalizePhone(req.params.phone);
    const memories = db.getMemories(userPhone);

    res.json({ memories, count: memories.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/users/:phone
 * Deprovision a user's number and delete their data
 */
router.delete('/users/:phone', async (req, res) => {
  try {
    const userPhone = normalizePhone(req.params.phone);
    const user = db.getUserByPhone(userPhone);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Release Telnyx number
    if (user.telnyx_number_id) {
      await telnyxService.releasePhoneNumber(user.telnyx_number_id);
    }

    // Delete messaging profile
    if (user.messaging_profile_id) {
      await telnyxService.deleteMessagingProfile(user.messaging_profile_id);
    }

    // Delete from DB
    db.deleteUser(userPhone);

    res.json({ success: true, message: `User ${userPhone} deprovisioned` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/simulate-message
 * Simulate an inbound message (for testing without a real phone)
 */
router.post('/simulate-message', async (req, res) => {
  try {
    const { phone, message, channel } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ error: 'phone and message are required' });
    }

    const userPhone = normalizePhone(phone);
    const user = db.getUserByPhone(userPhone);
    if (!user) {
      return res.status(404).json({ error: 'User not found. Please onboard first.' });
    }

    // Process message but don't send real SMS — just return the response
    const state = db.getOnboardingState(userPhone);
    const onboarding = require('../services/onboarding');

    let responseText;
    if (user.setup_complete) {
      responseText = await onboarding.handlePostOnboardingMessage(userPhone, message, channel || 'sms');
    } else {
      responseText = await onboarding.processInboundMessage(userPhone, message, channel || 'sms');
    }

    res.json({ response: responseText, step: db.getOnboardingState(userPhone)?.step });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    userPhone: user.user_phone,
    telnyxNumber: user.telnyx_number,
    setupComplete: !!user.setup_complete,
    voiceMode: user.voice_mode,
    leadHandling: user.lead_handling,
    familyMode: !!user.family_mode,
    createdAt: user.created_at,
  };
}

module.exports = router;
