const OpenAI = require('openai');
const TutorConversation = require('../models/TutorConversation');
const Session = require('../models/Session');
const User = require('../models/User');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const DAILY_LIMIT = 50;
const MAX_HISTORY_MESSAGES = 40; // keep last N user+assistant messages to avoid token blowup

// ── System prompt builder ──────────────────────────────────────────

function buildSystemPrompt(session, screenContext) {
  const ls = session.learningScope || {};
  const failures = session.detectedFailures || [];
  const plan = session.remediationPlan || [];

  // Format failures
  const failureLines = failures.map((f, i) => {
    const sev = f.severity === 'high' ? 'HIGH' : f.severity === 'medium' ? 'MED' : 'LOW';
    const evidence = (f.evidence || []).map(e => `Q${e.questionNumber}`).join(', ');
    return `${i + 1}. [${sev}] ${f.title || f.name} — ${evidence || 'no evidence'}`;
  }).join('\n');

  // Format plan
  const planLines = plan.map((u, i) => {
    const status = u.status === 'completed' ? '✓' : u.status === 'in-progress' ? '→' : ' ';
    return `Step ${i + 1} ${status} ${u.title}`;
  }).join('\n');

  const completedCount = plan.filter(u => u.status === 'completed').length;
  const progress = plan.length > 0 ? `${completedCount} of ${plan.length} complete` : 'no plan yet';

  // Screen-specific context
  let screenSection = '';
  if (screenContext) {
    const sc = screenContext;
    if (sc.screen === 'DiagnosisScreen' && sc.currentUnit) {
      screenSection = `
STUDENT IS CURRENTLY VIEWING:
Screen: DiagnosisScreen (detailed unit view)
Unit: ${sc.currentUnit.title || 'Unknown'}
Tab: ${sc.currentTab || 'Overview'}
${sc.currentUnit.subConcepts ? `Sub-concepts: ${sc.currentUnit.subConcepts.join(', ')}` : ''}
${sc.linkedFailure ? `Linked failure: ${sc.linkedFailure}` : ''}`;
    } else if (sc.screen === 'RemediationPlan') {
      screenSection = `
STUDENT IS CURRENTLY VIEWING:
Screen: RemediationPlan (learning path map)
Progress: ${progress}`;
    }
  }

  return `You are a patient, encouraging one-on-one tutor helping a student work through their test analysis results and remediation plan. You are fluent in ${ls.curriculum || 'the relevant'} curriculum terminology.

CURRENT SESSION:
Title: ${session.title || 'Untitled'}
Curriculum: ${ls.curriculum || 'Unknown'} · ${ls.level || ''} · ${ls.subject || ''}
Country: ${ls.country || 'Unknown'}
Progress: ${progress}

WHAT THE STUDENT GOT WRONG (prioritized):
${failureLines || '(No failures detected)'}

REMEDIATION PLAN:
${planLines || '(No plan generated yet)'}
${screenSection}

STYLE RULES:
- Answer in 2-4 sentences by default. Go longer only if the student asks for a detailed explanation.
- Refer to plan steps by number ("step 2") not internal IDs.
- Never invent facts, formulas, or concepts not supported by the context above or standard curriculum knowledge.
- If asked about something outside this session (other subjects, personal advice, unrelated homework), gently redirect to the current session.
- Use encouraging, warm tone. This student is learning, not being tested.
- When the student seems confused, break things down into smaller pieces.
- Use simple language appropriate for the student's grade level.
- If the student asks about a specific question from their test, reference the evidence from the failure analysis.`;
}

// ── Rate limiting ──────────────────────────────────────────────────

function getTodayString() {
  return new Date().toISOString().split('T')[0];
}

async function checkAndIncrementRateLimit(conversation) {
  const today = getTodayString();

  // Reset counter on new day
  if (conversation.lastMessageDate !== today) {
    conversation.dailyMessageCount = 0;
    conversation.lastMessageDate = today;
  }

  if (conversation.dailyMessageCount >= DAILY_LIMIT) {
    return false;
  }

  conversation.dailyMessageCount += 1;
  return true;
}

// ── Chat endpoint (streaming) ──────────────────────────────────────

exports.chat = async (req, res) => {
  try {
    const { sessionId, userMessage, screenContext } = req.body;
    const userId = req.user.mongoId;

    if (!sessionId || !userMessage || typeof userMessage !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'sessionId and userMessage are required',
      });
    }

    if (userMessage.length > 2000) {
      return res.status(400).json({
        success: false,
        message: 'Message too long (max 2000 characters)',
      });
    }

    // Load session with populated refs
    const session = await Session.findById(sessionId)
      .populate('detectedFailures')
      .populate('remediationPlan');

    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    if (session.userId.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    // Find or create conversation
    let conversation = await TutorConversation.findOne({ sessionId, userId });
    if (!conversation) {
      conversation = new TutorConversation({ sessionId, userId, messages: [] });
    }

    // Rate limit
    const allowed = await checkAndIncrementRateLimit(conversation);
    if (!allowed) {
      return res.status(429).json({
        success: false,
        message: `Daily message limit reached (${DAILY_LIMIT}). Try again tomorrow.`,
      });
    }

    // Token balance check
    const userDoc = await User.findById(userId).select('tokenBalance');
    if (!userDoc || userDoc.tokenBalance <= 0) {
      return res.status(402).json({
        success: false,
        code: 'INSUFFICIENT_TOKENS',
        message: 'You have no tokens remaining. Purchase more to continue using the AI tutor.',
      });
    }

    // Build messages array for OpenAI
    const systemPrompt = buildSystemPrompt(session, screenContext);

    // Take only the last N messages to stay within token limits
    const historyMessages = conversation.messages.slice(-MAX_HISTORY_MESSAGES);

    const openaiMessages = [
      { role: 'system', content: systemPrompt },
      ...historyMessages.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userMessage },
    ];

    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // for nginx/Render proxy
    });

    // Stream from OpenAI
    const stream = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: openaiMessages,
      stream: true,
      max_tokens: 1000,
      temperature: 0.7,
    });

    let assistantContent = '';

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        assistantContent += delta;
        res.write(`data: ${JSON.stringify({ type: 'delta', content: delta })}\n\n`);
      }

      // Check if stream finished
      if (chunk.choices?.[0]?.finish_reason) {
        break;
      }
    }

    // Persist both messages
    conversation.messages.push(
      { role: 'user', content: userMessage },
      { role: 'assistant', content: assistantContent },
    );

    // Estimate tokens used (rough: 1 token ≈ 4 chars) and deduct from balance
    const estimatedTokens = Math.ceil((userMessage.length + assistantContent.length) / 4);
    const [updatedUser] = await Promise.all([
      User.findByIdAndUpdate(
        userId,
        {
          $inc: {
            tokenBalance: -estimatedTokens,
            totalTokensUsed: estimatedTokens,
          },
        },
        { new: true }
      ).select('tokenBalance'),
      conversation.save(),
    ]);

    const newBalance = Math.max(0, updatedUser?.tokenBalance ?? 0);

    // Send done event with updated balance so client can update UI
    res.write(`data: ${JSON.stringify({ type: 'done', messageId: conversation.messages.length, tokenBalance: newBalance })}\n\n`);
    res.end();

  } catch (error) {
    console.error('Tutor chat error:', error);

    // If headers already sent (mid-stream error), send error event
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Stream interrupted' })}\n\n`);
      res.end();
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to get tutor response',
        error: error.message,
      });
    }
  }
};

// ── Get conversation history ───────────────────────────────────────

exports.getHistory = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.mongoId;

    // Verify session ownership
    const session = await Session.findById(sessionId).select('userId');
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    if (session.userId.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const conversation = await TutorConversation.findOne({ sessionId, userId });

    res.json({
      success: true,
      messages: conversation
        ? conversation.messages.filter(m => m.role !== 'system')
        : [],
    });
  } catch (error) {
    console.error('Get tutor history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load conversation',
      error: error.message,
    });
  }
};
