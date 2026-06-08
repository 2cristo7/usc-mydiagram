import { useWebSocket } from "./hooks/useWebSocket";
import { ChatPanel } from "./components/ChatPanel";
import { DiagramCanvas } from "./components/DiagramCanvas";
import { DiagramToolbar } from "./components/DiagramToolbar";
import { ReactFlowProvider } from "@xyflow/react";

function App() {
  const { connectionState, sendMessage, sendClarificationAnswer } = useWebSocket();

  return (
    <ReactFlowProvider>
        <div className="flex h-screen">
          <div className="w-1/3">
            <ChatPanel
              connectionState={connectionState}
              onSendMessage={sendMessage}
              onSendClarificationAnswer={sendClarificationAnswer}
            />
          </div>
          <div className="w-2/3 h-full flex flex-col">
            <DiagramToolbar />
            <div className="flex-1 min-h-0 flex">
              <DiagramCanvas/>
            </div>
          </div>
      </div>
    </ReactFlowProvider>
  );
}

export default App
