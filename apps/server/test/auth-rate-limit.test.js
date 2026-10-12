import { afterAll, beforeAll, expect, it } from 'vitest';
import { apiClient, registerUser, startTestServer } from './helpers.js';

let harness;
beforeAll(async () => {
  harness = await startTestServer({ configOverrides: { rateLimits: { login: 3, register: 1000 } } });
});
afterAll(async () => {
  await harness.stop();
});

it('throttles repeated sign-in attempts for one account', async () => {
  await registerUser(harness, { email: 'target@example.test' });
  const statuses = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await apiClient(harness).post('/api/auth/login', { email: 'target@example.test', password: 'guess number one' });
    statuses.push(res.status);
    if (res.status === 429) expect(res.body.error.code).toBe('rate_limited');
  }
  expect(statuses).toEqual([401, 401, 401, 429]);
});
