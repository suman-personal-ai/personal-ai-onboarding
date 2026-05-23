const db = require('../db');
const telnyxService = require('./telnyx');
const personalAiService = require('./personalai');

// Onboarding step definitions
const STEPS = {
  WELCOME: 'welcome',
  USE_CASE_SELECT: 'use_case_select',
  VOICE_MODE: 'voice_mode',
  LEAD_HANDLING: 'lead_handling',
  UPLOAD_PROMPT: 'upload_prompt',
  FAMILY_MODE: 'family_mode',
  APP_HANDOFF: 'app_handoff',
  COMPLETE: 'complete',
};

// Exact onboarding messages from design prototype
const MESSAGES = {
  welcome: `It's me — your Personal AI. I live at your number now. When people call or text and you're busy, I pick up. I remember everything you share with me, so I sound like you. Let's set you up. What should I help with first? Reply with any combo of: 1) Screen callers, 2) Handle leads, 3) Family messages`,

  use_case_followup: `Good picks. Starting with call screening. When a number you don't know calls, I'll answer, ask who's calling + why. You'll get a transcript in seconds, then you decide: voicemail, take it live, or let me handle it. When I'm screening, should I sound like: 1) Your assistant, 2) As you, 3) Surprise me`,

  lead_handling: `Got it. Professional, third-person. Now leads. If someone reaches out about working with you, should I qualify them and offer times on your calendar? 1) Yes, full handling, 2) Just qualify, 3) Skip for now`,

  upload_prompt: `To do that well I'll need a few things — who you are, what you offer, when you're free. Drop them now. Tap to share, or just type: 1) LinkedIn URL, 2) Send a doc, 3) Skip`,

  family_mode: `One more — family messages. Should I keep threads with people in your Family group warm and brief when you're heads-down? 1) Yes, 2) Not yet`,

  completion: (telnyxNumber) => `All set! I'm ready on your line. Here's what you can test right now:
• Call this number from another phone — I'll answer
• Text this number — I'll respond as your AI
• Share it with a lead or family member

Your dedicated number: ${telnyxNumber}

Setup complete. 🎉`,
};

/**
 * Process an inbound SMS message through the onboarding state machine
 * or forward to Personal.ai if onboarding is complete
 */
async function processInboundMessage(userPhone, messageText, channel = 'sms') {
  let user = db.getUserByPhone(userPhone);

  // If user doesn't exist yet, create them (edge case)
  if (!user) {
    user = db.createUser(userPhone);
    db.createOnboardingState(userPhone);
  }

  // Save inbound message
  db.saveMessage({
    userPhone,
    channel,
    direction: 'inbound',
    content: messageText,
  });

  // Get onboarding state
  let state = db.getOnboardingState(userPhone);
  if (!state) {
    state = db.createOnboardingState(userPhone);
  }

  let responseText;

  if (user.setup_complete) {
    // Onboarding done — route to Personal.ai
    responseText = await handlePostOnboardingMessage(userPhone, messageText, channel);
  } else {
    // Run through onboarding state machine
    responseText = await handleOnboardingStep(userPhone, messageText, state, user);
  }

  // Save outbound message
  db.saveMessage({
    userPhone,
    channel,
    direction: 'outbound',
    content: responseText,
  });

  // Send the response via appropriate channel
  await sendResponse(userPhone, responseText, channel, user);

  return responseText;
}

/**
 * Handle a message during the onboarding flow
 */
async function handleOnboardingStep(userPhone, messageText, state, user) {
  const choices = JSON.parse(state.choices || '{}');
  const input = messageText.trim().toLowerCase();

  switch (state.step) {
    case STEPS.WELCOME: {
      // First message from user — parse which use cases they want
      const useCases = parseUseCaseSelection(input);
      choices.useCases = useCases.length > 0 ? useCases : ['screen_callers'];

      // Upload use case choices as memories
      await personalAiService.uploadMemory(
        `User wants to use Personal AI for: ${choices.useCases.join(', ')}`,
        userPhone,
        'preferences',
        ['use-cases']
      );

      db.updateOnboardingState(userPhone, STEPS.USE_CASE_SELECT, choices);
      return MESSAGES.use_case_followup;
    }

    case STEPS.USE_CASE_SELECT: {
      // Parse voice mode preference
      const voiceMode = parseVoiceMode(input);
      choices.voiceMode = voiceMode;

      // Update user voice mode in db
      db.updateUser(userPhone, { voice_mode: voiceMode });

      await personalAiService.uploadMemory(
        `User prefers AI voice mode: ${voiceMode}`,
        userPhone,
        'preferences',
        ['voice-mode']
      );

      db.updateOnboardingState(userPhone, STEPS.VOICE_MODE, choices);
      return MESSAGES.lead_handling;
    }

    case STEPS.VOICE_MODE: {
      // Parse lead handling preference
      const leadHandling = parseLeadHandling(input);
      choices.leadHandling = leadHandling;

      db.updateUser(userPhone, { lead_handling: leadHandling });

      await personalAiService.uploadMemory(
        `User lead handling preference: ${leadHandling}`,
        userPhone,
        'work',
        ['leads']
      );

      db.updateOnboardingState(userPhone, STEPS.LEAD_HANDLING, choices);
      return MESSAGES.upload_prompt;
    }

    case STEPS.LEAD_HANDLING: {
      // Handle document/LinkedIn/skip
      const uploadChoice = parseUploadChoice(input);
      choices.uploadChoice = uploadChoice;

      if (uploadChoice === 'linkedin' || input.includes('linkedin.com')) {
        const url = extractUrl(messageText) || messageText;
        choices.linkedinUrl = url;
        await personalAiService.uploadMemory(
          `User LinkedIn profile: ${url}`,
          userPhone,
          'identity',
          ['linkedin']
        );
      } else if (uploadChoice === 'doc') {
        await personalAiService.uploadMemory(
          `User shared document info: ${messageText}`,
          userPhone,
          'work',
          ['document']
        );
      }

      db.updateOnboardingState(userPhone, STEPS.UPLOAD_PROMPT, choices);
      return MESSAGES.family_mode;
    }

    case STEPS.UPLOAD_PROMPT: {
      // Parse family mode preference
      const familyMode = parseFamilyMode(input);
      choices.familyMode = familyMode;

      db.updateUser(userPhone, { family_mode: familyMode ? 1 : 0 });

      await personalAiService.uploadMemory(
        `User family mode preference: ${familyMode ? 'enabled' : 'disabled'}`,
        userPhone,
        'family',
        ['family-mode']
      );

      db.updateOnboardingState(userPhone, STEPS.FAMILY_MODE, choices);

      // Get the user's Telnyx number for the completion message
      const user = db.getUserByPhone(userPhone);
      const telnyxNum = user?.telnyx_number || 'your dedicated number';

      // Mark setup as complete
      db.updateUser(userPhone, { setup_complete: 1 });
      db.updateOnboardingState(userPhone, STEPS.COMPLETE, choices);

      // Upload final summary memory
      await personalAiService.uploadMemory(
        `Onboarding complete. Summary: useCases=${choices.useCases?.join(',')}, voiceMode=${choices.voiceMode}, leadHandling=${choices.leadHandling}, familyMode=${familyMode}`,
        userPhone,
        'identity',
        ['onboarding-complete']
      );

      // Save memories to local DB
      db.saveMemory({ userPhone, category: 'preferences', label: `Voice mode: ${choices.voiceMode}`, source: 'onboarding' });
      db.saveMemory({ userPhone, category: 'preferences', label: `Lead handling: ${choices.leadHandling}`, source: 'onboarding' });
      db.saveMemory({ userPhone, category: 'family', label: `Family mode: ${familyMode ? 'on' : 'off'}`, source: 'onboarding' });

      return MESSAGES.completion(telnyxNum);
    }

    case STEPS.FAMILY_MODE:
    case STEPS.APP_HANDOFF:
    case STEPS.COMPLETE: {
      // Route to Personal.ai
      return handlePostOnboardingMessage(userPhone, messageText, 'sms');
    }

    default: {
      db.updateOnboardingState(userPhone, STEPS.WELCOME, {});
      return MESSAGES.welcome;
    }
  }
}

/**
 * After onboarding is complete, route all messages to Personal.ai
 */
async function handlePostOnboardingMessage(userPhone, messageText, channel = 'sms') {
  const sourceMap = {
    sms: 'SMS',
    voice: 'Voice',
    whatsapp_text: 'WhatsApp',
    whatsapp_voice: 'WhatsApp',
  };

  const result = await personalAiService.sendMessage(
    messageText,
    userPhone,
    sourceMap[channel] || 'SMS'
  );

  return result.message || "I'm here. What's on your mind?";
}

/**
 * Send a response via the appropriate channel
 */
async function sendResponse(userPhone, responseText, channel, user) {
  if (!user?.telnyx_number) {
    console.warn(`No Telnyx number for ${userPhone}, skipping send`);
    return;
  }

  try {
    if (channel === 'whatsapp_text' || channel === 'whatsapp_voice') {
      await telnyxService.sendWhatsApp(user.telnyx_number, userPhone, responseText);
    } else {
      // SMS (default)
      await telnyxService.sendSms(
        user.telnyx_number,
        userPhone,
        responseText,
        user.messaging_profile_id
      );
    }
  } catch (err) {
    console.error(`Failed to send ${channel} response to ${userPhone}:`, err.message);
  }
}

/**
 * Send the initial welcome SMS after provisioning
 */
async function sendWelcomeMessage(userPhone, telnyxNumber, messagingProfileId) {
  try {
    const welcomeMsg = MESSAGES.welcome;

    await telnyxService.sendSms(
      telnyxNumber,
      userPhone,
      welcomeMsg,
      messagingProfileId
    );

    // Save the outbound welcome message
    db.saveMessage({
      userPhone,
      channel: 'sms',
      direction: 'outbound',
      content: welcomeMsg,
    });

    return welcomeMsg;
  } catch (err) {
    console.error('Failed to send welcome message:', err.message);
    throw err;
  }
}

// ----- Parsing helpers -----

function parseUseCaseSelection(input) {
  const useCases = [];
  if (input.includes('1') || input.includes('screen') || input.includes('caller')) {
    useCases.push('screen_callers');
  }
  if (input.includes('2') || input.includes('lead')) {
    useCases.push('handle_leads');
  }
  if (input.includes('3') || input.includes('family')) {
    useCases.push('family_messages');
  }
  return useCases;
}

function parseVoiceMode(input) {
  if (input.includes('2') || input.includes('as you') || input.includes('as me')) {
    return 'as_me';
  }
  if (input.includes('3') || input.includes('surprise')) {
    return 'surprise';
  }
  return 'assistant'; // default: option 1
}

function parseLeadHandling(input) {
  if (input.includes('1') || input.includes('full') || input.includes('yes')) {
    return 'full';
  }
  if (input.includes('2') || input.includes('qualify')) {
    return 'qualify';
  }
  return 'none'; // option 3: skip
}

function parseUploadChoice(input) {
  if (input.includes('1') || input.includes('linkedin')) {
    return 'linkedin';
  }
  if (input.includes('2') || input.includes('doc') || input.includes('send')) {
    return 'doc';
  }
  return 'skip'; // option 3
}

function parseFamilyMode(input) {
  if (input.includes('1') || input.includes('yes')) {
    return true;
  }
  return false;
}

function extractUrl(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const match = text.match(urlRegex);
  return match ? match[0] : null;
}

module.exports = {
  STEPS,
  MESSAGES,
  processInboundMessage,
  sendWelcomeMessage,
  handlePostOnboardingMessage,
};
