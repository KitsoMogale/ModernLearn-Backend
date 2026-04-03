const OpenAI = require('openai');
const FailureSignal = require('../models/FailureSignal');
const curriculumService = require('./curriculumService');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * 3-Stage Procedural Diagnostic Analysis (Subject-Agnostic)
 *
 * Stage 1 — GRADE: Mark each question. Note what the student did well AND what went wrong.
 * Stage 2 — DIAGNOSE: Group wrong answers into failures. Be proportionate.
 * Stage 3 — SYNTHESIZE: Strengths list, student-friendly summary, prerequisite analysis.
 */
class DiagnosticAnalysisService {

  async analyzeSession(session) {
    try {
      const { extractedQuestions, learningScope } = session;

      if (!extractedQuestions || extractedQuestions.length === 0) {
        throw new Error('No questions to analyze');
      }

      // Fetch structured curriculum context
      const conceptHints = curriculumService.extractConceptHints(extractedQuestions);
      const curriculumContext = await curriculumService.getDiagnosticContext(learningScope, conceptHints);

      const subject = learningScope.subject || 'the subject';

      // ── Stage 1: Grade each question ───────────────────────────────
      console.log('  Stage 1: Grading questions...');
      const grading = await this._stageGrade(extractedQuestions, learningScope, curriculumContext, subject);

      // ── Stage 2: Diagnose failures ─────────────────────────────────
      console.log('  Stage 2: Diagnosing failures...');
      const diagnosis = await this._stageDiagnose(grading, learningScope, curriculumContext, subject);

      // ── Stage 3: Synthesize strengths, summary, prerequisites ──────
      console.log('  Stage 3: Synthesizing...');
      const synthesis = await this._stageSynthesize(grading, diagnosis, learningScope, subject);

      // Merge into final analysis object
      const analysis = {
        questionAnalysis: grading.questionAnalysis,
        failures: diagnosis.failures || [],
        detectedConcepts: diagnosis.detectedConcepts || [],
        strengths: synthesis.strengths || [],
        summary: synthesis.summary || ''
      };

      // Attach prerequisite chains from synthesis
      if (synthesis.prerequisiteAnalysis) {
        for (const pa of synthesis.prerequisiteAnalysis) {
          const failure = analysis.failures.find(f => f.specificIssue === pa.failure);
          if (failure) {
            failure.prerequisiteChain = pa.prerequisiteChain;
          }
        }
      }

      // Create FailureSignal documents (pass grading for evidence enrichment)
      const failureSignals = await this.createFailureSignals(session._id, analysis.failures, analysis.questionAnalysis);

      // Update session
      await this.updateSessionWithAnalysis(session, analysis);

      return {
        failureSignals,
        detectedConcepts: analysis.detectedConcepts,
        strengths: analysis.strengths,
        summary: analysis.summary
      };
    } catch (error) {
      console.error('Diagnostic analysis error:', error);
      throw new Error(`Diagnostic analysis failed: ${error.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Stage 1 — GRADE
  // ═══════════════════════════════════════════════════════════════════

  async _stageGrade(questions, learningScope, curriculumContext, subject) {
    const questionsText = questions.map(q => {
      let text = `Q${q.questionNumber}: ${q.questionText}\n  Student answer: ${q.studentAnswer || '(blank)'}`;
      if (q.structure?.hasDiagram) text += '\n  [contains diagram]';
      if (q.structure?.hasTable) text += '\n  [contains table]';
      if (q.structure?.hasMultipleChoice) text += '\n  [multiple choice]';
      return text;
    }).join('\n\n');

    const systemPrompt = `You are a ${learningScope.curriculum} ${learningScope.level} ${subject} marker in ${learningScope.country}.

Your ONLY job is to MARK each question. For each question:
- First, identify what the question is ASKING the student to do (e.g. "Factorise", "Solve for x", "Explain why...", "Calculate the area")
- Identify the expected method or approach (e.g. "Common factor then trinomial", "Apply the quadratic formula", "Use evidence from the passage")
- Work out the correct answer using ${learningScope.curriculum}-approved methods
- Decide: is the student's answer correct, partially correct, or incorrect?
- Note what the student did WELL (even in wrong answers — partial credit matters)
- Note what went wrong (if anything)

${curriculumContext ? `CURRICULUM REFERENCE:\n${curriculumContext}\n` : ''}
MARKING PHILOSOPHY — READ CAREFULLY:
- A correct final answer with reasonable working = CORRECT. Do not nitpick.
- If the student used a valid alternative method, that is still correct.
- Minor notation or formatting differences are NOT errors.
- Only mark wrong if the answer itself is wrong or the reasoning has a genuine flaw.
- "Partially correct" = student showed understanding but made a real mistake.
- Do NOT manufacture errors. If the work is correct, say so.
- ALWAYS note something positive — what skill or understanding did they demonstrate?

FORMATTING: When writing mathematical expressions, formulae, or scientific notation, use LaTeX wrapped in $ delimiters for inline (e.g. $x^2 + 3x - 5$) or $$ for display. This applies to correctAnswer, notes, whatWentWell, whatWentWrong. For non-math subjects, just use plain text.`;

    const userPrompt = `Mark these ${learningScope.level} ${subject} answers:

${questionsText}

Return JSON:
{
  "questionAnalysis": [
    {
      "questionNumber": "1",
      "topic": "the topic area",
      "subtopic": "specific subtopic",
      "skillId": "skill ID from curriculum if known, else null",
      "questionRequires": "What the question is asking the student to DO — the action/task (e.g. 'Factorise the trinomial', 'Solve for x', 'Identify the theme', 'Balance the equation', 'Explain the effect of...')",
      "expectedApproach": "The method or steps needed to answer correctly (e.g. 'Find common factor, then apply difference of squares', 'Use quadratic formula since it doesn't factorise neatly', 'Reference textual evidence and explain its significance')",
      "correctAnswer": "the correct answer",
      "isCorrect": true,
      "isPartiallyCorrect": false,
      "conceptsTested": ["concept1", "concept2"],
      "whatWentWell": "What the student did correctly — be specific (e.g. 'correctly identified the key variables', 'used the right method', 'good working shown'). Always say something positive, even if the final answer was wrong.",
      "whatWentWrong": "What went wrong, or null if nothing",
      "notes": "Brief overall note"
    }
  ]
}

IMPORTANT: Be fair and generous. Students deserve credit for correct work. Always fill in whatWentWell — find something positive even in wrong answers. Always fill in questionRequires and expectedApproach — these anchor the entire analysis.`;

    return await this._callAI(systemPrompt, userPrompt, 5000);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Stage 2 — DIAGNOSE
  // ═══════════════════════════════════════════════════════════════════

  async _stageDiagnose(grading, learningScope, curriculumContext, subject) {
    const wrongQuestions = grading.questionAnalysis.filter(q => !q.isCorrect);

    if (wrongQuestions.length === 0) {
      return {
        failures: [],
        detectedConcepts: grading.questionAnalysis.flatMap(q => q.conceptsTested || [])
      };
    }

    const correctQuestions = grading.questionAnalysis.filter(q => q.isCorrect);

    const systemPrompt = `You are an educational diagnostician. You are given the marked results of a ${learningScope.level} ${subject} test (${learningScope.curriculum}, ${learningScope.country}).

Your job: look at the INCORRECT answers and figure out WHY the student got them wrong. Group related errors into failures.

${curriculumContext ? `CURRICULUM REFERENCE:\n${curriculumContext}\n` : ''}
DIAGNOSTIC PRINCIPLES:
- Focus on genuine misconceptions and skill gaps, not minor slips.
- If only one question shows an issue and it could be a careless slip, classify as "careless-execution" with LOW severity.
- Group related errors. Similar mistakes = one failure, not many.
- Maximum 4 failures. 1-2 wrong answers = 1 failure is fine.
- Severity reflects impact: "high" = fundamental gap, "medium" = specific misconception, "low" = isolated careless mistake.
- Calibrate against what the student got RIGHT. Strong performance overall means remaining errors are likely minor.
- This applies to ANY subject — not just maths. Adapt your categories to fit ${subject}.

FORMATTING: Use LaTeX in $ delimiters for any mathematical/scientific expressions in evidence (e.g. studentAnswer, correctAnswer, reasoning). For non-math subjects, use plain text.`;

    const userPrompt = `INCORRECT ANSWERS (need diagnosis):
${wrongQuestions.map(q => `Q${q.questionNumber} [${q.topic} → ${q.subtopic}]:
  Question required: ${q.questionRequires || 'N/A'}
  Expected approach: ${q.expectedApproach || 'N/A'}
  Correct answer: ${q.correctAnswer}
  What went well: ${q.whatWentWell || 'N/A'}
  What went wrong: ${q.whatWentWrong || q.notes}`).join('\n\n')}

${correctQuestions.length > 0 ? `\nCORRECT ANSWERS (context — student DID get these right):
${correctQuestions.map(q => `Q${q.questionNumber} [${q.topic} → ${q.subtopic}]: ${q.questionRequires || q.topic} — Correct — ${q.whatWentWell || 'good work'}`).join('\n')}` : ''}

Total: ${grading.questionAnalysis.length} questions, ${correctQuestions.length} correct, ${wrongQuestions.length} incorrect.

Return JSON:
{
  "failures": [
    {
      "category": "one of: conceptual-understanding, rule-application, procedural-execution, representation-interpretation, problem-interpretation, logical-reasoning, quantitative-execution, prerequisite-gap, strategic-approach, careless-execution",
      "specificIssue": "Clear description of what's going wrong",
      "rootCause": "WHY it's happening — the underlying misconception or gap",
      "misconceptionDescription": "What the student seems to believe (if applicable, else null)",
      "detectedConcepts": ["concept1"],
      "skillIds": ["SKILL-ID or null"],
      "evidence": [
        {
          "questionNumber": "3",
          "studentAnswer": "what they wrote",
          "correctAnswer": "what it should be",
          "reasoning": "Brief explanation of how this question shows the failure"
        }
      ],
      "confidence": 0.9,
      "severity": "high | medium | low",
      "affectedQuestions": ["3", "5"]
    }
  ],
  "detectedConcepts": ["all concepts seen across the test"]
}

REMEMBER: Be proportionate. ${wrongQuestions.length} wrong out of ${grading.questionAnalysis.length} total.`;

    return await this._callAI(systemPrompt, userPrompt, 6000);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Stage 3 — SYNTHESIZE
  // Strengths, summary, prerequisite analysis.
  // ═══════════════════════════════════════════════════════════════════

  async _stageSynthesize(grading, diagnosis, learningScope, subject) {
    const correctCount = grading.questionAnalysis.filter(q => q.isCorrect).length;
    const totalCount = grading.questionAnalysis.length;

    // Collect all the positive notes
    const positiveNotes = grading.questionAnalysis
      .filter(q => q.whatWentWell)
      .map(q => `Q${q.questionNumber} [${q.topic}]: ${q.whatWentWell}`);

    const systemPrompt = `You write brief, encouraging feedback for students. The student is in ${learningScope.level} studying ${subject} (${learningScope.curriculum}, ${learningScope.country}).

TONE: Friendly, supportive, honest. Like a good tutor — celebrate real achievements, be specific about what they did well, and gently point out what to work on. This is a student, not a professional report.`;

    const userPrompt = `RESULTS: ${correctCount}/${totalCount} correct.

POSITIVE OBSERVATIONS FROM MARKING:
${positiveNotes.join('\n') || '(no specific notes)'}

${diagnosis.failures.length > 0 ? `AREAS TO WORK ON:
${diagnosis.failures.map(f => `- ${f.specificIssue} (${f.severity} priority)`).join('\n')}` : 'No significant issues found!'}

Return JSON:
{
  "strengths": [
    {
      "skill": "Short name of what they did well (e.g. 'Setting up equations', 'Paragraph structure', 'Data interpretation')",
      "detail": "Specific praise — what exactly did they do that shows this strength? Reference actual questions.",
      "topic": "Which topic area this falls under"
    }
  ],
  "summary": "2-4 sentence student-friendly summary. Lead with positives. Be specific about what they nailed.",
  "prerequisiteAnalysis": [
    {
      "failure": "the specificIssue string from the failure",
      "prerequisiteChain": {
        "currentTopic": "what they're struggling with",
        "immediatePrerequisite": "what they need to know first (or null)",
        "gapLevel": "which grade level the gap is from (or null)",
        "testedPrerequisites": ["prerequisite concepts that were tested"]
      }
    }
  ]
}

STRENGTHS GUIDELINES:
- Include 2-5 strengths. More correct answers = more strengths to highlight.
- Be SPECIFIC — not "good at algebra" but "correctly applied the distributive property across all bracket questions".
- Even if the student got most questions wrong, find at least 1-2 strengths (correct steps within wrong answers, good attempt at method, etc.).
- Adapt to ${subject} — these could be analytical skills, writing skills, scientific reasoning, mathematical operations, etc.`;

    return await this._callAI(systemPrompt, userPrompt, 3000);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Shared helpers
  // ═══════════════════════════════════════════════════════════════════

  async _callAI(systemPrompt, userPrompt, maxTokens) {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' }
    });

    const text = response.choices[0].message.content.trim();
    return JSON.parse(text);
  }

  async createFailureSignals(sessionId, failures, questionAnalysis = []) {
    const failureSignals = [];

    // Build lookup from grading data for evidence enrichment
    const gradingByQuestion = {};
    for (const qa of questionAnalysis) {
      gradingByQuestion[qa.questionNumber] = qa;
    }

    for (const failure of failures) {
      // Enrich each evidence entry with questionRequires/expectedApproach from grading
      const enrichedEvidence = (failure.evidence || []).map(ev => {
        const grading = gradingByQuestion[ev.questionNumber];
        return {
          ...ev,
          questionRequires: ev.questionRequires || grading?.questionRequires || null,
          expectedApproach: ev.expectedApproach || grading?.expectedApproach || null,
        };
      });

      const signal = await FailureSignal.create({
        sessionId,
        category: failure.category,
        specificIssue: failure.specificIssue,
        rootCause: failure.rootCause,
        misconceptionDescription: failure.misconceptionDescription || null,
        detectedConcepts: failure.detectedConcepts || [],
        evidence: enrichedEvidence,
        confidence: failure.confidence || 0.8,
        confirmedByAnalysis: true,
        severity: failure.severity || 'medium',
        affectedQuestions: failure.affectedQuestions || [],
        prerequisiteChain: failure.prerequisiteChain || null
      });

      failureSignals.push(signal);
    }

    return failureSignals;
  }

  async updateSessionWithAnalysis(session, analysis) {
    if (analysis.questionAnalysis) {
      for (const qa of analysis.questionAnalysis) {
        const question = session.extractedQuestions.find(
          q => q.questionNumber === qa.questionNumber
        );

        if (question) {
          question.correctAnswer = qa.correctAnswer || null;

          if (!question.aiAnalysis) {
            question.aiAnalysis = { detectedConcepts: [], detectedErrors: [], confidence: 1.0 };
          }

          question.aiAnalysis.detectedConcepts = qa.conceptsTested || [];
          question.aiAnalysis.isCorrect = qa.isCorrect;
          question.aiAnalysis.questionRequires = qa.questionRequires || null;
          question.aiAnalysis.expectedApproach = qa.expectedApproach || null;
        }
      }
    }

    if (analysis.failures) {
      for (const failure of analysis.failures) {
        for (const evidence of failure.evidence || []) {
          const question = session.extractedQuestions.find(
            q => q.questionNumber === evidence.questionNumber
          );

          if (question?.aiAnalysis) {
            if (!question.aiAnalysis.detectedErrors) {
              question.aiAnalysis.detectedErrors = [];
            }
            question.aiAnalysis.detectedErrors.push({
              type: failure.category,
              description: failure.specificIssue
            });
          }
        }
      }
    }

    await session.save();
  }
}

module.exports = new DiagnosticAnalysisService();
