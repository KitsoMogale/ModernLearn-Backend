const mongoose = require('mongoose');
require('dotenv').config();

const Subject = require('../models/Subject');
const Topic = require('../models/Topic');
const Level = require('../models/Level');
const Cluster = require('../models/Cluster');
const Node = require('../models/Node');

const seedDatabase = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Clear existing data
    await Subject.deleteMany({});
    await Topic.deleteMany({});
    await Level.deleteMany({});
    await Cluster.deleteMany({});
    await Node.deleteMany({});
    console.log('Cleared existing data');

    // Create sample subject
    const subject = await Subject.create({
      name: 'Mathematics',
      description: 'Fundamental mathematics concepts and applications',
    });
    console.log('Created subject:', subject.name);

    // Create sample topic
    const topic = await Topic.create({
      subjectId: subject._id,
      name: 'Calculus',
      description: 'Study of continuous change',
      learningGoals: [
        'Understand derivatives and integrals',
        'Apply calculus to real-world problems',
        'Master fundamental theorem of calculus',
      ],
    });
    console.log('Created topic:', topic.name);

    // Create levels
    const levels = await Level.create([
      {
        topicId: topic._id,
        name: 'Intro',
        expectedBackground: 'High school algebra',
        totalQuestionLimit: 225,
      },
      {
        topicId: topic._id,
        name: 'Advanced',
        expectedBackground: 'Calculus I completion',
        totalQuestionLimit: 325,
      },
      {
        topicId: topic._id,
        name: 'Graduate',
        expectedBackground: 'Undergraduate calculus',
        totalQuestionLimit: 450,
      },
    ]);
    console.log('Created levels:', levels.map(l => l.name).join(', '));

    // Create sample cluster for Intro level
    const cluster = await Cluster.create({
      topicId: topic._id,
      levelId: levels[0]._id, // Intro level
      name: 'Limits and Continuity',
      description: 'Understanding the concept of limits and continuous functions',
      intendedLearningOutcome: 'Students will be able to evaluate limits and determine continuity',
      order: 1,
      questionBudget: 25,
      nodeIds: [], // Will update after creating nodes
    });
    console.log('Created cluster:', cluster.name);

    // Create sample nodes
    const nodes = await Node.create([
      {
        clusterId: cluster._id,
        name: 'Limit Definition',
        description: 'Understanding the formal definition of a limit',
        dependencies: [],
        learningGoal: 'Apply the epsilon-delta definition of limits',
      },
      {
        clusterId: cluster._id,
        name: 'Limit Laws',
        description: 'Rules for evaluating limits algebraically',
        dependencies: [],
        learningGoal: 'Use limit laws to evaluate complex limits',
      },
      {
        clusterId: cluster._id,
        name: 'Continuity',
        description: 'Understanding continuous functions',
        dependencies: [],
        learningGoal: 'Determine if a function is continuous at a point',
      },
    ]);
    console.log('Created nodes:', nodes.map(n => n.name).join(', '));

    // Update cluster with node IDs
    cluster.nodeIds = nodes.map(n => n._id);
    await cluster.save();
    console.log('Updated cluster with node IDs');

    console.log('\n✓ Database seeded successfully!');
    console.log('\nCreated:');
    console.log('- 1 Subject');
    console.log('- 1 Topic');
    console.log('- 3 Levels');
    console.log('- 1 Cluster');
    console.log('- 3 Nodes');

    process.exit(0);
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  }
};

seedDatabase();
