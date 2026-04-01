const OpenAI = require('openai');
const FailureSignal = require('../models/FailureSignal');
const curriculumService = require('./curriculumService');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * 3-Stage Procedural Diagnostic Analysis
 *
 * Stage 1 — GRADE: For each question, work out the correct answer and mark the student's work.
 *           No failure grouping, no root cause — just honest marking.
 *
 * Stage 2 — DIAGNOSE: Given the marked questions, identify real misconceptions.
 *           Group related errors, find root causes, assign categories.
 *           Be generous: correct answer + sound method = correct, period.
 *
 * Stage 3 — SYNTHESIZE: Produce a student-friendly summary and prerequisite analysis.
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

      // ── Stage 1: Grade each question ───────────────────────────────
      console.log('  Stage 1: Grading questions...');
      const grading = await this._stageGrade(extractedQuestions, learningScope, curriculumContext);

      // ── Stage 2: Diagnose failures ─────────────────────────────────
      console.log('  Stage 2: Diagnosing failures...');
      const diagnosis = await this._stageDiagnose(grading, learningScope, curriculumContext);

      // ── Stage 3: Synthesize summary & prerequisites ────────────────
      console.log('  Stage 3: Synthesizing...');
      const synthesis = await this._stageSynthesize(grading, diagnosis, learningScope);

      // Merge into final analysis object
      const analysis = {
        questionAnalysis: grading.questionAnalysis,
        failures: diagnosis.failures || [],
        detectedConcepts: diagnosis.detectedConcepts || [],
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

      // Create FailureSignal documents
      const failureSignals = await this.createFailureSignals(session._id, analysis.failures);

      // Update session
      await this.updateSessionWithAnalysis(session, analysis);

      return {
        failureSignals,
        detectedConcepts: analysis.detectedConcepts,
        summary: analysis.summary
      };
    } catch (error) {
      console.error('Diagnostic analysis error:', error);
      throw new Error(`Diagnostic analysis failed: ${error.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Stage 1 — GRADE
  // Mark each question: correct answer, is student right, brief note.
  // ═══════════════════════════════════════════════════════════════════

  async _stageGrade(questions, learningScope, curriculumContext) {
    const questionsText = questions.map(q => {
      let text = `Q${q.questionNumber}: ${q.questionText}\n  Student answer: ${q.studentAnswer || '(blank)'}`;
      if (q.structure?.hasDiagram) text += '\n  [contains diagram]';
      if (q.structure?.hasTable) text += '\n  [contains table]';
      return text;
    }).join('\n\n');

    const systemPrompt = `You are a ${learningScope.curriculum} ${learningScope.grade} ${learningScope.subject || 'Mathematics'} marker in ${learningScope.country}.

Your ONLY job is to MARK each question. For each question:
- Work out the correct answer using ${learningScope.curriculum}-approved methods
- Decide: is the student's answer correct, partially correct, or incorrect?
- Write a brief note on what happened

${curriculumContext ? `CURRICULUM REFERENCE:\n${curriculumContext}\n` : ''}
MARKING PHILOSOPHY — READ CAREFULLY:
- A correct final answer with reasonable working = CORRECT. Do not nitpick.
- If the student used a valid alternative method (not the textbook method), that is still correct.
- Minor notation differences (e.g. brackets vs no brackets around a single-term answer) are NOT errors.
- Only mark something wrong if the answer itself is wrong or the reasoning has a genuine flaw.
- "Partially correct" means the student showed understanding but made a real mistake along the way.
- Do NOT manufacture errors. If the work is correct, say so and move on.`;

    const userPrompt = `Mark these ${learningScope.grade} ${learningScope.subject || 'Mathematics'} answers:

${questionsText}

Return JSON:
{
  "questionAnalysis": [
    {
      "questionNumber": "1",
      "topic": "e.g. Algebra",
      "subtopic": "e.g. Factorisation",
      "skillId": "e.g. ALG-FAC-001 or null if unknown",
      "correctAnswer": "the correct answer",
      "isCorrect": true,
      "isPartiallyCorrect": false,
      "conceptsTested": ["concept1", "concept2"],
      "notes": "Brief note — what the student did, what went right or wrong"
    }
  ]
}

IMPORTANT: Be fair and generous. Students deserve credit for correct work.`;

    const response = await this._callAI(systemPrompt, userPrompt, 4000);
    return response;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Stage 2 — DIAGNOSE
  // Given the grading, identify real failures and group them.
  // ═══════════════════════════════════════════════════════════════════

  async _stageDiagnose(grading, learningScope, curriculumContext) {
    // Only pass through incorrect/partial questions for diagnosis
    const wrongQuestions = grading.questionAnalysis.filter(q => !q.isCorrect);

    if (wrongQuestions.length === 0) {
      return { failures: [], detectedConcepts: grading.questionAnalysis.flatMap(q => q.conceptsTested || []) };
    }

    const correctQuestions = grading.questionAnalysis.filter(q => q.isCorrect);

    const systemPrompt = `You are an educational diagnostician. You are given the marked results of a ${learningScope.grade} ${learningScope.subject || 'Mathematics'} test (${learningScope.curriculum}, ${learningScope.country}).

Your job: look at the INCORRECT answers and figure out WHY the student got them wrong. Group related errors into failures.

${curriculumContext ? `CURRICULUM REFERENCE:\n${curriculumContext}\n` : ''}
DIAGNOSTIC PRINCIPLES:
- Focus on genuine misconceptions and skill gaps, not minor slips.
- If only one question shows an issue and it could easily be a careless slip, classify it as "careless-execution" with LOW severity — do not inflate it.
- Group related errors together. Two sign errors in distribution = one failure, not two.
- Maximum 4 failures. If the student only got 1-2 wrong, 1 failure is fine.
- Severity should reflect impact: "high" = fundamental gap affecting many problems, "medium" = specific misconception, "low" = isolated careless mistake.
- Look at what the student got RIGHT to calibrate — if they solved 8/10 correctly, the 2 wrong ones are likely minor issues, not deep gaps.`;

    const userPrompt = `INCORRECT ANSWERS (need diagnosis):
${wrongQuestions.map(q => `Q${q.questionNumber} [${q.topic} → ${q.subtopic}]:
  Correct answer: ${q.correctAnswer}
  Student got: (marked wrong)
  Notes: ${q.notes}`).join('\n\n')}

${correctQuestions.length > 0 ? `\nCORRECT ANSWERS (context — student DID get these right):
${correctQuestions.map(q => `Q${q.questionNumber} [${q.topic} → ${q.subtopic}]: Correct`).join('\n')}` : ''}

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

REMEMBER: Be proportionate. ${wrongQuestions.length} wrong out of ${grading.questionAnalysis.length} total. Calibrate severity accordingly.`;

    const response = await this._callAI(systemPrompt, userPrompt, 6000);
    return response;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Stage 3 — SYNTHESIZE
  // Produce a student-friendly summary and prerequisite analysis.
  // ═══════════════════════════════════════════════════════════════════

  async _stageSynthesize(grading, diagnosis, learningScope) {
    const correctCount = grading.questionAnalysis.filter(q => q.isCorrect).length;
    const totalCount = grading.questionAnalysis.length;

    const systemPrompt = `You write brief, encouraging summaries for students. The student is in ${learningScope.grade} (${learningScope.curriculum}, ${learningScope.country}).

TONE: Friendly, supportive, honest. Lead with what they did well. Be specific about strengths. Then mention areas to work on without being harsh. This is a student — not a teacher report.`;

    const userPrompt = `RESULTS: ${correctCount}/${totalCount} correct.

STRENGTHS (topics they got right):
${grading.questionAnalysis.filter(q => q.isCorrect).map(q => `- ${q.topic}: ${q.subtopic}`).join('\n') || '(none)'}

${diagnosis.failures.length > 0 ? `AREAS TO WORK ON:
${diagnosis.failures.map(f => `- ${f.specificIssue} (${f.severity} priority)`).join('\n')}` : 'No significant issues found!'}

Return JSON:
{
  "summary": "2-4 sentence student-friendly summary. Lead with positives.",
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
}`;

    const response = await this._callAI(systemPrompt, userPrompt, 2000);
    return response;
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

  async createFailureSignals(sessionId, failures) {
    const failureSignals = [];

    for (const failure of failures) {
      const signal = await FailureSignal.create({
        sessionId,
        category: failure.category,
        specificIssue: failure.specificIssue,
        rootCause: failure.rootCause,
        misconceptionDescription: failure.misconceptionDescription || null,
        detectedConcepts: failure.detectedConcepts || [],
        evidence: failure.evidence || [],
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
