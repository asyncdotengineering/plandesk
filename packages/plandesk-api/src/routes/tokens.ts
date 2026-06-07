import { Hono } from 'hono';
import type { TokenService } from '../services/tokens.js';

export function createTokensRouter(tokenService: TokenService): Hono {
  const router = new Hono();

  router.post('/mcp-tokens', async (c) => {
    const body = await c.req.json<{ name?: string }>();
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return c.json({ error: 'invalid_argument' }, 400);
    }
    const created = tokenService.create(body.name.trim());
    return c.json(created, 201);
  });

  router.get('/mcp-tokens', (c) => c.json(tokenService.list()));

  router.delete('/mcp-tokens/:id', (c) => {
    const revoked = tokenService.revoke(c.req.param('id'));
    if (!revoked) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.body(null, 204);
  });

  return router;
}
