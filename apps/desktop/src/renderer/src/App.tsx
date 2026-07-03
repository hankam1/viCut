import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar.js";
import { TitleBar } from "./components/TitleBar.js";
import { ToastProvider } from "./components/toast.js";
import { OnboardingView } from "./views/OnboardingView.js";
import { PresetsView } from "./views/PresetsView.js";
import { QueueView } from "./views/QueueView.js";
import { SettingsView } from "./views/SettingsView.js";

export type View = "queue" | "presets" | "settings";

type Phase = "checking" | "onboarding" | "ready";

export function App() {
  const [view, setView] = useState<View>("queue");
  const [phase, setPhase] = useState<Phase>("checking");

  useEffect(() => {
    void window.vicut.tools.status().then((tools) => {
      setPhase(tools.ffmpeg && tools.ffprobe ? "ready" : "onboarding");
    });
    return window.vicut.on("debug:open-view", (payload) => {
      const target = payload as View;
      if (target === "queue" || target === "presets" || target === "settings") setView(target);
    });
  }, []);

  return (
    <ToastProvider>
      <div className="flex h-full flex-col bg-bg text-text">
        <TitleBar />
        {phase === "onboarding" ? (
          <OnboardingView onDone={() => setPhase("ready")} />
        ) : phase === "ready" ? (
          <div className="flex min-h-0 flex-1">
            <Sidebar view={view} onNavigate={setView} />
            <main className="min-w-0 flex-1">
              {view === "queue" && <QueueView />}
              {view === "presets" && <PresetsView />}
              {view === "settings" && <SettingsView />}
            </main>
          </div>
        ) : null}
      </div>
    </ToastProvider>
  );
}
