import { useState } from "react";
import { Sidebar } from "./components/Sidebar.js";
import { TitleBar } from "./components/TitleBar.js";
import { PresetsView } from "./views/PresetsView.js";
import { QueueView } from "./views/QueueView.js";
import { SettingsView } from "./views/SettingsView.js";

export type View = "queue" | "presets" | "settings";

export function App() {
  const [view, setView] = useState<View>("queue");

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar view={view} onNavigate={setView} />
        <main className="min-w-0 flex-1">
          {view === "queue" && <QueueView />}
          {view === "presets" && <PresetsView />}
          {view === "settings" && <SettingsView />}
        </main>
      </div>
    </div>
  );
}
