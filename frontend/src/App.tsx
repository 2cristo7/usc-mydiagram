import { useEffect } from "react";
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
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useLlmSettingsStore } from "./store/llmSettings";
import { useAuthStore } from "./store/auth";
import { useStore } from "./store";
import { useUiStore } from "./store/ui";
import { isSupabaseConfigured } from "./lib/supabase";
import { AlertTriangle, RotateCcw } from "lucide-react";

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
  const { connectionState, sendMessage, sendClarificationAnswer, regenerate, chooseDiagramType, retry } = useWebSocket();
  const { ollamaError, setOllamaError, openModal } = useLlmSettingsStore();
  // Carga la config LLM en el store al arrancar y al cambiar la sesión. Sin esto,
  // `config` solo se poblaba al abrir el modal de ajustes (único sitio que llamaba
  // a loadConfig), así que componentes como FloatingPrompt no conocían el
  // transporte activo (lo leían como undefined) aunque la generación sí lo usara
  // (el socket lee localStorage/BD por su cuenta). Al cargarlo aquí, el store pasa
  // a ser fuente de verdad del transporte para toda la UI.
  const loadLlmConfig = useLlmSettingsStore((s) => s.loadConfig);
  const authInitialized = useAuthStore((s) => s.initialized);
  const sessionToken = useAuthStore((s) => s.session?.access_token ?? null);
  useEffect(() => {
    if (!authInitialized) return;
    loadLlmConfig();
  }, [authInitialized, sessionToken, loadLlmConfig]);
  // Error de generación/refinamiento: se muestra en una franja anclada al borde
  // superior del canvas (no como tarjeta central ni toast). Se condiciona a
  // uiState==='error' para que un mensaje residual quede inerte fuera de un fallo activo.
  const uiState = useStore((s) => s.uiState);
  const generationError = useUiStore((s) => s.generationError);

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

        {/* Row 2, Col 2 — Canvas with FloatingPrompt overlay. Boundary por sección:
            un throw de render del canvas no debe tumbar toda la app (el chat sigue). */}
        <div className="relative min-h-0">
          <ErrorBoundary compact>
            <DiagramCanvas />
          </ErrorBoundary>
          {/* Franja de error anclada al borde superior del canvas. Cubre tanto la
              generación desde cero (canvas vacío) como el refinamiento (diagrama en
              pantalla, que no se tapa). El contenedor no captura clics
              (pointer-events-none) para no bloquear el pan/selección bajo la franja;
              solo el botón los recupera. */}
          {generationError && uiState === 'error' && (
            <div className="pointer-events-none absolute top-0 left-0 right-0 z-20 flex items-start gap-2 border-b-[3px] border-[var(--color-danger)] bg-[var(--color-surface)] px-4 py-2 shadow-[0_3px_0_var(--color-danger)]">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[var(--color-danger)]" />
              <p className="flex-1 text-xs font-semibold leading-snug text-[var(--color-ink)]">
                {generationError}
              </p>
              <button
                onClick={retry}
                className="pointer-events-auto flex shrink-0 items-center gap-1 rounded-[var(--radius)] border-2 border-[var(--color-ink)] bg-[var(--color-accent)] px-2 py-1 text-[11px] font-bold text-white transition-[filter] hover:brightness-110"
              >
                <RotateCcw size={12} />
                Reintentar
              </button>
            </div>
          )}
          <FloatingPrompt
            onSendMessage={sendMessage}
            onSendClarificationAnswer={sendClarificationAnswer}
          />
        </div>

        {/* Row 2, Col 3 — ChatPanel (boundary por sección, aislado del canvas) */}
        <ErrorBoundary compact>
          <ChatPanel connectionState={connectionState} onChooseDiagramType={chooseDiagramType} />
        </ErrorBoundary>
      </div>

      {/* Overlay — HistoryDrawer (boundary por sección: aislado del resto) */}
      <ErrorBoundary compact>
        <HistoryDrawer />
      </ErrorBoundary>

      {/* Notificaciones efímeras (errores, confirmaciones) */}
      <Toaster />
    </ReactFlowProvider>
  );
}

export default App;
