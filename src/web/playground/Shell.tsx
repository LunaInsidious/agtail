import { useState } from "react";
import { App } from "../App.js";
import { Terminal } from "./Terminal.js";
import { PlaygroundBanner } from "./Banner.js";

// The playground wrapper: a toggle between the normal GUI and a terminal view
// (both driven by the same in-browser backend), plus the ephemeral-data banner.
export function PlaygroundShell() {
  const [view, setView] = useState<"app" | "terminal">("app");
  return (
    <>
      {view === "app" ? <App /> : <Terminal />}
      <button
        type="button"
        className="pgtoggle"
        onClick={() => setView((v) => (v === "app" ? "terminal" : "app"))}
        title={view === "app" ? "Switch to the terminal" : "Switch to the app"}
      >
        {view === "app" ? "⌘ terminal" : "▦ app"}
      </button>
      <PlaygroundBanner />
    </>
  );
}
