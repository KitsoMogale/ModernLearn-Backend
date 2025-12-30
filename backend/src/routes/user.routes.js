const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/User');

// All user routes require authentication
router.use(authenticate);

// GET current user profile
router.get('/me', async (req, res) => {
  try {
    res.json({ data: req.user });
  } catch (error) {
    res.status(500).json({ error: { message: error.message, status: 500 } });
  }
});

// PUT update user profile
router.put('/me', async (req, res) => {
  try {
    const { displayName, photoURL } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { displayName, photoURL },
      { new: true, runValidators: true }
    );
    res.json({ data: user });
  } catch (error) {
    res.status(400).json({ error: { message: error.message, status: 400 } });
  }
});

module.exports = router;
