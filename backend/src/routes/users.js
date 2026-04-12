const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// GET /api/users/me — fetch current user profile
router.get('/me', async (req, res) => {
  try {
    const user = await User.findById(req.user.mongoId).select('email displayName createdAt');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        displayName: user.displayName || '',
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to get profile' });
  }
});

// PATCH /api/users/me — update display name
router.patch('/me', async (req, res) => {
  try {
    const { displayName } = req.body;

    if (typeof displayName !== 'string' || displayName.trim().length > 100) {
      return res.status(400).json({
        success: false,
        message: 'displayName must be a string (max 100 characters)',
      });
    }

    const user = await User.findByIdAndUpdate(
      req.user.mongoId,
      { $set: { displayName: displayName.trim() } },
      { new: true }
    ).select('email displayName');

    res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        displayName: user.displayName || '',
      },
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
});

module.exports = router;
