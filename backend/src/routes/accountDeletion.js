const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { verifyFirebaseToken } = require('../config/firebase');
const { User, Session, FailureSignal, RemediationUnit, TutorConversation } = require('../models');

// ── Helpers ──────────────────────────────────────────────────────────────────

const FIREBASE_API_KEY = process.env.FIREBASE_WEB_API_KEY; // add to your .env
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;

// ── GET /account/delete — serve the page ─────────────────────────────────────

router.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
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
    .logo { display: flex; align-items: center; gap: 10px; margin-bottom: 28px; }
    .logo-icon {
      width: 40px; height: 40px; border-radius: 10px;
      background: linear-gradient(135deg, #6366f1, #4f46e5);
      display: flex; align-items: center; justify-content: center; font-size: 20px;
    }
    .logo-text { font-size: 17px; font-weight: 800; color: #1e293b; }
    h1 { font-size: 22px; font-weight: 800; color: #1e293b; margin-bottom: 10px; }
    .description { color: #64748b; font-size: 14px; line-height: 1.65; margin-bottom: 24px; }
    .warning {
      background: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px;
      padding: 14px 16px; font-size: 13px; color: #9a3412; line-height: 1.6; margin-bottom: 24px;
    }
    .success-box {
      background: #dcfce7; border: 1px solid #86efac; border-radius: 10px;
      padding: 20px; text-align: center; display: none;
    }
    .success-box .tick { font-size: 36px; margin-bottom: 10px; }
    .success-box h2 { font-size: 18px; font-weight: 700; color: #166534; margin-bottom: 6px; }
    .success-box p { font-size: 14px; color: #166534; line-height: 1.5; }
    label { display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; margin-bottom: 8px; }
    input {
      width: 100%; padding: 12px 14px; font-size: 16px;
      border: 1px solid #cbd5e1; border-radius: 10px; margin-bottom: 16px;
      outline: none; transition: border-color 0.15s;
    }
    input:focus { border-color: #6366f1; }
    .btn {
      width: 100%; padding: 14px; border: none; border-radius: 10px;
      font-size: 16px; font-weight: 700; cursor: pointer; transition: opacity 0.15s;
    }
    .btn-delete { background: #ef4444; color: #fff; margin-top: 4px; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .error-msg {
      margin-top: 14px; padding: 12px 16px; border-radius: 10px;
      font-size: 13px; color: #991b1b; background: #fee2e2; display: none;
    }
    .step { display: none; }
    .step.active { display: block; }
    .step-label {
      font-size: 12px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.5px; color: #94a3b8; margin-bottom: 20px;
    }
    .confirm-email { font-weight: 700; color: #1e293b; word-break: break-all; }
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
      Sign in to verify your identity, then permanently delete your account and all associated data.
    </p>

    <div class="warning">
      ⚠️ This action is permanent and cannot be undone. All your sessions, analysis results,
      remediation plans, and personal data will be deleted immediately.
    </div>

    <!-- Step 1: Sign in -->
    <div id="step-signin" class="step active">
      <div class="step-label">Step 1 of 2 — Verify your identity</div>
      <label for="email">Email address</label>
      <input type="email" id="email" placeholder="you@example.com" />
      <label for="password">Password</label>
      <input type="password" id="password" placeholder="Your password" />
      <button class="btn btn-delete" id="signin-btn" onclick="handleSignIn()">Sign in to continue</button>
      <div id="signin-error" class="error-msg"></div>
    </div>

    <!-- Step 2: Confirm deletion -->
    <div id="step-confirm" class="step">
      <div class="step-label">Step 2 of 2 — Confirm deletion</div>
      <p class="description">
        Signed in as <span id="confirm-email" class="confirm-email"></span>.<br><br>
        Click the button below to permanently delete your account and all your data.
        This cannot be undone.
      </p>
      <button class="btn btn-delete" id="delete-btn" onclick="handleDelete()">Yes, permanently delete my account</button>
      <div id="delete-error" class="error-msg"></div>
    </div>

    <!-- Success -->
    <div id="step-success" class="success-box">
      <div class="tick">✅</div>
      <h2>Account deleted</h2>
      <p>Your account and all associated data have been permanently deleted. You can close this page.</p>
    </div>
  </div>

  <script type="module">
    import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
    import { getAuth, signInWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

    const app = initializeApp({
      apiKey: '${FIREBASE_API_KEY}',
      authDomain: '${FIREBASE_PROJECT_ID}.firebaseapp.com',
      projectId: '${FIREBASE_PROJECT_ID}',
    });
    const auth = getAuth(app);

    let idToken = null;

    window.handleSignIn = async () => {
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      const btn = document.getElementById('signin-btn');
      const errEl = document.getElementById('signin-error');
      errEl.style.display = 'none';

      if (!email || !password) { showError(errEl, 'Please enter your email and password.'); return; }

      btn.disabled = true;
      btn.textContent = 'Signing in…';
      try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        idToken = await cred.user.getIdToken();
        document.getElementById('confirm-email').textContent = cred.user.email;
        setStep('confirm');
      } catch (err) {
        showError(errEl, friendlyError(err));
      } finally {
        btn.disabled = false;
        btn.textContent = 'Sign in to continue';
      }
    };

    window.handleDelete = async () => {
      const btn = document.getElementById('delete-btn');
      const errEl = document.getElementById('delete-error');
      errEl.style.display = 'none';

      btn.disabled = true;
      btn.textContent = 'Deleting…';
      try {
        const res = await fetch('/account/delete', {
          method: 'DELETE',
          headers: { Authorization: 'Bearer ' + idToken },
        });
        const data = await res.json();
        if (res.ok && data.success) {
          setStep('success');
        } else {
          showError(errEl, data.message || 'Deletion failed. Please try again.');
        }
      } catch (e) {
        showError(errEl, 'Network error. Please check your connection and try again.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Yes, permanently delete my account';
      }
    };

    function setStep(name) {
      ['signin', 'confirm'].forEach(s => {
        document.getElementById('step-' + s).classList.remove('active');
      });
      if (name === 'success') {
        document.getElementById('step-success').style.display = 'block';
      } else {
        document.getElementById('step-' + name).classList.add('active');
      }
    }

    function showError(el, msg) {
      el.textContent = msg;
      el.style.display = 'block';
    }

    function friendlyError(err) {
      const code = err?.code || '';
      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found')
        return 'Incorrect email or password.';
      if (code === 'auth/too-many-requests')
        return 'Too many attempts. Please try again later.';
      if (code === 'auth/network-request-failed')
        return 'Network error. Check your connection.';
      return err?.message || 'Sign-in failed. Please try again.';
    }
  </script>
</body>
</html>`);
});

// ── DELETE /account/delete — authenticated, deletes all user data ─────────────

router.delete('/', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const token = authHeader.slice('Bearer '.length).trim();
    const decoded = await verifyFirebaseToken(token);
    const firebaseUid = decoded.uid;

    const user = await User.findOne({ firebaseUid });
    if (!user) {
      // Already deleted or never existed — treat as success
      return res.json({ success: true });
    }

    const userId = user._id;

    // 1. Get all session IDs belonging to this user
    const sessions = await Session.find({ userId }).select('_id');
    const sessionIds = sessions.map(s => s._id);

    // 2. Delete all related data in parallel
    await Promise.all([
      FailureSignal.deleteMany({ sessionId: { $in: sessionIds } }),
      RemediationUnit.deleteMany({ sessionId: { $in: sessionIds } }),
      TutorConversation.deleteMany({ sessionId: { $in: sessionIds } }),
    ]);

    // 3. Delete sessions
    await Session.deleteMany({ userId });

    // 4. Delete the user document
    await User.deleteOne({ _id: userId });

    // 5. Delete the Firebase Auth account so the user can't sign in again
    try {
      await admin.auth().deleteUser(firebaseUid);
    } catch (fbErr) {
      // Non-fatal — data is already gone
      console.error('Firebase user deletion error:', fbErr.message);
    }

    console.log(`Account permanently deleted: ${user.email} (${firebaseUid})`);
    res.json({ success: true });
  } catch (error) {
    console.error('Account deletion error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete account. Please try again.' });
  }
});

module.exports = router;
