/**
 * Normalize a phone number to E.164 format
 * @param {string} phone
 * @returns {string} E.164 formatted phone number
 */
function normalizePhone(phone) {
  if (!phone) return null;

  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');

  // Handle US numbers
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // Handle numbers with country code
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  // Already includes country code
  if (digits.length > 11) {
    return `+${digits}`;
  }

  // Return with + prefix if it starts with +
  if (phone.startsWith('+')) {
    return `+${digits}`;
  }

  return `+${digits}`;
}

/**
 * Convert E.164 phone to Personal.ai domain (strip the +)
 * @param {string} e164Phone
 * @returns {string}
 */
function phoneToDomain(e164Phone) {
  return e164Phone.replace('+', '');
}

/**
 * Format phone for display
 * @param {string} phone E.164 format
 * @returns {string}
 */
function formatPhoneDisplay(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    const local = digits.slice(1);
    return `+1 (${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  }
  return phone;
}

/**
 * Validate E.164 phone number
 * @param {string} phone
 * @returns {boolean}
 */
function isValidPhone(phone) {
  return /^\+[1-9]\d{6,14}$/.test(phone);
}

module.exports = { normalizePhone, phoneToDomain, formatPhoneDisplay, isValidPhone };
