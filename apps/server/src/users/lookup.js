import { collaboratorIdentity, User } from './model.js';

/** Loads display identities (no emails) for a set of user ids. */
export async function peopleById(ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (unique.length === 0) return new Map();
  const users = await User.find({ _id: { $in: unique } }, { name: 1, ply: 1 }).lean();
  return new Map(users.map((user) => [String(user._id), collaboratorIdentity(user)]));
}
