/**
 * Guards /mcp. Chord is registered with `auth_type: "bearer"` and sends the stored token as
 * `Authorization: Bearer …` on every call. Without this the tools — which create real (test)
 * Paystack charges — would be open to anyone who finds the URL.
 */

import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

const sameToken = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export function bearerAuth(expected: string | undefined): RequestHandler {
  return (req, res, next) => {
    // Fail closed: a missing token in the environment must never mean "no auth".
    if (!expected) {
      res.status(503).json({ error: 'MCP_BEARER_TOKEN is not configured on the server' });
      return;
    }
    const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    if (!match || !sameToken(match[1], expected)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };
}
