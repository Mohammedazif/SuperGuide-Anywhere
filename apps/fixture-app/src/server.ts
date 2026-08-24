import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import { renderPage, type PageName, type Variant } from "./pages";
import { type FixtureStore } from "./store";

const STRICT_CSP =
  "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

const CSS = `
body { font: 15px/1.6 system-ui, sans-serif; margin: 0 auto; max-width: 720px; padding: 24px; }
input, button { font: inherit; padding: 4px 8px; margin: 4px 0; }
`;

function variantOf(request: FastifyRequest): Variant {
  const query = request.query as Record<string, unknown>;
  if (query["variant"] === "b") return "b";
  if (query["variant"] === "a") return "a";
  const cookie = request.headers.cookie ?? "";
  return /(?:^|;\s*)variant=b(?:;|$)/.test(cookie) ? "b" : "a";
}

function sendPage(
  request: FastifyRequest,
  reply: FastifyReply,
  store: FixtureStore,
  name: PageName,
): void {
  const variant = variantOf(request);
  const query = request.query as Record<string, unknown>;
  const saved = query["saved"] === "1";
  void reply
    .header("content-security-policy", STRICT_CSP)
    .header("set-cookie", `variant=${variant}; Path=/`)
    .header("content-type", "text/html; charset=utf-8")
    .send(renderPage(name, store.snapshot(), variant, saved));
}

export function buildFixtureApp(store: FixtureStore): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/app.css", async (_request, reply) => {
    await reply
      .header("content-security-policy", STRICT_CSP)
      .header("content-type", "text/css")
      .send(CSS);
  });

  app.get("/", async (request, reply) => {
    sendPage(request, reply, store, "dashboard");
  });
  app.get("/settings/billing", async (request, reply) => {
    sendPage(request, reply, store, "billing");
  });
  app.get("/settings/team", async (request, reply) => {
    sendPage(request, reply, store, "team");
  });
  app.get("/settings/profile", async (request, reply) => {
    sendPage(request, reply, store, "profile");
  });
  app.get("/settings/plan", async (request, reply) => {
    sendPage(request, reply, store, "plan");
  });

  const billingBody = z.object({ line1: z.string(), city: z.string(), postal: z.string() });
  app.post("/settings/billing", async (request, reply) => {
    const body = billingBody.safeParse(request.body);
    if (body.success) store.saveBilling(body.data);
    await reply
      .header("content-security-policy", STRICT_CSP)
      .redirect("/settings/billing?saved=1", 303);
  });

  const inviteBody = z.object({ email: z.string().min(1) });
  app.post("/settings/team/invite", async (request, reply) => {
    const body = inviteBody.safeParse(request.body);
    if (body.success) store.invite(body.data.email);
    await reply
      .header("content-security-policy", STRICT_CSP)
      .redirect("/settings/team?saved=1", 303);
  });

  const profileBody = z.object({
    fullName: z.string(),
    email: z.string(),
    updates: z.string().optional(),
  });
  app.post("/settings/profile", async (request, reply) => {
    const body = profileBody.safeParse(request.body);
    if (body.success) {
      store.saveProfile(body.data.fullName, body.data.email, body.data.updates !== undefined);
    }
    await reply
      .header("content-security-policy", STRICT_CSP)
      .redirect("/settings/profile?saved=1", 303);
  });

  app.post("/settings/plan", async (_request, reply) => {
    store.switchPlan();
    await reply
      .header("content-security-policy", STRICT_CSP)
      .redirect("/settings/plan?saved=1", 303);
  });

  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, payload, done) => {
      done(null, Object.fromEntries(new URLSearchParams(String(payload))));
    },
  );

  return app;
}
