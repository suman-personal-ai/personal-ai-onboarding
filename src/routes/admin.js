const express = require('express');
const router = express.Router();
const db = require('../db');
const telnyxService = require('../services/telnyx');
const { normalizePhone } = require('../utils/phone');

/**
 * GET /admin/api/stats
 * Overall platform statistics
 */
router.get('/stats', (req, res) => {
  try {
    const users = db.getAllUsers();
    const { totalMessages, totalTokens, channelStats } = db.getMessageStats();
    const allMessages = db.getAllMessages(50);

    const stats = {
      totalUsers: users.length,
      activeUsers: users.filter(u => u.setup_complete).length,
      totalMessages,
      totalTokens,
      channelBreakdown: channelStats,
      recentActivity: allMessages.slice(0, 20),
    };

    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/api/users
 * List all users with summary data
 */
router.get('/users', (req, res) => {
  try {
    const users = db.getAllUsers();
    const usersWithStats = users.map(user => {
      const messages = db.getMessages(user.user_phone, 1000);
      const memories = db.getMemories(user.user_phone);
      const channelCounts = messages.reduce((acc, m) => {
        acc[m.channel] = (acc[m.channel] || 0) + 1;
        return acc;
      }, {});

      return {
        ...user,
        messageCount: messages.length,
        memoryCount: memories.length,
        channelCounts,
        lastActivity: messages[0]?.created_at || null,
      };
    });

    res.json({ users: usersWithStats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/api/users/:phone
 * Detailed user info
 */
router.get('/users/:phone', (req, res) => {
  try {
    const userPhone = normalizePhone(req.params.phone);
    const user = db.getUserByPhone(userPhone);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const messages = db.getMessages(userPhone, 100);
    const memories = db.getMemories(userPhone);
    const state = db.getOnboardingState(userPhone);

    res.json({ user, messages, memories, onboardingState: state });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/api/messages
 * Recent messages across all users
 */
router.get('/messages', (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const messages = db.getAllMessages(limit);
    res.json({ messages, count: messages.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /admin/api/users/:phone
 * Deprovision a user
 */
router.delete('/users/:phone', async (req, res) => {
  try {
    const userPhone = normalizePhone(req.params.phone);
    const user = db.getUserByPhone(userPhone);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.telnyx_number_id) {
      await telnyxService.releasePhoneNumber(user.telnyx_number_id);
    }
    if (user.messaging_profile_id) {
      await telnyxService.deleteMessagingProfile(user.messaging_profile_id);
    }

    db.deleteUser(userPhone);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
