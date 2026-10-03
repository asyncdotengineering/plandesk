// Vercel function: vercel.json rewrites /api/* and /mcp/* here.
import handler from '@plandesk/server/vercel';

export default { fetch: handler };
