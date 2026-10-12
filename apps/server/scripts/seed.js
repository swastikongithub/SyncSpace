// Seeds demo accounts, workspaces and documents for local exploration and demos.
//   npm run seed              create demo data (skips if it already exists)
//   npm run seed -- --reset   remove previous demo data first
// Refuses to run against NODE_ENV=production unless SEED_ALLOW_PRODUCTION=true.
import { loadEnvFile, readConfig } from '../src/config.js';
import { connectDatabase, disconnectDatabase, ensureIndexes } from '../src/db.js';
import { createLogger } from '../src/logger.js';
import { createActivityRecorder } from '../src/activity/service.js';
import { Activity } from '../src/activity/model.js';
import { hashPassword } from '../src/auth/passwords.js';
import { Session } from '../src/auth/sessions.js';
import { buildDocumentState } from '../src/collab/content.js';
import { createDocStore } from '../src/collab/store.js';
import { createDocumentsService } from '../src/documents/service.js';
import { Document } from '../src/documents/model.js';
import { createHistoryService } from '../src/history/service.js';
import { User } from '../src/users/model.js';
import { Invitation, Membership, Workspace } from '../src/workspaces/models.js';

loadEnvFile();
const config = readConfig();
const logger = createLogger('warn');
const reset = process.argv.includes('--reset');
const password = process.env.SEED_PASSWORD || 'syncspace-demo-2026';

if (config.isProduction && process.env.SEED_ALLOW_PRODUCTION !== 'true') {
  console.error('Refusing to seed a production database. Set SEED_ALLOW_PRODUCTION=true if you really mean it.');
  process.exit(1);
}

const PEOPLE = [
  { key: 'ana', name: 'Ana Ferreira', email: 'ana@demo.syncspace.test', ply: 'canary' },
  { key: 'ben', name: 'Ben Okafor', email: 'ben@demo.syncspace.test', ply: 'sky' },
  { key: 'chen', name: 'Chen Li', email: 'chen@demo.syncspace.test', ply: 'mint' },
];

const THERMO = [
  { type: 'paragraph', text: 'Shared notes for Thursday’s revision session. Add anything that is missing; keep definitions short.' },
  { type: 'heading', level: 2, text: 'The first law' },
  {
    type: 'paragraph',
    runs: [
      { text: 'Energy is conserved: the change in internal energy equals heat added minus work done by the system, ' },
      { text: 'ΔU = Q − W', marks: { code: true } },
      { text: '.' },
    ],
  },
  { type: 'bulletList', items: ['Q > 0 when heat flows into the system', 'W > 0 when the system does work on its surroundings', 'Internal energy is a state function'] },
  { type: 'heading', level: 2, text: 'The second law' },
  {
    type: 'paragraph',
    runs: [
      { text: 'The entropy of an isolated system ' },
      { text: 'never decreases', marks: { bold: true } },
      { text: '. Heat flows spontaneously from hot to cold, never the reverse.' },
    ],
  },
  { type: 'blockquote', text: 'No engine operating between two reservoirs is more efficient than a Carnot engine.' },
  { type: 'heading', level: 3, text: 'Before Thursday' },
  {
    type: 'taskList',
    items: [
      { text: 'Work through problem set 6', checked: true },
      { text: 'Derive Carnot efficiency from scratch', checked: false },
      { text: 'Bring questions about entropy of mixing', checked: false },
    ],
  },
];

const LAB = [
  { type: 'paragraph', text: 'Goal: measure the specific heat capacity of aluminium using the method of mixtures.' },
  { type: 'heading', level: 2, text: 'Procedure' },
  {
    type: 'orderedList',
    items: [
      'Weigh the aluminium block and the empty calorimeter cup',
      'Heat the block in boiling water for ten minutes',
      'Record the water temperature in the cup, then transfer the block quickly',
      'Stir and record the highest temperature reached',
    ],
  },
  { type: 'heading', level: 2, text: 'Equipment' },
  {
    type: 'taskList',
    items: [
      { text: 'Calorimeter with lid and stirrer', checked: true },
      { text: 'Digital thermometer (±0.1 °C)', checked: true },
      { text: 'Balance', checked: false },
    ],
  },
  { type: 'paragraph', runs: [{ text: 'Uncertainty: ', marks: { bold: true } }, { text: 'heat lost during the transfer dominates. Keep the transfer under two seconds.' }] },
];

const READING = [
  { type: 'paragraph', text: 'Exams start on the 3rd. Everyone takes one chapter to summarise.' },
  { type: 'heading', level: 2, text: 'Reading list' },
  {
    type: 'bulletList',
    items: [
      [{ text: 'Chapter 18: Temperature and heat' }],
      [{ text: 'Chapter 19: Kinetic theory of gases' }],
      [{ text: 'Chapter 20: Entropy and the second law' }],
      [{ text: 'Notes on the Carnot cycle', marks: { link: 'https://en.wikipedia.org/wiki/Carnot_cycle' } }],
    ],
  },
  { type: 'heading', level: 2, text: 'Who is summarising what' },
  { type: 'bulletList', items: ['Ana: chapter 18', 'Ben: chapter 19', 'Chen: chapter 20 (reading only, will add comments in the group chat)'] },
];

const GRANT = [
  { type: 'paragraph', text: 'Outline for the summer research grant. Private draft.' },
  { type: 'heading', level: 2, text: 'Question' },
  { type: 'paragraph', text: 'How much heat does a well-insulated student flat lose overnight, and what does a cheap fix save?' },
  { type: 'heading', level: 2, text: 'Plan' },
  { type: 'orderedList', items: ['Log room temperatures for two weeks', 'Estimate losses from a simple RC model', 'Test draught-proofing on one window'] },
];

async function removeDemoData() {
  const users = await User.find({ email: { $in: PEOPLE.map((person) => person.email) } }, { _id: 1 }).lean();
  if (users.length === 0) return 0;
  const userIds = users.map((user) => user._id);
  const workspaces = await Workspace.find({ createdBy: { $in: userIds } }, { _id: 1 }).lean();
  const workspaceIds = workspaces.map((workspace) => workspace._id);
  const documents = await Document.find({ workspaceId: { $in: workspaceIds } }, { _id: 1 }).lean();
  const service = createDocumentsService({ store: createDocStore(), activity: createActivityRecorder(logger), getCollab: () => ({ closeDocument: async () => {} }) });
  await service.purge(documents.map((document) => document._id));
  await Promise.all([
    Membership.deleteMany({ $or: [{ workspaceId: { $in: workspaceIds } }, { userId: { $in: userIds } }] }),
    Invitation.deleteMany({ workspaceId: { $in: workspaceIds } }),
    Activity.deleteMany({ workspaceId: { $in: workspaceIds } }),
    Workspace.deleteMany({ _id: { $in: workspaceIds } }),
    Session.deleteMany({ userId: { $in: userIds } }),
  ]);
  await User.deleteMany({ _id: { $in: userIds } });
  return users.length;
}

async function seed() {
  const activity = createActivityRecorder(logger);
  const documents = createDocumentsService({ store: createDocStore(), activity, getCollab: () => null });
  const history = createHistoryService();
  const passwordHash = await hashPassword(password);

  const people = {};
  for (const person of PEOPLE) {
    people[person.key] = await User.create({ name: person.name, email: person.email, ply: person.ply, passwordHash });
  }
  const { ana, ben, chen } = people;

  const group = await Workspace.create({ name: 'Physics study group', createdBy: ana._id });
  await Membership.create([
    { workspaceId: group._id, userId: ana._id, role: 'owner' },
    { workspaceId: group._id, userId: ben._id, role: 'editor', invitedBy: ana._id },
    { workspaceId: group._id, userId: chen._id, role: 'viewer', invitedBy: ana._id },
  ]);
  await activity.record('workspace.created', { workspaceId: group._id, actorId: ana._id, data: { name: group.name } });
  await activity.record('member.joined', { workspaceId: group._id, actorId: ben._id, data: { role: 'editor' } });
  await activity.record('member.joined', { workspaceId: group._id, actorId: chen._id, data: { role: 'viewer' } });

  const thermoState = buildDocumentState('Thermodynamics revision notes', THERMO);
  const thermo = await documents.create({ workspaceId: group._id, title: 'Thermodynamics revision notes', userId: ana._id, state: thermoState });
  await Document.updateOne({ _id: thermo._id }, { pinned: true });
  await history.saveVersion({
    docId: thermo._id,
    workspaceId: group._id,
    state: thermoState,
    kind: 'manual',
    label: 'Before Thursday’s session',
    createdBy: ana._id,
    contributors: [ana._id],
  });
  await documents.create({ workspaceId: group._id, title: 'Lab 4: calorimetry plan', userId: ben._id, state: buildDocumentState('Lab 4: calorimetry plan', LAB) });
  await documents.create({ workspaceId: group._id, title: 'Exam timetable and reading list', userId: ana._id, state: buildDocumentState('Exam timetable and reading list', READING) });

  const drafts = await Workspace.create({ name: 'Ana’s drafts', createdBy: ana._id });
  await Membership.create({ workspaceId: drafts._id, userId: ana._id, role: 'owner' });
  await activity.record('workspace.created', { workspaceId: drafts._id, actorId: ana._id, data: { name: drafts.name } });
  await documents.create({ workspaceId: drafts._id, title: 'Grant proposal outline', userId: ana._id, state: buildDocumentState('Grant proposal outline', GRANT) });
}

try {
  await connectDatabase({ uri: config.mongoUri, logger, maxAttempts: config.db.maxAttempts, retryMs: config.db.retryMs });
  await ensureIndexes();
  if (reset) {
    const removed = await removeDemoData();
    console.log(removed ? `Removed previous demo data (${removed} accounts).` : 'No previous demo data found.');
  }
  if (await User.exists({ email: PEOPLE[0].email })) {
    console.log('Demo data already exists. Run "npm run seed -- --reset" to recreate it.');
  } else {
    await seed();
    console.log('Seeded demo data.\n');
    console.log('Sign in with any of these accounts (password for all three below):');
    for (const person of PEOPLE) console.log(`  ${person.name.padEnd(13)} ${person.email}`);
    console.log(`  password      ${password}`);
    console.log('\nAna owns "Physics study group" (Ben edits, Chen views) and "Ana’s drafts".');
  }
} catch (error) {
  console.error(`Seeding failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
