import type { NextFunction, Request, Response } from 'express';

// Stand-in for your real session check. It must set res.locals.userId from a verified token.
export function requireUser(req: Request, res: Response, next: NextFunction): void {
  const userId = req.get('X-Demo-User');
  if (!userId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  res.locals.userId = userId;
  next();
}
