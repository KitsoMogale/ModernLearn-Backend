const express = require('express');
const router = express.Router();
const User = require('../models/User');

const PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Delete Account — ModernLearn</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f8fafc;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
      padding: 40px 32px;
      max-width: 460px;
      width: 100%;
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 28px;
    }
    .logo-icon {
      width: 40px; height: 40px; border-radius: 10px;
      background: linear-gradient(135deg, #6366f1, #4f46e5);
      display: flex; align-items: center; justify-content: center;
      font-size: 20px;
    }
    .logo-text { font-size: 17px; font-weight: 800; color: #1e293b; }
    h1 { font-size: 22px; font-weight: 800; color: #1e293b; margin-bottom: 10px; }
    .description { color: #64748b; font-size: 14px; line-height: 1.65; margin-bottom: 28px; }
    .warning {
      background: #fff7ed;
      border: 1px solid #fed7aa;
      border-radius: 10px;
      padding: 14px 16px;
      font-size: 13px;
      color: #9a3412;
      line-height: 1.6;
      margin-bottom: 24px;
    }
    label { display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; margin-bottom: 8px; }
    input {
      width: 100%;
      padding: 12px 14px;
      font-size: 16px;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      margin-bottom: 20px;
      outline: none;
      transition: border-color 0.15s;
    }
    input:focus { border-color: #6366f1; }
    button {
      width: 100%;
      padding: 14px;
      background: #ef4444;
      color: #fff;
      border: none;
      border-radius: 10px;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .msg {
      margin-top: 16px;
      padding: 14px 16px;
      border-radius: 10px;
      font-size: 14px;
      line-height: 1.5;
      display: none;
    }
    .msg.success { background: #dcfce7; color: #166534; display: block; }
    .msg.error   { background: #fee2e2; color: #991b1b; display: block; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <div class="logo-icon">🎓</div>
      <span class="logo-text">ModernLearn</span>
    </div>

    <h1>Delete your account</h1>
    <p class="description">
      Enter the email address associated with your ModernLearn account. We will permanently delete
      all your data — sessions, analysis results, remediation plans, and personal information —
      within 30 days of your request.
    </p>

    <div class="warning">
      ⚠️ This action cannot be undone. Once deleted, your data cannot be recovered.
    </div>

    <label for="email">Email address</label>
    <input type="email" id="email" placeholder="you@example.com" />

    <button id="btn" onclick="submitRequest()">Request account deletion</button>
    <div id="msg" class="msg"></div>
  </div>

  <script>
    async function submitRequest() {
      const email = document.getElementById('email').value.trim();
      const btn = document.getElementById('btn');
      if (!email) { showMsg('Please enter your email address.', false); return; }
      btn.disabled = true;
      btn.textContent = 'Submitting…';
      try {
        const res = await fetch('/account/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();
        if (res.ok) {
          showMsg('Your request has been received. Your account and all associated data will be permanently deleted within 30 days.', true);
          document.getElementById('email').value = '';
        } else {
          showMsg(data.message || 'Something went wrong. Please try again.', false);
        }
      } catch (e) {
        showMsg('Network error. Please check your connection and try again.', false);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Request account deletion';
      }
    }
    function showMsg(text, success) {
      const el = document.getElementById('msg');
      el.textContent = text;
      el.className = 'msg ' + (success ? 'success' : 'error');
    }
  </script>
</body>
</html>`;

// GET /account/delete — serve the deletion request page
router.get('/', (req, res) => {
  res.send(PAGE_HTML);
});

// POST /account/delete — mark user for deletion
router.post('/', express.json(), async (req, res) => {
  const { email } = req.body;

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ success: false, message: 'A valid email address is required.' });
  }

  try {
    const trimmed = email.trim().toLowerCase();

    // Mark the user for deletion — a background job or manual review handles the actual purge.
    // If the email doesn't exist we still return success to avoid user enumeration.
    await User.findOneAndUpdate(
      { email: trimmed },
      { $set: { deletionRequestedAt: new Date() } },
      { new: false }
    );

    console.log(`Account deletion requested for: ${trimmed}`);

    res.json({ success: true });
  } catch (error) {
    console.error('Account deletion request error:', error);
    res.status(500).json({ success: false, message: 'Failed to process request. Please try again.' });
  }
});

module.exports = router;
