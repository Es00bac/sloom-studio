import { describe, expect, it } from 'vitest';
import {
  findCredentialLeak,
  verifyFlowProduction,
} from './verify-flow-production.mjs';

describe('Flow production audit gate', () => {
  it('passes the checked-in executable contracts and generated matrices', async () => {
    const result = await verifyFlowProduction();

    expect(result.errors).toEqual([]);
    expect(result.nodeCount).toBe(65);
    expect(result.modelCount).toBe(182);
    expect(result.normalModelCount).toBe(178);
  }, 15_000);

  it('detects credential-shaped literal values without flagging schema/help placeholders', () => {
    expect(findCredentialLeak('const key = "-----BEGIN PRIVATE KEY-----\\nREAL-LIKE-DATA";')).toContain('private key');
    expect(findCredentialLeak('placeholder: "{ \\"type\\": \\"authorized_user\\", \\"refresh_token\\": \\"…\\" }"')).toBeUndefined();
    expect(findCredentialLeak("if (typeof data.refresh_token !== 'string') throw new Error('missing');")).toBeUndefined();
  });
});
