import { useWebSocket } from "./hooks/useWebSocket";
import { useAuth } from "./hooks/useAuth";
import { ChatPanel } from "./components/ChatPanel";
import { DiagramCanvas } from "./components/DiagramCanvas";
import { ReactFlowProvider } from "@xyflow/react";
import { HistoryDrawer } from "./components/HistoryDrawer";
import { TopBar } from "./components/TopBar";
import { EditToolbar } from "./components/EditToolbar";
import { FloatingPrompt } from "./components/FloatingPrompt";

function App() {
  useAuth();
  const { connectionState, sendMessage, sendClarificationAnswer, regenerate } = useWebSocket();

  return (
    <ReactFlowProvider>
      <div
        className="grid h-screen bg-[var(--color-bg)] font-[family-name:var(--font-sans)]"
        style={{ gridTemplateColumns: "64px 1fr 360px", gridTemplateRows: "auto 1fr" }}
      >
        {/* Row 1 — TopBar spans all 3 columns */}
        <TopBar onRegenerate={regenerate} />

        {/* Row 2, Col 1 — EditToolbar */}
        <EditToolbar />

        {/* Row 2, Col 2 — Canvas with FloatingPrompt overlay */}
        <div className="relative min-h-0">
          <DiagramCanvas />
          <FloatingPrompt
            onSendMessage={sendMessage}
            onSendClarificationAnswer={sendClarificationAnswer}
          />
        </div>

        {/* Row 2, Col 3 — ChatPanel */}
        <ChatPanel connectionState={connectionState} />
      </div>

      {/* Overlay — HistoryDrawer */}
      <HistoryDrawer />
    </ReactFlowProvider>
  );
}

export default App;
