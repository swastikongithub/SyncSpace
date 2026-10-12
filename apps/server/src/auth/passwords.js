import { Algorithm, hash, verify } from '@node-rs/argon2';

// OWASP Password Storage Cheat Sheet minimum for Argon2id: m = 19 MiB, t = 2, p = 1.
const OPTIONS = { algorithm: Algorithm.Argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export function hashPassword(password) {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash, password) {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash;
/** Spends the same work as a real verification so login timing doesn't reveal unknown emails. */
export async function burnVerification(password) {
  dummyHash ??= await hash('syncspace-timing-equaliser', OPTIONS);
  await verifyPassword(dummyHash, password);
}
