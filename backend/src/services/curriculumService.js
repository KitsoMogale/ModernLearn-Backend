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
   * Covers multiple subjects — hints are best-effort and used to narrow
   * which curriculum topics to inject into the AI prompt. If nothing
   * matches, all topics are sent (the AI figures it out).
   */
  extractConceptHints(questions) {
    const text = questions.map(q =>
      `${q.questionText || ''} ${q.studentAnswer || ''}`.toLowerCase()
    ).join(' ');

    const hints = new Set();

    // Multi-subject keyword → topic mapping
    const indicators = {
      // ── Mathematics ──
      'factorise': 'algebra', 'factorize': 'algebra', 'factor': 'algebra',
      'simplify': 'algebra', 'expand': 'algebra', 'expression': 'algebra',
      'equation': 'algebra', 'solve for': 'algebra', 'inequality': 'algebra',
      'simultaneous': 'algebra',
      'exponent': 'exponents', 'power': 'exponents', 'surd': 'exponents',
      'pattern': 'number patterns', 'sequence': 'number patterns', 'nth term': 'number patterns',
      'sin': 'trigonometry', 'cos': 'trigonometry', 'tan': 'trigonometry',
      'angle': 'trigonometry',
      'gradient': 'analytical geometry', 'midpoint': 'analytical geometry',
      'f(x)': 'functions', 'graph': 'functions', 'parabola': 'functions',
      'interest': 'finance', 'compound': 'finance', 'depreciation': 'finance',
      'probability': 'probability',
      'mean': 'statistics', 'median': 'statistics', 'histogram': 'statistics',
      'congruent': 'geometry', 'parallel': 'geometry', 'theorem': 'geometry',
      'volume': 'measurement', 'surface area': 'measurement',

      // ── Physical Sciences / Physics / Chemistry ──
      'newton': 'mechanics', 'force': 'mechanics', 'acceleration': 'mechanics',
      'velocity': 'mechanics', 'momentum': 'mechanics', 'friction': 'mechanics',
      'energy': 'energy', 'kinetic': 'energy', 'potential': 'energy', 'joule': 'energy',
      'wave': 'waves', 'frequency': 'waves', 'wavelength': 'waves', 'amplitude': 'waves',
      'circuit': 'electricity', 'voltage': 'electricity', 'current': 'electricity',
      'resistance': 'electricity', 'ohm': 'electricity',
      'element': 'chemistry', 'compound': 'chemistry', 'reaction': 'chemistry',
      'mole': 'stoichiometry', 'concentration': 'stoichiometry',
      'acid': 'acids and bases', 'base': 'acids and bases', 'ph': 'acids and bases',
      'periodic table': 'atomic structure', 'electron': 'atomic structure',

      // ── Life Sciences / Biology ──
      'cell': 'cell biology', 'mitosis': 'cell biology', 'meiosis': 'cell biology',
      'dna': 'genetics', 'gene': 'genetics', 'allele': 'genetics', 'genotype': 'genetics',
      'ecosystem': 'ecology', 'food chain': 'ecology', 'biodiversity': 'ecology',
      'photosynthesis': 'plant biology', 'respiration': 'plant biology',
      'evolution': 'evolution', 'natural selection': 'evolution',
      'organ': 'human biology', 'nervous system': 'human biology', 'circulatory': 'human biology',

      // ── Languages / English / Literature ──
      'essay': 'writing', 'paragraph': 'writing', 'introduction': 'writing', 'conclusion': 'writing',
      'grammar': 'language', 'tense': 'language', 'verb': 'language', 'noun': 'language',
      'adjective': 'language', 'adverb': 'language', 'pronoun': 'language',
      'comprehension': 'reading', 'passage': 'reading', 'extract': 'reading',
      'metaphor': 'literary devices', 'simile': 'literary devices', 'personification': 'literary devices',
      'alliteration': 'literary devices', 'imagery': 'literary devices',
      'poem': 'poetry', 'stanza': 'poetry', 'rhyme': 'poetry',
      'character': 'literature', 'theme': 'literature', 'plot': 'literature',

      // ── Geography ──
      'climate': 'climatology', 'weather': 'climatology', 'rainfall': 'climatology',
      'erosion': 'geomorphology', 'river': 'geomorphology', 'mountain': 'geomorphology',
      'population': 'human geography', 'urbanisation': 'human geography', 'migration': 'human geography',
      'map': 'mapwork', 'contour': 'mapwork', 'scale': 'mapwork', 'bearing': 'mapwork',

      // ── History ──
      'war': 'conflict', 'battle': 'conflict', 'treaty': 'conflict',
      'democracy': 'political history', 'apartheid': 'political history', 'revolution': 'political history',
      'source': 'source analysis', 'bias': 'source analysis', 'evidence': 'source analysis',

      // ── Accounting / Business ──
      'debit': 'accounting', 'credit': 'accounting', 'ledger': 'accounting',
      'balance sheet': 'financial statements', 'income statement': 'financial statements',
      'asset': 'financial statements', 'liability': 'financial statements',
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
