import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setApiImpl } from "./lib/api.js";
import {
  apiExport,
  apiFacets,
  apiImport,
  apiSearch,
  apiSession,
  apiSessions,
  apiSources,
} from "./playground/backend.js";
import { PlaygroundShell } from "./playground/Shell.js";
import "./styles/index.css";
import "./styles/playground.css";

// The playground swaps the server-backed API for the in-browser backend before
// the app renders, so every component runs unchanged against bundled sample data.
setApiImpl({ apiFacets, apiSources, apiSessions, apiSession, apiSearch, apiExport, apiImport });

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <PlaygroundShell />
  </StrictMode>,
);
