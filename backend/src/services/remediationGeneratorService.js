const OpenAI = require('openai');
const RemediationUnit = require('../models/RemediationUnit');
const FailureSignal = require('../models/FailureSignal');
const curriculumService = require('./curriculumService');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

class RemediationGeneratorService {
  /**
   * Generate complete remediation plan for all confirmed failures
   */
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
          session,
          failure,
          i + 1,
          failures.length
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

  /**
   * Generate single remediation unit for a failure
   */
  async generateRemediationUnit(session, failure, priority, totalFailures) {
    // Fetch focused curriculum context for this failure's topic and skills
    const failureTopic = failure.detectedConcepts?.[0] || failure.specificIssue || null;
    const failureSkills = failure.detectedConcepts || [];
    const curriculumContext = await curriculumService.getRemediationContext(
      session.learningScope,
      failureTopic,
      failureSkills
    );

    const prompt = this.buildRemediationPrompt(session, failure, priority, totalFailures, curriculumContext);

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 4096,
      messages: [{
        role: 'system',
        content: `You are an expert ${session.learningScope.subject || ''} tutor who creates remediation plans aligned with ${session.learningScope.curriculum} curriculum standards for ${session.learningScope.grade} in ${session.learningScope.country}. Your plans use the methods, notation, and terminology that this student's teachers use.`
      }, {
        role: 'user',
        content: prompt
      }],
      response_format: { type: 'json_object' }
    });

    const text = response.choices[0].message.content.trim();
    const remediationData = JSON.parse(text);

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
   * Build curriculum-aware remediation prompt
   */
  buildRemediationPrompt(session, failure, priority, totalFailures, curriculumContext = null) {
    const evidenceText = failure.evidence.map(e =>
      `Q${e.questionNumber}:${e.questionRequires ? ` [Required: ${e.questionRequires}]` : ''}\n  Student wrote: "${e.studentAnswer}" — correct: "${e.correctAnswer || 'unknown'}"\n  Analysis: ${e.reasoning}`
    ).join('\n');

    return `CREATE A REMEDIATION PLAN

STUDENT CONTEXT:
- Grade: ${session.learningScope.grade}
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
- Missing Prerequisite: ${failure.prerequisiteChain.immediatePrerequisite}
- Gap Level: ${failure.prerequisiteChain.gapLevel || 'Same grade'}
` : ''}

PRIORITY: ${priority} of ${totalFailures} (${failure.severity} severity)

REQUIREMENTS:
1. Learning steps must use ${session.learningScope.curriculum} methods and notation
2. Practice problems must match ${session.learningScope.grade} difficulty level
3. Explanations should reference how this topic is taught in ${session.learningScope.country}
4. If there's a prerequisite gap, include foundation-building steps first
5. Practice problems must be solvable and have definitive correct answers

Return JSON:
{
  "title": "Short descriptive title for this remediation unit",
  "diagnosis": "Plain-language explanation of what the student is doing wrong and why (2-3 sentences, written TO the student)",
  "remediationType": "concept-review" | "practice-problems" | "prerequisite-work" | "boundary-testing",
  "learningSteps": [
    {
      "stepNumber": 1,
      "description": "Clear, actionable instruction for what to study/do",
      "estimatedTimeMinutes": 5,
      "resources": ["Specific resource suggestions relevant to ${session.learningScope.curriculum}"]
    }
  ],
  "practiceProblems": [
    {
      "problemNumber": 1,
      "question": "A specific problem to solve",
      "correctAnswer": "The correct answer",
      "hint": "A helpful hint without giving the answer away",
      "difficulty": "easy" | "medium" | "hard"
    }
  ],
  "successChecks": [
    {
      "description": "Specific thing the student should be able to do when they've mastered this"
    }
  ],
  "totalEstimatedTimeMinutes": 25
}

${curriculumContext ? `CURRICULUM CONTEXT (use this as ground truth):\n${curriculumContext}\n\nIMPORTANT:
- Learning steps MUST use the approved METHODS from the topic graph above
- Practice problems MUST follow the EXPECTED STEPS sequence from the curriculum
- Use the NOTATION rules specified above
- Practice problems should target the exact skill gap identified\n` : ''}GUIDELINES:
- 2-4 learning steps, 3-5 practice problems, 2-3 success checks
- Steps should be SPECIFIC (not "review the topic" — say exactly what to review and which method to practice)
- Practice problems should progress from easy to hard
- Total time: 15-45 minutes per unit
- Write the diagnosis in a friendly, encouraging tone directed at the student

FORMATTING: Use LaTeX in $ delimiters for mathematical/scientific expressions in questions, answers, hints, and step descriptions (e.g. $x^2 + 3x - 5$, $\\frac{1}{2}$, $\\sqrt{x}$). For non-math subjects, use plain text.`;
  }

  /**
   * Generate additional practice problems
   */
  async generateMoreProblems(remediationUnit, count = 5) {
    const prompt = `Generate ${count} additional practice problems for:

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

    remediationUnit.practiceProblems.push(...data.problems);
    await remediationUnit.save();

    return data.problems;
  }

  /**
   * Check if student answer is correct
   */
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
