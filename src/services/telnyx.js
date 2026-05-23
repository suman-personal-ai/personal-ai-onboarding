const axios = require('axios');
const config = require('../config');

const TELNYX_BASE = 'https://api.telnyx.com/v2';

function telnyxHeaders() {
  return {
    'Authorization': `Bearer ${config.telnyx.apiKey}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

/**
 * Search for available US phone numbers with SMS + voice features
 */
async function searchAvailableNumbers(areaCode = null) {
  try {
    const params = {
      'filter[country_code]': 'US',
      'filter[features][]': ['sms', 'voice'],
      'filter[limit]': 5,
    };

    if (areaCode) {
      params['filter[national_destination_code]'] = areaCode;
    }

    const response = await axios.get(`${TELNYX_BASE}/available_phone_numbers`, {
      headers: telnyxHeaders(),
      params,
    });

    return response.data.data || [];
  } catch (error) {
    console.error('Error searching numbers:', error.response?.data || error.message);
    throw new Error(`Failed to search numbers: ${error.response?.data?.errors?.[0]?.detail || error.message}`);
  }
}

/**
 * Create a messaging profile for a user
 */
async function createMessagingProfile(userPhone) {
  try {
    const response = await axios.post(`${TELNYX_BASE}/messaging_profiles`, {
      name: `PAI-${userPhone.replace('+', '')}`,
      webhook_url: `${config.baseUrl}/webhook/telnyx`,
      webhook_failover_url: '',
      enabled: true,
    }, {
      headers: telnyxHeaders(),
    });

    return response.data.data;
  } catch (error) {
    console.error('Error creating messaging profile:', error.response?.data || error.message);
    throw new Error(`Failed to create messaging profile: ${error.response?.data?.errors?.[0]?.detail || error.message}`);
  }
}

/**
 * Order a phone number
 */
async function orderPhoneNumber(phoneNumber, messagingProfileId) {
  try {
    const orderData = {
      phone_numbers: [{ phone_number: phoneNumber }],
    };

    if (messagingProfileId) {
      orderData.messaging_profile_id = messagingProfileId;
    }

    const response = await axios.post(`${TELNYX_BASE}/number_orders`, orderData, {
      headers: telnyxHeaders(),
    });

    return response.data.data;
  } catch (error) {
    console.error('Error ordering phone number:', error.response?.data || error.message);
    throw new Error(`Failed to order phone number: ${error.response?.data?.errors?.[0]?.detail || error.message}`);
  }
}

/**
 * Wait for number order to complete
 */
async function waitForNumberOrder(orderId, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await axios.get(`${TELNYX_BASE}/number_orders/${orderId}`, {
        headers: telnyxHeaders(),
      });

      const order = response.data.data;
      if (order.status === 'success') {
        return order;
      } else if (order.status === 'failed') {
        throw new Error('Number order failed');
      }

      // Wait 2 seconds before next attempt
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      if (error.message === 'Number order failed') throw error;
      console.error('Error checking order status:', error.message);
    }
  }
  throw new Error('Number order timed out');
}

/**
 * Assign messaging profile to a phone number
 */
async function assignMessagingProfile(phoneNumberId, messagingProfileId) {
  try {
    const response = await axios.patch(`${TELNYX_BASE}/phone_numbers/${phoneNumberId}`, {
      messaging_profile_id: messagingProfileId,
    }, {
      headers: telnyxHeaders(),
    });

    return response.data.data;
  } catch (error) {
    console.error('Error assigning messaging profile:', error.response?.data || error.message);
    // Non-fatal - continue
    return null;
  }
}

/**
 * Full provisioning flow: search → create profile → order number
 */
async function provisionNumberForUser(userPhone) {
  console.log(`Provisioning number for ${userPhone}...`);

  // 1. Search for available numbers
  const availableNumbers = await searchAvailableNumbers();
  if (!availableNumbers.length) {
    throw new Error('No available phone numbers found');
  }

  const selectedNumber = availableNumbers[0].phone_number;
  console.log(`Selected number: ${selectedNumber}`);

  // 2. Use existing default profile (if configured) or create a per-user profile
  let profileId = config.telnyx.defaultMessagingProfileId;
  if (profileId) {
    console.log(`Using default messaging profile: ${profileId}`);
  } else {
    const profile = await createMessagingProfile(userPhone);
    profileId = profile.id;
    console.log(`Created messaging profile: ${profileId}`);
  }

  // 3. Order the phone number
  const order = await orderPhoneNumber(selectedNumber, profileId);
  console.log(`Order placed: ${order.id}`);

  // 4. Wait for order to complete
  let completedOrder;
  try {
    completedOrder = await waitForNumberOrder(order.id);
  } catch (e) {
    console.warn('Order status check failed, proceeding anyway:', e.message);
    completedOrder = order;
  }

  return {
    phoneNumber: selectedNumber,
    orderId: order.id,
    messagingProfileId: profileId,
    numberRecordId: completedOrder?.phone_numbers?.[0]?.id || null,
  };
}

/**
 * Release (delete) a phone number
 */
async function releasePhoneNumber(phoneNumberId) {
  try {
    await axios.delete(`${TELNYX_BASE}/phone_numbers/${phoneNumberId}`, {
      headers: telnyxHeaders(),
    });
    return true;
  } catch (error) {
    console.error('Error releasing phone number:', error.response?.data || error.message);
    return false;
  }
}

/**
 * Delete a messaging profile
 */
async function deleteMessagingProfile(profileId) {
  try {
    await axios.delete(`${TELNYX_BASE}/messaging_profiles/${profileId}`, {
      headers: telnyxHeaders(),
    });
    return true;
  } catch (error) {
    console.error('Error deleting messaging profile:', error.response?.data || error.message);
    return false;
  }
}

/**
 * Send an SMS message
 */
async function sendSms(from, to, text, messagingProfileId) {
  try {
    const payload = {
      from,
      to,
      text,
    };

    if (messagingProfileId) {
      payload.messaging_profile_id = messagingProfileId;
    }

    const response = await axios.post(`${TELNYX_BASE}/messages`, payload, {
      headers: telnyxHeaders(),
    });

    return response.data.data;
  } catch (error) {
    console.error('Error sending SMS:', error.response?.data || error.message);
    throw new Error(`Failed to send SMS: ${error.response?.data?.errors?.[0]?.detail || error.message}`);
  }
}

/**
 * Send a WhatsApp message
 */
async function sendWhatsApp(from, to, text) {
  try {
    const response = await axios.post(`${TELNYX_BASE}/messages`, {
      from: {
        phone_number: from,
        message_type: 'whatsapp',
      },
      to: {
        phone_number: to,
      },
      text,
    }, {
      headers: telnyxHeaders(),
    });

    return response.data.data;
  } catch (error) {
    console.error('Error sending WhatsApp:', error.response?.data || error.message);
    throw new Error(`Failed to send WhatsApp: ${error.response?.data?.errors?.[0]?.detail || error.message}`);
  }
}

/**
 * Generate TeXML for voice responses
 */
function generateTeXML(options = {}) {
  const { message, gatherAction, gatherPrompt } = options;

  if (gatherAction) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman">${escapeXml(message)}</Say>
  <Gather input="speech" timeout="5" action="${gatherAction}">
    <Say voice="woman">${escapeXml(gatherPrompt || 'What can I help you with?')}</Say>
  </Gather>
</Response>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman">${escapeXml(message)}</Say>
</Response>`;
}

/**
 * Answer a call with TeXML
 */
async function answerCall(callControlId, telnyxWebhookUrl) {
  try {
    const response = await axios.post(
      `${TELNYX_BASE}/calls/${callControlId}/actions/answer`,
      { webhook_url: telnyxWebhookUrl },
      { headers: telnyxHeaders() }
    );
    return response.data.data;
  } catch (error) {
    console.error('Error answering call:', error.response?.data || error.message);
  }
}

/**
 * Speak text on a call
 */
async function speakOnCall(callControlId, text) {
  try {
    const response = await axios.post(
      `${TELNYX_BASE}/calls/${callControlId}/actions/speak`,
      {
        payload: text,
        voice: 'female',
        language: 'en-US',
      },
      { headers: telnyxHeaders() }
    );
    return response.data.data;
  } catch (error) {
    console.error('Error speaking on call:', error.response?.data || error.message);
  }
}

/**
 * Gather speech input on a call
 */
async function gatherSpeech(callControlId, options = {}) {
  try {
    const response = await axios.post(
      `${TELNYX_BASE}/calls/${callControlId}/actions/gather_using_speak`,
      {
        payload: options.prompt || 'What can I help you with?',
        voice: 'female',
        language: 'en-US',
        invalid_payload: 'Sorry, I did not catch that.',
        maximum_tries: 3,
        timeout_millis: 5000,
      },
      { headers: telnyxHeaders() }
    );
    return response.data.data;
  } catch (error) {
    console.error('Error gathering speech:', error.response?.data || error.message);
  }
}

/**
 * Hang up a call
 */
async function hangupCall(callControlId) {
  try {
    await axios.post(
      `${TELNYX_BASE}/calls/${callControlId}/actions/hangup`,
      {},
      { headers: telnyxHeaders() }
    );
  } catch (error) {
    console.error('Error hanging up call:', error.response?.data || error.message);
  }
}

function escapeXml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  searchAvailableNumbers,
  createMessagingProfile,
  orderPhoneNumber,
  waitForNumberOrder,
  provisionNumberForUser,
  releasePhoneNumber,
  deleteMessagingProfile,
  sendSms,
  sendWhatsApp,
  generateTeXML,
  answerCall,
  speakOnCall,
  gatherSpeech,
  hangupCall,
};
