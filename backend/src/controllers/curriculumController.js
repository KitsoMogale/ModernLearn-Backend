const CurriculumProfile = require('../models/CurriculumProfile');
const curriculumService = require('../services/curriculumService');

/**
 * List all curriculum profiles (summary only)
 */
exports.listProfiles = async (req, res) => {
  try {
    const profiles = await CurriculumProfile.find({ isActive: true })
      .select('curriculumCode meta.country meta.curriculum meta.grade meta.subject version updatedAt')
      .sort({ curriculumCode: 1, 'meta.grade': 1, 'meta.subject': 1 });

    res.json({
      success: true,
      count: profiles.length,
      profiles: profiles.map(p => ({
        _id: p._id,
        curriculumCode: p.curriculumCode,
        country: p.meta.country,
        curriculum: p.meta.curriculum,
        grade: p.meta.grade,
        subject: p.meta.subject,
        version: p.version,
        updatedAt: p.updatedAt
      }))
    });
  } catch (error) {
    console.error('List profiles error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get a specific curriculum profile
 */
exports.getProfile = async (req, res) => {
  try {
    const { code, grade, subject } = req.params;

    const profile = await CurriculumProfile.findOne({
      curriculumCode: code.toUpperCase(),
      'meta.grade': grade,
      'meta.subject': subject,
      isActive: true
    });

    if (!profile) {
      return res.status(404).json({
        success: false,
        error: `No profile found for ${code} ${grade} ${subject}`
      });
    }

    res.json({ success: true, profile });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Create or update a curriculum profile (upsert)
 */
exports.upsertProfile = async (req, res) => {
  try {
    const data = req.body;

    if (!data.curriculumCode || !data.meta?.grade || !data.meta?.subject) {
      return res.status(400).json({
        success: false,
        error: 'curriculumCode, meta.grade, and meta.subject are required'
      });
    }

    const filter = {
      curriculumCode: data.curriculumCode,
      'meta.grade': data.meta.grade,
      'meta.subject': data.meta.subject
    };

    const existing = await CurriculumProfile.findOne(filter);

    let profile;
    if (existing) {
      Object.assign(existing, data);
      existing.version = (existing.version || 0) + 1;
      profile = await existing.save();
    } else {
      profile = await CurriculumProfile.create(data);
    }

    // Clear cache so new data is used immediately
    curriculumService.clearCache();

    res.status(existing ? 200 : 201).json({
      success: true,
      action: existing ? 'updated' : 'created',
      profile
    });
  } catch (error) {
    console.error('Upsert profile error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
