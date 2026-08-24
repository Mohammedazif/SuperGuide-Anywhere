import { fixturePort } from "./env";
import { buildFixtureApp } from "./server";
import { FixtureStore } from "./store";

const app = buildFixtureApp(new FixtureStore());
const port = fixturePort();
await app.listen({ port, host: "::" });
process.stdout.write(`fixture app on ${port}\n`);
