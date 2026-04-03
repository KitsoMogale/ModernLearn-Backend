/**
 * Seed curriculum profiles into MongoDB.
 * Reads all JSON files from seeds/curriculum/ and upserts by curriculumCode + meta.level + meta.subject.
 *
 * Usage: npm run seed:curriculum
 * Requires MONGODB_URI in .env
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const mongoose = require('mongoose');
const CurriculumProfile = require('../models/CurriculumProfile');

const SEEDS_DIR = path.join(__dirname, '../seeds/curriculum');

async function seedCurriculum() {
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error('MONGODB_URI not set in .env');
      process.exit(1);
    }

    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    const files = fs.readdirSync(SEEDS_DIR).filter(f => f.endsWith('.json'));

    if (files.length === 0) {
      console.log('No seed files found in', SEEDS_DIR);
      process.exit(0);
    }

    console.log(`Found ${files.length} seed file(s)\n`);

    let created = 0;
    let updated = 0;

    for (const file of files) {
      const filePath = path.join(SEEDS_DIR, file);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      const filter = {
        curriculumCode: data.curriculumCode,
        'meta.level': data.meta.level,
        'meta.subject': data.meta.subject
      };

      const existing = await CurriculumProfile.findOne(filter);

      if (existing) {
        Object.assign(existing, data);
        existing.version = (existing.version || 0) + 1;
        await existing.save();
        updated++;
        console.log(`  Updated: ${data.curriculumCode} ${data.meta.level} ${data.meta.subject} (v${existing.version})`);
      } else {
        await CurriculumProfile.create(data);
        created++;
        console.log(`  Created: ${data.curriculumCode} ${data.meta.level} ${data.meta.subject}`);
      }

      // Summary
      const topicCount = data.topics?.length || 0;
      const subtopicCount = data.topics?.reduce((sum, t) => sum + (t.subtopics?.length || 0), 0) || 0;
      console.log(`    → ${topicCount} topics, ${subtopicCount} subtopics`);
    }

    console.log(`\nDone! Created: ${created}, Updated: ${updated}`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Seed failed:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

seedCurriculum();
