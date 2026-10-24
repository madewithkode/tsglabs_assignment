import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { bearerAuth } from '../../src/middleware/bearer-auth';

function run(token: string | undefined, authorization?: string) {
  const req = { headers: authorization === undefined ? {} : { authorization } } as Request;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
  const next = vi.fn() as NextFunction;
  bearerAuth(token)(req, res, next);
  return { res, next };
}

describe('bearerAuth', () => {
  it('lets a request with the right bearer token through', () => {
    const { next, res } = run('s3cret', 'Bearer s3cret');
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects a wrong token with 401', () => {
    const { next, res } = run('s3cret', 'Bearer guess');
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects a request with no Authorization header', () => {
    const { next, res } = run('s3cret');
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects a token sent without the Bearer scheme', () => {
    expect(run('s3cret', 's3cret').next).not.toHaveBeenCalled();
  });

  it('fails closed with 503 when the server has no token configured', () => {
    const { next, res } = run(undefined, 'Bearer anything');
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
