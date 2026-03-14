const OpenAI = require('openai');
const RemediationUnit = require('../models/RemediationUnit');
const FailureSignal = require('../models/FailureSignal');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

class RemediationGeneratorService {
  /**
   * Generate complete remediation plan for all confirmed failures
   */
  async generateRemediationPlan(session) {
    try {
      // Get all confirmed failures
      const failures = await FailureSignal.getConfirmed(session._id);

      if (!failures || failures.length === 0) {
        throw new Error('No confirmed failures to remediate');
      }

      // Generate remediation for each failure
      const remediationUnits = [];

      for (let i = 0; i < failures.length; i++) {
        const failure = failures[i];
        const remediation = await this.generateRemediationUnit(
          session,
          failure,
          i + 1, // priority
          failures.length
        );

        remediationUnits.push(remediation);
      }

      // Update session
      session.remediationPlan = remediationUnits.map(r => r._id);
      await session.updateStatus('remediation-generated');

      return remediationUnits;
    } catch (error) {
      console.error('Remediation generation error:', error);
      throw new Error(`Remediation generation failed: ${error.message}`);
    }
  }

  /**
   * Generate single remediation unit for a failure
   */
  async generateRemediationUnit(session, failure, priority, totalFailures) {
    const prompt = this.buildRemediationPrompt(session, failure, priority, totalFailures);

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: prompt
      }],
      response_format: { type: 'json_object' }
    });

    const text = response.choices[0].message.content.trim();
    const remediationData = JSON.parse(text);

    // Create RemediationUnit
    const unit = await RemediationUnit.create({
      sessionId: session._id,
      failureSignalId: failure._id,
      priority,
      title: remediationData.title,
      diagnosis: remediationData.diagnosis,
      rootCause: failure.rootCause,
      remediationType: remediationData.remediationType,
      learningSteps: remediationData.learningSteps,
      practiceProblems: remediationData.practiceProblems || [],
      successChecks: remediationData.successChecks,
      totalEstimatedTimeMinutes: remediationData.totalEstimatedTimeMinutes,
      prerequisiteChain: failure.prerequisiteChain || null
    });

    return unit;
  }

  /**
   * Build remediation generation prompt
   */
  buildRemediationPrompt(session, failure, priority, totalFailures) {
    const evidenceText = failure.evidence.map(e =>
      `Question ${e.questionNumber}: "${e.studentAnswer}" (should be "${e.correctAnswer || 'correct'}")`
    ).join('\n');

    return `You are creating a personalized remediation plan for a ${session.learningScope.grade} student in ${session.learningScope.country} (${session.learningScope.curriculum} curriculum).

DETECTED FAILURE:
Category: ${failure.category}
Specific Issue: ${failure.specificIssue}
Root Cause: ${failure.rootCause}
Misconception: ${failure.misconceptionDescription || 'N/A'}
Evidence:
${evidenceText}

${failure.prerequisiteChain ? `
PREREQUISITE GAP:
Missing: ${failure.prerequisiteChain.gapLevel || 'Unknown'}
Current Topic: ${failure.prerequisiteChain.currentTopic}
` : ''}

PRIORITY: ${priority} of ${totalFailures} (${priority === 1 ? 'HIGHEST' : priority === totalFailures ? 'LOWEST' : 'MEDIUM'})

YOUR TASK:
Create a complete remediation plan with:
1. Learning steps (2-4 steps with time estimates)
2. Practice problems (3-5 AI-generated problems)
3. Success checks (specific validation criteria)
4. Remediation type (choose one: concept-review, practice-problems, prerequisite-work, boundary-testing)

REMEDIATION TYPE GUIDELINES:
- concept-review: If they don't understand the core concept
- practice-problems: If they understand but need more practice
- prerequisite-work: If they're missing foundational knowledge
- boundary-testing: If they need to master edge cases

Return JSON in this format:
{
  "title": "Fix Sign Rules for Negative Multiplication",
  "diagnosis": "What's wrong (1 sentence)",
  "remediationType": "concept-review" | "practice-problems" | "prerequisite-work" | "boundary-testing",
  "learningSteps": [
    {
      "stepNumber": 1,
      "description": "Review sign rule explanation: negative × negative = positive",
      "estimatedTimeMinutes": 5,
      "resources": ["Khan Academy: Multiplying Negative Numbers", "Practice worksheet link"]
    },
    {
      "stepNumber": 2,
      "description": "Practice 10 basic examples of negative multiplication",
      "estimatedTimeMinutes": 10,
      "resources": []
    }
  ],
  "practiceProblems": [
    {
      "problemNumber": 1,
      "question": "Calculate: -3 × -4",
      "correctAnswer": "12",
      "hint": "Remember: negative × negative = positive",
      "difficulty": "easy"
    },
    {
      "problemNumber": 2,
      "question": "Simplify: -2(x - 5)",
      "correctAnswer": "-2x + 10",
      "hint": "Distribute -2 to both terms",
      "difficulty": "medium"
    }
  ],
  "successChecks": [
    {
      "description": "Can state the sign rules correctly without reference"
    },
    {
      "description": "Can solve -5(x - 7) without errors"
    },
    {
      "description": "Can explain WHY negative × negative = positive"
    }
  ],
  "totalEstimatedTimeMinutes": 25
}

IMPORTANT:
- Make steps SPECIFIC and actionable (not generic)
- Generate actual practice problems (not placeholders)
- Make success checks testable and clear
- Consider grade level (${session.learningScope.grade})
- Total time should be realistic (15-45 minutes per unit)
- Include 3-5 practice problems of varying difficulty
- All problems must be solvable and have correct answers`;
  }

  /**
   * Generate additional practice problems for a remediation unit
   */
  async generateMoreProblems(remediationUnit, count = 5) {
    const prompt = `Generate ${count} additional practice problems for this remediation:

Title: ${remediationUnit.title}
Root Cause: ${remediationUnit.rootCause}
Type: ${remediationUnit.remediationType}

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

Make problems progressively harder.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });

    const text = response.choices[0].message.content.trim();
    const data = JSON.parse(text);

    // Add problems to unit
    remediationUnit.practiceProblems.push(...data.problems);
    await remediationUnit.save();

    return data.problems;
  }

  /**
   * Check if student answer is correct for a practice problem
   */
  async checkAnswer(problem, studentAnswer) {
    const prompt = `Check if this answer is correct:

Question: ${problem.question}
Correct Answer: ${problem.correctAnswer}
Student Answer: ${studentAnswer}

Return JSON:
{
  "isCorrect": true/false,
  "feedback": "brief explanation of why correct or incorrect",
  "partialCredit": 0.0-1.0 (if partially correct)
}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });

    const text = response.choices[0].message.content.trim();
    return JSON.parse(text);
  }

  /**
   * Get hints for a practice problem
   */
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

    const text = response.choices[0].message.content.trim();
    return JSON.parse(text);
  }
}

module.exports = new RemediationGeneratorService();
