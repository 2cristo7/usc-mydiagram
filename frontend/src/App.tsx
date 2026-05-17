import { useWebSocket } from "./hooks/useWebSocket";
import { ChatPanel } from "./components/ChatPanel";
import { DiagramCanvas } from "./components/DiagramCanvas";

function App() {
  const { connectionState, sendMessage } = useWebSocket();

  return (
    <div className="flex h-screen">
      <div className="w-1/3">
        <ChatPanel
          connectionState={connectionState}
          onSendMessage={sendMessage}
        />
      </div>
      <div className="w-2/3 h-full">
        <DiagramCanvas/>
      </div>
    </div>
  );
}

export default App
