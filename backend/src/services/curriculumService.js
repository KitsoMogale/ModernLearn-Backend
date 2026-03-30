const CurriculumProfile = require('../models/CurriculumProfile');

// Simple in-memory cache (curriculum data rarely changes)
const profileCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

class CurriculumService {

  // ─── Profile fetching (cached) ───────────────────────────────────

  async _getProfile(learningScope) {
    const cacheKey = `${learningScope.curriculum}:${learningScope.grade}:${learningScope.subject || 'Mathematics'}`;
    const cached = profileCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.profile;
    }

    try {
      const profile = await CurriculumProfile.findByLearningScope(learningScope);
      if (profile) {
        profileCache.set(cacheKey, { profile, timestamp: Date.now() });
      }
      return profile;
    } catch (error) {
      console.error('CurriculumService: Failed to fetch profile:', error.message);
      return null;
    }
  }

  // ─── Topic matching ──────────────────────────────────────────────

  /**
   * Scan question text for keyword hints to identify likely topics.
   */
  extractConceptHints(questions) {
    const text = questions.map(q =>
      `${q.questionText || ''} ${q.studentAnswer || ''}`.toLowerCase()
    ).join(' ');

    const hints = new Set();

    // Common keyword → topic mapping (curriculum-agnostic)
    const indicators = {
      'factorise': 'algebra', 'factorize': 'algebra', 'factor': 'algebra',
      'simplify': 'algebra', 'expand': 'algebra', 'expression': 'algebra',
      'equation': 'algebra', 'solve for': 'algebra', 'solve': 'algebra',
      'inequality': 'algebra', 'simultaneous': 'algebra',
      'exponent': 'exponents', 'power': 'exponents', 'surd': 'exponents', 'radical': 'exponents',
      'pattern': 'number patterns', 'sequence': 'number patterns', 'nth term': 'number patterns',
      'sin': 'trigonometry', 'cos': 'trigonometry', 'tan': 'trigonometry',
      'angle': 'trigonometry', 'triangle': 'trigonometry',
      'gradient': 'analytical geometry', 'midpoint': 'analytical geometry',
      'distance formula': 'analytical geometry',
      'f(x)': 'functions', 'graph': 'functions', 'parabola': 'functions',
      'hyperbola': 'functions', 'asymptote': 'functions',
      'interest': 'finance', 'compound': 'finance', 'depreciation': 'finance',
      'probability': 'probability', 'event': 'probability',
      'mean': 'statistics', 'median': 'statistics', 'histogram': 'statistics',
      'congruent': 'geometry', 'parallel': 'geometry', 'theorem': 'geometry',
      'volume': 'measurement', 'surface area': 'measurement',
    };

    for (const [keyword, topic] of Object.entries(indicators)) {
      if (text.includes(keyword)) {
        hints.add(topic);
      }
    }

    return Array.from(hints);
  }

  /**
   * Match concept hints to actual topics in a profile.
   * Returns matching topic objects from the profile.
   */
  matchTopics(profile, conceptHints) {
    if (!profile || !profile.topics || !conceptHints || conceptHints.length === 0) {
      return [];
    }

    const normalized = conceptHints.map(h => h.toLowerCase().trim());
    const matched = [];

    for (const topic of profile.topics) {
      const topicName = topic.topic.toLowerCase();

      // Check if any hint matches the topic name
      const topicMatch = normalized.some(hint =>
        topicName.includes(hint) || hint.includes(topicName)
      );

      if (topicMatch) {
        matched.push(topic);
        continue;
      }

      // Check subtopic names, skills, methods
      for (const sub of topic.subtopics || []) {
        const subName = sub.name.toLowerCase();
        const subMatch = normalized.some(hint =>
          subName.includes(hint) || hint.includes(subName) ||
          (sub.skills || []).some(s => s.toLowerCase().includes(hint)) ||
          (sub.methods || []).some(m => m.toLowerCase().includes(hint))
        );
        if (subMatch) {
          matched.push(topic);
          break;
        }
      }
    }

    return matched;
  }

  // ─── Context builders ──────────────────────────────────────────────

  /**
   * Build the full curriculum context object for the analysis prompt.
   * Returns { meta, topics } or null if no profile.
   */
  async getFullContext(learningScope, conceptHints = []) {
    const profile = await this._getProfile(learningScope);
    if (!profile) return null;

    const matchedTopics = this.matchTopics(profile, conceptHints);
    // If no match, include all topics (AI will figure it out)
    const relevantTopics = matchedTopics.length > 0 ? matchedTopics : profile.topics;

    return {
      meta: profile.meta,
      topics: relevantTopics
    };
  }

  /**
   * Build a diagnostic context string for injection into the AI system prompt.
   */
  async getDiagnosticContext(learningScope, conceptHints = []) {
    const ctx = await this.getFullContext(learningScope, conceptHints);
    if (!ctx) return null;

    return this._formatDiagnosticPrompt(ctx);
  }

  /**
   * Build focused remediation context for a specific failure.
   */
  async getRemediationContext(learningScope, failureTopic, failureSkills = []) {
    const profile = await this._getProfile(learningScope);
    if (!profile) return null;

    // Find the matching topic
    const searchTerms = [failureTopic, ...failureSkills].filter(Boolean);
    const matchedTopics = this.matchTopics(profile, searchTerms);

    if (matchedTopics.length === 0) return null;

    return this._formatRemediationPrompt(profile.meta, matchedTopics);
  }

  /**
   * Build minimal OCR context (notation only).
   */
  async getOCRContext(learningScope) {
    const profile = await this._getProfile(learningScope);
    if (!profile) return null;

    const notes = [];
    if (profile.meta.notation && profile.meta.notation.length > 0) {
      notes.push(...profile.meta.notation);
    }
    if (profile.meta.terminology && profile.meta.terminology.length > 0) {
      notes.push(...profile.meta.terminology.map(t => `"${t.term}" — ${t.note}`));
    }

    return notes.length > 0 ? notes.join('. ') : null;
  }

  // ─── Formatting helpers ──────────────────────────────────────────

  _formatDiagnosticPrompt(ctx) {
    const parts = [];

    // ── Layer 1: Meta ──
    parts.push(`CURRICULUM CONTEXT — ${ctx.meta.curriculum} ${ctx.meta.grade} ${ctx.meta.subject} (${ctx.meta.country}):\n`);

    if (ctx.meta.notation && ctx.meta.notation.length > 0) {
      parts.push('NOTATION STANDARDS:');
      ctx.meta.notation.forEach(n => parts.push(`- ${n}`));
      parts.push('');
    }

    if (ctx.meta.markingStandards && ctx.meta.markingStandards.length > 0) {
      parts.push('MARKING STANDARDS:');
      ctx.meta.markingStandards.forEach(m => parts.push(`- ${m}`));
      parts.push('');
    }

    if (ctx.meta.terminology && ctx.meta.terminology.length > 0) {
      parts.push('TERMINOLOGY:');
      ctx.meta.terminology.forEach(t => parts.push(`- ${t.term}: ${t.note}`));
      parts.push('');
    }

    // ── Layer 2: Topic Graph ──
    parts.push('TOPIC GRAPH:\n');
    for (const topic of ctx.topics) {
      parts.push(`[${topic.topic}]`);
      for (const sub of topic.subtopics || []) {
        parts.push(`  ${sub.skillId} — ${sub.name}`);
        if (sub.skills && sub.skills.length > 0) {
          parts.push(`    Skills: ${sub.skills.join('; ')}`);
        }
        if (sub.methods && sub.methods.length > 0) {
          parts.push(`    Methods: ${sub.methods.join('; ')}`);
        }
        if (sub.commonSteps && sub.commonSteps.length > 0) {
          parts.push(`    Expected steps: ${sub.commonSteps.join(' → ')}`);
        }
        if (sub.keyFormulae && sub.keyFormulae.length > 0) {
          parts.push(`    Formulae: ${sub.keyFormulae.join('; ')}`);
        }
        if (sub.notation && sub.notation.length > 0) {
          parts.push(`    Notation: ${sub.notation.join('; ')}`);
        }
      }
      parts.push('');
    }

    return parts.join('\n');
  }

  _formatRemediationPrompt(meta, topics) {
    const parts = [];

    parts.push(`CURRICULUM CONTEXT — ${meta.curriculum} ${meta.grade} ${meta.subject}:\n`);

    if (meta.notation && meta.notation.length > 0) {
      parts.push('NOTATION:');
      meta.notation.forEach(n => parts.push(`- ${n}`));
      parts.push('');
    }

    for (const topic of topics) {
      parts.push(`[${topic.topic}]`);
      for (const sub of topic.subtopics || []) {
        parts.push(`  ${sub.skillId} — ${sub.name}`);
        if (sub.methods && sub.methods.length > 0) {
          parts.push(`    Methods: ${sub.methods.join('; ')}`);
        }
        if (sub.commonSteps && sub.commonSteps.length > 0) {
          parts.push(`    Expected steps: ${sub.commonSteps.join(' → ')}`);
        }
        if (sub.keyFormulae && sub.keyFormulae.length > 0) {
          parts.push(`    Formulae: ${sub.keyFormulae.join('; ')}`);
        }
        if (sub.prerequisites && sub.prerequisites.length > 0) {
          parts.push(`    Prerequisites: ${sub.prerequisites.map(p => `${p.name} (${p.gradeLevel})`).join('; ')}`);
        }
      }

      parts.push('');
    }

    return parts.join('\n');
  }

  /**
   * Clear the profile cache (called after admin updates).
   */
  clearCache() {
    profileCache.clear();
  }
}

module.exports = new CurriculumService();
