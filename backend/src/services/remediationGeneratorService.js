const OpenAI = require('openai');
const RemediationUnit = require('../models/RemediationUnit');
const FailureSignal = require('../models/FailureSignal');
const curriculumService = require('./curriculumService');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const CATEGORY_TO_GROUP = RemediationUnit.CATEGORY_TO_GROUP;

// ═══════════════════════════════════════════════════════════════════
// Remediation Generator — group-aware prompt strategy
// ═══════════════════════════════════════════════════════════════════

class RemediationGeneratorService {

  async generateRemediationPlan(session) {
    try {
      const failures = await FailureSignal.getConfirmed(session._id);

      if (!failures || failures.length === 0) {
        throw new Error('No confirmed failures to remediate');
      }

      const remediationUnits = [];

      for (let i = 0; i < failures.length; i++) {
        const failure = failures[i];
        const remediation = await this.generateRemediationUnit(
          session, failure, i + 1, failures.length
        );
        remediationUnits.push(remediation);
      }

      session.remediationPlan = remediationUnits.map(r => r._id);
      await session.updateStatus('remediation-generated');

      return remediationUnits;
    } catch (error) {
      console.error('Remediation generation error:', error);
      throw new Error(`Remediation generation failed: ${error.message}`);
    }
  }

  async generateRemediationUnit(session, failure, priority, totalFailures) {
    const failureTopic = failure.detectedConcepts?.[0] || failure.specificIssue || null;
    const failureSkills = failure.detectedConcepts || [];
    const curriculumContext = await curriculumService.getRemediationContext(
      session.learningScope, failureTopic, failureSkills
    );

    const group = CATEGORY_TO_GROUP[failure.category] || 'fix-process';
    const subject = session.learningScope.subject || 'the subject';

    const systemPrompt = `You are a diagnostic assistant for ${session.learningScope.curriculum} ${session.learningScope.level} ${subject} in ${session.learningScope.country}. You do NOT teach — you help students understand what went wrong and guide them on what to focus on. Use the methods, notation, and terminology from their curriculum.`;

    const prompt = this._buildGroupPrompt(group, session, failure, priority, totalFailures, curriculumContext);

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 4096,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' }
    });

    const data = JSON.parse(response.choices[0].message.content.trim());

    const unit = await RemediationUnit.create({
      sessionId: session._id,
      failureSignalId: failure._id,
      priority,
      title: data.title,
      diagnosis: data.diagnosis,
      rootCause: failure.rootCause,
      remediationGroup: group,
      learningSteps: data.learningSteps || [],
      practiceProblems: data.practiceProblems || [],
      successChecks: data.successChecks || [],
      conceptGuidance: data.conceptGuidance || null,
      ruleReminder: data.ruleReminder || null,
      approachComparison: data.approachComparison || null,
      selfReviewChecklist: data.selfReviewChecklist || [],
      totalEstimatedTimeMinutes: data.totalEstimatedTimeMinutes,
      prerequisiteChain: failure.prerequisiteChain || null
    });

    return unit;
  }

  // ─── Shared context block ────────────────────────────────────────

  _buildContext(session, failure, priority, totalFailures, curriculumContext) {
    const evidenceText = failure.evidence.map(e =>
      `Q${e.questionNumber}:${e.questionRequires ? ` [Required: ${e.questionRequires}]` : ''}${e.expectedApproach ? ` [Expected: ${e.expectedApproach}]` : ''}\n  Student wrote: "${e.studentAnswer}" — correct: "${e.correctAnswer || 'unknown'}"\n  Analysis: ${e.reasoning}`
    ).join('\n');

    return `STUDENT CONTEXT:
- Level: ${session.learningScope.level}
- Curriculum: ${session.learningScope.curriculum}
- Country: ${session.learningScope.country}
${session.learningScope.subject ? `- Subject: ${session.learningScope.subject}` : ''}

DETECTED FAILURE:
- Category: ${failure.category}
- Issue: ${failure.specificIssue}
- Root Cause: ${failure.rootCause}
- Misconception: ${failure.misconceptionDescription || 'N/A'}
- Severity: ${failure.severity}
- Affected Questions: ${failure.affectedQuestions?.join(', ') || 'N/A'}

EVIDENCE:
${evidenceText}

${failure.prerequisiteChain ? `PREREQUISITE GAP:
- Current Topic: ${failure.prerequisiteChain.currentTopic}
- Missing: ${failure.prerequisiteChain.immediatePrerequisite}
- Gap Level: ${failure.prerequisiteChain.gapLevel || 'Same grade'}
` : ''}PRIORITY: ${priority} of ${totalFailures} (${failure.severity} severity)

${curriculumContext ? `CURRICULUM CONTEXT (ground truth):\n${curriculumContext}\n` : ''}FORMATTING: Use LaTeX in $ delimiters for mathematical/scientific expressions (e.g. $x^2 + 3x$, $\\frac{1}{2}$). For non-math subjects, use plain text.`;
  }

  // ─── Group-specific prompts ──────────────────────────────────────

  _buildGroupPrompt(group, session, failure, priority, totalFailures, curriculumContext) {
    const context = this._buildContext(session, failure, priority, totalFailures, curriculumContext);

    switch (group) {
      case 'understand-gap':
        return this._promptUnderstandGap(context, session);
      case 'fix-process':
        return this._promptFixProcess(context, session);
      case 'rethink-approach':
        return this._promptRethinkApproach(context, session);
      case 'quick-check':
        return this._promptQuickCheck(context, session);
      default:
        return this._promptFixProcess(context, session);
    }
  }

  // ── GROUP 1: understand-gap ──────────────────────────────────────
  // Conceptual/prerequisite gaps. Don't teach — point to what to study.

  _promptUnderstandGap(context, session) {
    return `${context}

REMEDIATION GROUP: UNDERSTAND THE GAP
The student has a conceptual misunderstanding or prerequisite gap. Your job is NOT to teach — it's to:
1. Clearly explain what they seem to believe vs how it actually works
2. Point them to the specific topics/concepts within their ${session.learningScope.curriculum} curriculum to revisit
3. Give them a few key ideas to focus on when studying
4. Provide ONE self-check question so they can verify they've addressed the gap after studying on their own

Keep it diagnostic, not tutorial. Tone: "Here's what seems off and where to focus."

Return JSON:
{
  "title": "Short title (e.g. 'Understanding Factorisation')",
  "diagnosis": "2-3 sentences TO the student, friendly. Explain what you noticed without being harsh.",
  "conceptGuidance": {
    "misconception": "What the student seems to believe or be confused about (in plain language, written TO the student, e.g. 'You seem to think that...')",
    "correctConcept": "How it actually works — brief, clear, 1-2 sentences (not a full lesson)",
    "topicsToReview": ["Specific ${session.learningScope.curriculum} topic names to revisit, e.g. 'Algebraic expressions — factorising trinomials'"],
    "keyIdeas": ["2-3 focused bullet points of what to pay attention to when studying"]
  },
  "learningSteps": [
    {
      "stepNumber": 1,
      "description": "Specific guidance on what to revisit — which concept, what to look for. NOT 'go read chapter 3' but 'Review how common factors are identified before attempting trinomial factorisation'",
      "estimatedTimeMinutes": 10
    }
  ],
  "practiceProblems": [
    {
      "problemNumber": 1,
      "question": "ONE self-check question to verify understanding after studying",
      "correctAnswer": "The answer",
      "hint": "A nudge toward the right concept",
      "difficulty": "medium"
    }
  ],
  "successChecks": [
    { "description": "I can explain [concept] in my own words" },
    { "description": "I understand why my original approach was incorrect" }
  ],
  "totalEstimatedTimeMinutes": 15
}

GUIDELINES:
- 2-3 learning steps, ONLY 1 practice problem (it's a check, not a drill), 2 success checks
- topicsToReview should be specific curriculum topic names, NOT textbook references
- Total time: 10-20 minutes (studying happens on their own — this is just the diagnostic guidance)`;
  }

  // ── GROUP 2: fix-process ─────────────────────────────────────────
  // Procedural/rule/execution errors. Quick reminder + targeted drill.

  _promptFixProcess(context, session) {
    return `${context}

REMEDIATION GROUP: FIX THE PROCESS
The student understands the concept but makes errors when executing the procedure or applying the rule. Your job:
1. Give a brief, clear rule/procedure reminder (not a lesson — just the rule stated plainly)
2. Show one quick worked example of the rule applied correctly
3. Provide targeted practice problems so they can confirm the fix sticks

Tone: "You know this — you just need to nail the execution."

Return JSON:
{
  "title": "Short title (e.g. 'Applying the Distributive Law')",
  "diagnosis": "2-3 sentences TO the student. Acknowledge they understand the concept, explain where the process breaks down.",
  "ruleReminder": {
    "rule": "The rule or procedure stated clearly and concisely (e.g. 'When multiplying a bracket by a negative, the sign of EVERY term inside flips')",
    "example": "A brief worked example showing the rule applied correctly (use LaTeX)"
  },
  "learningSteps": [
    {
      "stepNumber": 1,
      "description": "Brief, specific action — what to focus on when practising",
      "estimatedTimeMinutes": 3
    }
  ],
  "practiceProblems": [
    {
      "problemNumber": 1,
      "question": "Targeted problem exercising the exact procedure",
      "correctAnswer": "Answer",
      "hint": "Hint",
      "difficulty": "easy"
    }
  ],
  "successChecks": [
    { "description": "I can apply [rule] correctly without hesitation" }
  ],
  "totalEstimatedTimeMinutes": 15
}

GUIDELINES:
- 1-2 learning steps (brief), 3-5 practice problems (easy → medium → hard), 1-2 success checks
- The practice problems ARE the remediation — this group is drill-focused
- Total time: 10-20 minutes`;
  }

  // ── GROUP 3: rethink-approach ────────────────────────────────────
  // Strategic/reasoning errors. Help recognise which approach to use.

  _promptRethinkApproach(context, session) {
    return `${context}

REMEDIATION GROUP: RETHINK YOUR APPROACH
The student can execute methods but chose the wrong approach or misinterpreted what was needed. Your job:
1. Show what approach they used vs what was actually needed
2. Explain when to use each approach (recognition, not execution)
3. Give a recognition exercise — "which approach fits this problem?"

Tone: "You have the skills — let's work on picking the right tool for the job."

Return JSON:
{
  "title": "Short title (e.g. 'Choosing Between Factorisation Methods')",
  "diagnosis": "2-3 sentences TO the student. Acknowledge their skills, explain the approach mismatch.",
  "approachComparison": {
    "studentApproach": "What the student tried to do and why it didn't fit (written TO student)",
    "correctApproach": "What was actually needed and why it works here",
    "whenToUse": "A clear guideline for when to use which approach (e.g. 'Use [A] when you see [pattern]. Use [B] when...')"
  },
  "learningSteps": [
    {
      "stepNumber": 1,
      "description": "Study the difference between approaches — what clues in the question tell you which to use",
      "estimatedTimeMinutes": 5
    }
  ],
  "practiceProblems": [
    {
      "problemNumber": 1,
      "question": "Given this problem, which approach would you use and why? [describe a problem scenario]",
      "correctAnswer": "The correct approach choice with brief reasoning",
      "hint": "Look at [specific clue in the problem]",
      "difficulty": "medium"
    }
  ],
  "successChecks": [
    { "description": "I can identify which approach to use before starting to solve" }
  ],
  "totalEstimatedTimeMinutes": 12
}

GUIDELINES:
- 1-2 learning steps, 2-3 practice problems (focus on CHOOSING the approach, not just solving), 1-2 success checks
- Practice problems should test recognition: "which method?" not just "solve this"
- Total time: 8-15 minutes`;
  }

  // ── GROUP 4: quick-check ─────────────────────────────────────────
  // Careless slips. Lightest touch — flag it + checklist for next time.

  _promptQuickCheck(context, session) {
    return `${context}

REMEDIATION GROUP: QUICK CHECK
This is a careless slip — the student knows the material but made a minor error. Your job:
1. Briefly flag what happened (don't make it a big deal)
2. Provide a self-review checklist of habits to catch these slips in future tests
3. Optionally one quick problem as a sanity check

Tone: "Nothing to worry about — just a slip. Here's how to catch these next time."

Return JSON:
{
  "title": "Short title (e.g. 'Sign Error in Q3')",
  "diagnosis": "1-2 sentences TO the student. Light, reassuring. Acknowledge it's just a slip.",
  "selfReviewChecklist": [
    { "text": "Re-read the question before answering" },
    { "text": "Check the sign of each term" },
    { "text": "Verify your final answer makes sense" }
  ],
  "learningSteps": [],
  "practiceProblems": [
    {
      "problemNumber": 1,
      "question": "One quick problem targeting the exact type of slip",
      "correctAnswer": "Answer",
      "hint": "Remember to check [the thing they slipped on]",
      "difficulty": "easy"
    }
  ],
  "successChecks": [
    { "description": "I've reviewed my checklist and will use it on my next test" }
  ],
  "totalEstimatedTimeMinutes": 5
}

GUIDELINES:
- NO learning steps (empty array) — this is not a knowledge gap
- 3-5 checklist items tailored to the specific slip type
- 0-1 practice problems (just a sanity check, not a drill)
- 1 success check
- Total time: 3-5 minutes — keep it light
- Do NOT make this feel like punishment for a mistake`;
  }

  // ─── Utility methods (unchanged) ─────────────────────────────────

  async generateMoreProblems(remediationUnit, count = 5) {
    const prompt = `Generate ${count} additional practice problems for:

Title: ${remediationUnit.title}
Root Cause: ${remediationUnit.rootCause}
Group: ${remediationUnit.remediationGroup}
Existing problems: ${remediationUnit.practiceProblems.length}

Return JSON:
{
  "problems": [
    {
      "problemNumber": ${remediationUnit.practiceProblems.length + 1},
      "question": "problem text",
      "correctAnswer": "answer",
      "hint": "helpful hint",
      "difficulty": "easy" | "medium" | "hard"
    }
  ]
}

Make problems progressively harder. Use LaTeX in $ delimiters for math expressions.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });

    const data = JSON.parse(response.choices[0].message.content.trim());

    remediationUnit.practiceProblems.push(...data.problems);
    await remediationUnit.save();

    return data.problems;
  }

  async checkAnswer(problem, studentAnswer) {
    const prompt = `Check if this answer is correct:

Question: ${problem.question}
Correct Answer: ${problem.correctAnswer}
Student Answer: ${studentAnswer}

Return JSON:
{
  "isCorrect": true/false,
  "feedback": "brief explanation",
  "partialCredit": 0.0-1.0
}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });

    return JSON.parse(response.choices[0].message.content.trim());
  }

  async getHint(problem, attemptNumber = 1) {
    const prompt = `Provide a hint for this problem (attempt #${attemptNumber}):

Question: ${problem.question}
Existing Hint: ${problem.hint}

${attemptNumber === 1 ? 'Give a gentle hint without revealing the answer.' : 'Give a more direct hint since this is attempt #' + attemptNumber + '.'}

Return JSON:
{
  "hint": "helpful hint text"
}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });

    return JSON.parse(response.choices[0].message.content.trim());
  }
}

module.exports = new RemediationGeneratorService();
