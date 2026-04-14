const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy — ModernLearn</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f8fafc; color: #1e293b; padding: 40px 24px;
    }
    .container { max-width: 720px; margin: 0 auto; }
    .logo { display: flex; align-items: center; gap: 10px; margin-bottom: 40px; }
    .logo-icon {
      width: 40px; height: 40px; border-radius: 10px;
      background: linear-gradient(135deg, #6366f1, #4f46e5);
      display: flex; align-items: center; justify-content: center; font-size: 20px;
    }
    .logo-text { font-size: 17px; font-weight: 800; color: #1e293b; }
    h1 { font-size: 28px; font-weight: 800; margin-bottom: 8px; }
    .updated { font-size: 13px; color: #94a3b8; margin-bottom: 40px; }
    h2 { font-size: 17px; font-weight: 700; margin: 32px 0 10px; color: #1e293b; }
    p, li { font-size: 15px; line-height: 1.75; color: #475569; }
    ul { padding-left: 20px; margin-top: 8px; }
    li { margin-bottom: 6px; }
    a { color: #6366f1; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .divider { height: 1px; background: #e2e8f0; margin: 40px 0; }
    footer { font-size: 13px; color: #94a3b8; margin-top: 48px; padding-bottom: 40px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <div class="logo-icon">&#127891;</div>
      <span class="logo-text">ModernLearn</span>
    </div>

    <h1>Privacy Policy</h1>
    <p class="updated">Last updated: April 14, 2026</p>

    <p>
      ModernLearn ("we", "our", or "us") is committed to protecting your privacy.
      This policy explains what information we collect, how we use it, and your rights regarding your data.
    </p>

    <h2>1. Information We Collect</h2>
    <ul>
      <li><strong>Account information:</strong> Your email address and display name when you create an account.</li>
      <li><strong>Photos of test papers:</strong> Images you upload for analysis. These are stored securely and used solely to provide the diagnosis and remediation features.</li>
      <li><strong>Session data:</strong> Extracted questions, detected learning gaps, remediation plans, and your progress within the app.</li>
      <li><strong>Tutor conversations:</strong> Messages exchanged with the AI study tutor, stored to allow you to resume conversations.</li>
      <li><strong>Usage data:</strong> Basic app usage information such as session creation dates and feature interactions.</li>
    </ul>

    <h2>2. How We Use Your Information</h2>
    <ul>
      <li>To provide and improve the core features of ModernLearn — test analysis, diagnosis, and personalised remediation.</li>
      <li>To authenticate your account and keep your data secure.</li>
      <li>To allow you to resume sessions and track your learning progress over time.</li>
      <li>To send AI-generated feedback and study content relevant to your uploaded material.</li>
    </ul>

    <h2>3. Third-Party Services</h2>
    <p>We use the following third-party services to operate ModernLearn:</p>
    <ul>
      <li><strong>Firebase (Google):</strong> Authentication and secure user account management.</li>
      <li><strong>OpenAI:</strong> AI-powered test analysis and tutor chat. Your uploaded content and questions are sent to OpenAI's API for processing. OpenAI's privacy policy applies to this data.</li>
      <li><strong>MongoDB Atlas:</strong> Secure cloud database storage for your session and profile data.</li>
      <li><strong>Render:</strong> Cloud hosting for our backend server.</li>
      <li><strong>Expo / EAS:</strong> App build and delivery infrastructure.</li>
    </ul>

    <h2>4. Data Retention</h2>
    <p>
      We retain your data for as long as your account is active. If you request account deletion,
      all your personal data — including uploaded images, sessions, remediation plans, tutor conversations,
      and account information — will be permanently deleted within 30 days.
    </p>

    <h2>5. Data Security</h2>
    <p>
      All data transmitted between the app and our servers is encrypted in transit using HTTPS/TLS.
      Data at rest is stored in MongoDB Atlas, which provides encryption at rest and access controls.
      We do not sell your data to any third parties.
    </p>

    <h2>6. Children's Privacy</h2>
    <p>
      ModernLearn is intended for users of all ages, including students. We do not knowingly collect
      personal information from children under 13 without parental consent. If you believe a child
      has provided us with personal information without consent, please contact us and we will
      delete it promptly.
    </p>

    <h2>7. Your Rights</h2>
    <p>You have the right to:</p>
    <ul>
      <li>Access the personal data we hold about you.</li>
      <li>Request correction of inaccurate data.</li>
      <li>Request deletion of your account and all associated data.</li>
      <li>Withdraw consent at any time by deleting your account.</li>
    </ul>
    <p style="margin-top: 12px;">
      To delete your account and all data, visit:
      <a href="/account/delete">/account/delete</a>
    </p>

    <h2>8. Changes to This Policy</h2>
    <p>
      We may update this policy from time to time. We will notify you of significant changes
      by updating the "Last updated" date at the top of this page. Continued use of the app
      after changes constitutes acceptance of the updated policy.
    </p>

    <h2>9. Contact</h2>
    <p>
      If you have any questions or concerns about this privacy policy or your data, please contact us at:
      <a href="mailto:support@modernlearn.app">support@modernlearn.app</a>
    </p>

    <div class="divider"></div>
    <footer>&copy; 2026 ModernLearn. All rights reserved.</footer>
  </div>
</body>
</html>`);
});

module.exports = router;
