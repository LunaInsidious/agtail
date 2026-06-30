import { registerNodeAdapters } from "../src/core/adapters/register-node.js";

// Tests that go through findAllSessions / searchSessionHits need the fs adapters
// registered (adapters are injected, not statically imported — see adapters/index.ts).
registerNodeAdapters();
