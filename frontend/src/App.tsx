import { useWebSocket } from "./hooks/useWebSocket";
import { useAuth } from "./hooks/useAuth";
import { useUndoRedoShortcuts } from "./hooks/useUndoRedoShortcuts";
import { ChatPanel } from "./components/ChatPanel";
import { DiagramCanvas } from "./components/DiagramCanvas";
import { ReactFlowProvider } from "@xyflow/react";
import { HistoryDrawer } from "./components/HistoryDrawer";
import { TopBar } from "./components/TopBar";
import { EditToolbar } from "./components/EditToolbar";
import { FloatingPrompt } from "./components/FloatingPrompt";
import { AlertBanner, Toaster } from "./ui/primitives";
import { useLlmSettingsStore } from "./store/llmSettings";
import { isSupabaseConfigured } from "./lib/supabase";

// Pantalla de configuración: si faltan las VITE_SUPABASE_* el cliente no puede
// autenticar. Antes esto lanzaba a nivel de módulo (pantalla en blanco); ahora
// se muestra un mensaje claro al desarrollador en vez de romper el arranque.
function ConfigError() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[var(--color-bg)] p-6 font-[family-name:var(--font-sans)]">
      <div className="max-w-md border-[3px] border-[var(--color-danger)] bg-[var(--color-surface)] p-6 text-center shadow-[var(--shadow-brutal)]">
        <h1 className="text-lg font-bold text-[var(--color-ink)]">Configuración incompleta</h1>
        <p className="mt-2 text-sm text-[var(--color-ink)]/70">
          Faltan las variables <code className="font-mono">VITE_SUPABASE_URL</code> y{" "}
          <code className="font-mono">VITE_SUPABASE_ANON_KEY</code> en el <code className="font-mono">.env</code> del frontend.
          Añádelas y recarga.
        </p>
      </div>
    </div>
  );
}

// Traduce un error de LLM a texto de remediación para el AlertBanner superior.
// Cubre dos orígenes:
//   1. Transporte navegador→Ollama (proxy browser): error_codes 'ollama_unreachable'
//      y 'model_missing', detectados en el handler llm:request de useWebSocket.
//   2. Errores de LLM propagados por el agente Python vía diagram:error con
//      category 'llm_error': el detail ya viene en español y es autoexplicativo,
//      se muestra directamente sin añadir prefijo.
function ollamaErrorMessage(err: { error_code: string; detail: string; model?: string }): string {
  if (err.error_code === 'ollama_unreachable') {
    return 'No se pudo conectar con tu Ollama local. Asegúrate de que está corriendo (`ollama serve`) y de permitir esta web con `OLLAMA_ORIGINS=http://localhost:5173 ollama serve` (ajusta el origen al de tu app).';
  }
  if (err.error_code === 'model_missing') {
    return `El modelo «${err.model ?? ''}» no está descargado en tu Ollama. Ejecútalo: \`ollama pull ${err.model ?? '<modelo>'}\`.`;
  }
  if (err.error_code === 'llm_error') {
    return err.detail;
  }
  return `Error del modelo de lenguaje: ${err.detail}`;
}

function App() {
  useAuth();
  useUndoRedoShortcuts();
  const { connectionState, sendMessage, sendClarificationAnswer, regenerate, chooseDiagramType } = useWebSocket();
  const { ollamaError, setOllamaError, openModal } = useLlmSettingsStore();

  // Early return después de todos los hooks para no romper las reglas de React
  if (!isSupabaseConfigured) return <ConfigError />;

  return (
    <ReactFlowProvider>
      {ollamaError && (
        <div className="fixed top-0 left-0 right-0 z-50">
          <AlertBanner
            variant="error"
            message={ollamaErrorMessage(ollamaError)}
            onDismiss={() => setOllamaError(null)}
            action={
              ollamaError.error_code === 'llm_error'
                ? {
                    label: 'Abrir configuración',
                    onClick: () => {
                      openModal(ollamaError.provider)
                      setOllamaError(null)
                    },
                  }
                : undefined
            }
          />
        </div>
      )}
      <div
        className="grid h-screen bg-[var(--color-bg)] font-[family-name:var(--font-sans)]"
        style={{ gridTemplateColumns: "auto 1fr 360px", gridTemplateRows: "auto 1fr" }}
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
        <ChatPanel connectionState={connectionState} onChooseDiagramType={chooseDiagramType} />
      </div>

      {/* Overlay — HistoryDrawer */}
      <HistoryDrawer />

      {/* Notificaciones efímeras (errores, confirmaciones) */}
      <Toaster />
    </ReactFlowProvider>
  );
}

export default App;
