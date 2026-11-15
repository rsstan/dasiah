// HTTP routes of the accessibility service. Each route is described in contracts/openapi/accessibility.yaml
// first; handlers only translate HTTP to a use case and back (see .claude/skills/api-contract).
import type { FastifyInstance } from '@heatmap/common';
import type { AppContext } from '../context.ts';

export async function registerRoutes(app: FastifyInstance, _ctx: AppContext): Promise<void> {
  // Example (remove when the first real route exists):
  // app.get('/things/:id', { schema: { params: ... } }, async (req) => getThing(_ctx, req.params.id));
  void app;
}
