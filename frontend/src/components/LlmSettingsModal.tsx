import { useEffect, useRef, useState } from 'react'
import { X, Trash2 } from 'lucide-react'
import { useLlmSettingsStore } from '../store/llmSettings'
import type { LlmConfigPayload } from '../lib/api'
import { Button, Dropdown } from '../ui/primitives'
import type { DropdownOption } from '../ui/primitives'
import { readTransientKey } from '../lib/transientLlmKey'
import { hasPersistConsent, setPersistConsent } from '../lib/llmConsent'
import { ApiKeyPrivacyModal } from './ApiKeyPrivacyModal'

interface LlmSettingsModalProps {
  open: boolean
  onClose: () => void
}

type Provider = 'openai' | 'anthropic' | 'gemini' | 'ollama'
type Transport = 'api' | 'direct' | 'browser'

const PROVIDER_OPTIONS: { value: Provider; label: string }[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'ollama', label: 'Ollama (local)' },
]

// Catálogo completo de modelos por proveedor comercial. Las dos listas (rápido /
// capaz) ofrecen el mismo catálogo: el usuario elige libremente qué modelo usa en
// cada rol. `default*` marca la elección inicial al cambiar de proveedor.
const COMMERCIAL_MODELS: Record<
  Exclude<Provider, 'ollama'>,
  { models: string[]; defaultFast: string; defaultCapable: string }
> = {
  openai: {
    models: [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-4.1-nano',
      'o3',
      'o3-mini',
      'o4-mini',
      'gpt-4-turbo',
      'gpt-3.5-turbo',
    ],
    defaultFast: 'gpt-4o-mini',
    defaultCapable: 'gpt-4o',
  },
  anthropic: {
    models: [
      'claude-opus-4-8',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
      'claude-fable-5',
      'claude-3-7-sonnet-latest',
      'claude-3-5-haiku-latest',
    ],
    defaultFast: 'claude-haiku-4-5',
    defaultCapable: 'claude-sonnet-4-6',
  },
  gemini: {
    models: [
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
    ],
    defaultFast: 'gemini-2.5-flash',
    defaultCapable: 'gemini-2.5-pro',
  },
}

// Sentinela para "escribir un nombre de modelo a mano" dentro del dropdown.
const CUSTOM = '__custom__'
const CUSTOM_OPTION: DropdownOption = { value: CUSTOM, label: 'Otro… (escribir a mano)' }

// Formato esperado de la API key por proveedor (prefijo + longitud mínima). Es una
// validación de cordura en cliente para cazar pegados incompletos o de otro
// servicio; la validación real la hace el proveedor al generar.
const API_KEY_FORMAT: Record<Exclude<Provider, 'ollama'>, { re: RegExp; hint: string }> = {
  openai: { re: /^sk-[A-Za-z0-9_-]{20,}$/, hint: 'Debe empezar por "sk-".' },
  anthropic: { re: /^sk-ant-[A-Za-z0-9_-]{20,}$/, hint: 'Debe empezar por "sk-ant-".' },
  gemini: { re: /^AIza[A-Za-z0-9_-]{35}$/, hint: 'Debe empezar por "AIza" (39 caracteres).' },
}

function isOllama(p: Provider): p is 'ollama' {
  return p === 'ollama'
}

// Catálogo de opciones del dropdown para el proveedor activo (+ opción "Otro…").
function modelOptions(provider: Provider, ollamaModels: string[]): DropdownOption[] {
  const base = isOllama(provider)
    ? ollamaModels.map((m) => ({ value: m, label: m }))
    : COMMERCIAL_MODELS[provider].models.map((m) => ({ value: m, label: m }))
  return [...base, CUSTOM_OPTION]
}

// Defaults de selección al activar un proveedor (sin config previa).
function providerDefaults(provider: Provider): { fast: string; capable: string } {
  if (isOllama(provider)) return { fast: CUSTOM, capable: CUSTOM }
  return {
    fast: COMMERCIAL_MODELS[provider].defaultFast,
    capable: COMMERCIAL_MODELS[provider].defaultCapable,
  }
}

export function LlmSettingsModal({ open, onClose }: LlmSettingsModalProps) {
  const { config, loading, loadConfig, saveConfig, forceProvider, setTransientKey, clearTransient, deleteApiKey } = useLlmSettingsStore()

  // Local form state
  const [provider, setProvider] = useState<Provider>('ollama')
  const [transport, setTransport] = useState<Transport>('browser')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  // Selección del dropdown (un valor del catálogo o CUSTOM) + texto libre asociado.
  const [fastSel, setFastSel] = useState(CUSTOM)
  const [fastCustom, setFastCustom] = useState('')
  const [capableSel, setCapableSel] = useState(CUSTOM)
  const [capableCustom, setCapableCustom] = useState('')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'ok' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')
  // Modelos Ollama instalados (GET /api/tags) para autocompletar y evitar typos.
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [ollamaTagsError, setOllamaTagsError] = useState(false)
  const apiKeyRef = useRef<HTMLInputElement>(null)
  // S10.3b — modal de consentimiento (salta al guardar la 1ª vez) + bandera de
  // key transitoria activa para ESTE proveedor (vive en sessionStorage, no en BD)
  // + estado de borrado de la key persistida.
  const [consentOpen, setConsentOpen] = useState(false)
  const [transientActive, setTransientActive] = useState(false)
  // Proveedor cuya key se está borrando (null = ninguno), para feedback por fila.
  const [deletingProvider, setDeletingProvider] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState('')

  // ¿El modal se abrió desde el banner de "API key inválida"? En ese caso la key
  // guardada NO sirve (acaba de fallar con 401): forzamos a escribir una nueva con
  // el campo vacío y el foco puesto.
  const cameFromError = forceProvider !== null

  // Load config when modal opens
  useEffect(() => {
    if (!open) return
    loadConfig()
  }, [open, loadConfig])

  // Autocompletado de modelos Ollama: la API local /api/tags devuelve los modelos
  // YA instalados en la máquina del usuario (que es lo único usable en transporte
  // navegador). Los ofrecemos como opciones para eliminar errores de tipeo.
  useEffect(() => {
    if (!open || !isOllama(provider)) return
    const url = transport === 'direct' && baseUrl.trim() ? baseUrl.trim() : 'http://localhost:11434'
    let cancelled = false
    fetch(`${url.replace(/\/$/, '')}/api/tags`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (cancelled) return
        const names = Array.isArray(data?.models)
          ? data.models.map((m: { name: string }) => m.name)
          : []
        setOllamaModels(names)
        setOllamaTagsError(false)
      })
      .catch(() => {
        if (cancelled) return
        setOllamaModels([])
        setOllamaTagsError(true)
      })
    return () => { cancelled = true }
  }, [open, provider, transport, baseUrl])

  // Populate form from loaded config
  useEffect(() => {
    if (!config) return
    setProvider(config.provider)
    setTransport(config.transport)
    setBaseUrl(config.base_url ?? '')
    setApiKey('')
    applyModelValue('fast', config.provider, config.model_fast)
    applyModelValue('capable', config.provider, config.model_capable)
    setSaveStatus('idle')
    setSaveError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config])

  // Apertura dirigida desde el banner de error: si se pidió abrir en un proveedor
  // concreto y NO coincide con el de la config cargada, lo forzamos (resetea a sus
  // defaults). Si coincide, dejamos que el populate de arriba conserve la selección
  // guardada — solo hay que corregir la API key.
  useEffect(() => {
    if (!open || !forceProvider) return
    if (config && config.provider === forceProvider) return
    changeProvider(forceProvider)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, forceProvider, config])

  // Apertura desde el banner de error: el campo de API key arranca vacío (ya lo
  // hace el populate) y recibe el foco para corregir la key cuanto antes. Esperamos
  // a que el provider sea comercial (el input solo existe entonces).
  useEffect(() => {
    if (!open || !cameFromError || isOllama(provider)) return
    const id = window.setTimeout(() => apiKeyRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [open, cameFromError, provider])

  // S10.3b — ¿hay una key transitoria viva en sessionStorage para el proveedor
  // activo? Refresca al abrir y al cambiar de proveedor: el input se muestra
  // entonces como "key activa esta sesión" aunque no esté persistida en BD.
  useEffect(() => {
    if (!open) { setTransientActive(false); return }
    const t = readTransientKey()
    setTransientActive(Boolean(t && t.provider === provider))
  }, [open, provider])

  // ESC to close
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  // Coloca un valor de modelo en el dropdown: si está en el catálogo del proveedor
  // se selecciona; si no (modelo a medida o de Ollama no detectado), pasa a "Otro…"
  // con el texto en el campo libre.
  function applyModelValue(slot: 'fast' | 'capable', prov: Provider, value: string) {
    const known = isOllama(prov)
      ? false // Ollama: dejamos siempre el valor en el campo libre (la detección llega async)
      : COMMERCIAL_MODELS[prov].models.includes(value)
    const setSel = slot === 'fast' ? setFastSel : setCapableSel
    const setCustom = slot === 'fast' ? setFastCustom : setCapableCustom
    if (value && known) {
      setSel(value)
      setCustom('')
    } else if (value) {
      setSel(CUSTOM)
      setCustom(value)
    } else {
      const def = providerDefaults(prov)
      setSel(slot === 'fast' ? def.fast : def.capable)
      setCustom('')
    }
  }

  // Cambio de proveedor: resetea limpio la selección de modelos a los defaults del
  // nuevo proveedor (este reset es el que faltaba y causaba opciones "fantasma").
  function changeProvider(next: Provider) {
    setProvider(next)
    setTransport(isOllama(next) ? 'browser' : 'api')
    const def = providerDefaults(next)
    setFastSel(def.fast)
    setFastCustom('')
    setCapableSel(def.capable)
    setCapableCustom('')
    setApiKey('')
    setSaveStatus('idle')
    setSaveError('')
  }

  const options = modelOptions(provider, ollamaModels)
  const resolvedFast = fastSel === CUSTOM ? fastCustom : fastSel
  const resolvedCapable = capableSel === CUSTOM ? capableCustom : capableSel

  // ¿Tiene el proveedor seleccionado una key guardada (cifrada) en Vault?
  // S10.3c — multi-key: cada proveedor comercial puede tener la suya.
  const providerHasSavedKey = Boolean(config?.saved_providers?.includes(provider))

  // Proveedores con key guardada, con su etiqueta, para listarlos y revocarlos.
  const storedKeys = (config?.saved_providers ?? []).map((value) => ({
    value,
    label: PROVIDER_OPTIONS.find((p) => p.value === value)?.label ?? value,
  }))

  // ¿Hay una API key utilizable para el proveedor seleccionado?
  const hasUsableKey =
    isOllama(provider) ||
    apiKey.trim().length > 0 ||
    // En modo "corregir key" no contamos la guardada: acaba de fallar con 401.
    (!cameFromError && providerHasSavedKey) ||
    // Una key transitoria viva (sessionStorage) también sirve para generar.
    (!cameFromError && transientActive)

  // ¿Hay una key NUEVA escrita y bien formada para un proveedor comercial?
  const typedKey = !isOllama(provider) && apiKey.trim() ? apiKey.trim() : undefined

  // ¿El formulario difiere de la config ya guardada? Si la selección coincide con
  // la actual (mismo proveedor, transporte, modelos y base_url) y no se ha escrito
  // una key nueva, no hay nada que guardar → el botón se desactiva.
  const formBaseUrl = transport === 'direct' && baseUrl.trim() ? baseUrl.trim() : ''
  const isDirty =
    !config ||
    Boolean(typedKey) ||
    provider !== config.provider ||
    transport !== config.transport ||
    resolvedFast.trim() !== config.model_fast ||
    resolvedCapable.trim() !== config.model_capable ||
    formBaseUrl !== (config.base_url ?? '')

  // Valida modelos, presencia de key y formato. Devuelve false (y fija el error)
  // si algo no cuadra; true si se puede guardar.
  function validate(): boolean {
    if (!resolvedFast.trim() || !resolvedCapable.trim()) {
      setSaveStatus('error')
      setSaveError('Indica el nombre de ambos modelos (rápido y capaz).')
      return false
    }
    if (!hasUsableKey) {
      const name = PROVIDER_OPTIONS.find((p) => p.value === provider)?.label ?? provider
      setSaveStatus('error')
      setSaveError(`Introduce tu API key de ${name}: sin ella la generación no funcionará.`)
      return false
    }
    if (typedKey) {
      const fmt = API_KEY_FORMAT[provider as Exclude<Provider, 'ollama'>]
      if (!fmt.re.test(typedKey)) {
        const name = PROVIDER_OPTIONS.find((p) => p.value === provider)?.label ?? provider
        setSaveStatus('error')
        setSaveError(`La API key no tiene el formato de ${name}. ${fmt.hint}`)
        return false
      }
    }
    return true
  }

  // Guarda la configuración. persist=true → la key viaja al PUT y se cifra en
  // Vault; persist=false → la key (si la hay) se queda solo en sessionStorage +
  // socket de esta sesión, nunca toca BD.
  async function doSave(persist: boolean) {
    const payload: LlmConfigPayload = {
      provider,
      transport,
      model_fast: resolvedFast.trim(),
      model_capable: resolvedCapable.trim(),
      base_url: transport === 'direct' && baseUrl.trim() ? baseUrl.trim() : undefined,
      api_key: persist ? typedKey : undefined,
    }
    try {
      await saveConfig(payload)
      if (typedKey) {
        if (persist) {
          // Ya está cifrada en Vault: la copia transitoria sobra → olvidarla.
          clearTransient()
          setTransientActive(false)
        } else {
          // Modo por defecto: la key vive solo en el navegador + socket de esta sesión.
          setTransientKey(provider, typedKey)
          setTransientActive(true)
        }
      }
      setSaveStatus('ok')
    } catch (err) {
      setSaveStatus('error')
      setSaveError((err as Error).message)
    }
  }

  // Click en "Guardar configuración": valida y decide la ruta. Si hay una key
  // comercial nueva y aún no se ha dado consentimiento para guardarla, abre el
  // modal de consentimiento (primera vez). Si ya se consintió, persiste directo.
  // Sin key nueva (o ya consentido sin key), guarda transitorio.
  function handleSaveClick() {
    setSaveStatus('idle')
    setSaveError('')
    if (!validate()) return
    if (typedKey && !hasPersistConsent()) {
      setConsentOpen(true)
      return
    }
    void doSave(Boolean(typedKey) && hasPersistConsent())
  }

  // Consentimiento dado en el modal: recuérdalo y persiste la key.
  function handleConsentConfirm() {
    setPersistConsent(true)
    setConsentOpen(false)
    void doSave(true)
  }

  // Consentimiento rechazado (cerrar el modal): cae al modo transitorio.
  function handleConsentDecline() {
    setConsentOpen(false)
    void doSave(false)
  }

  // Revoca la key guardada de UN proveedor (borra de Vault). Si es el proveedor
  // activo, limpia también su rastro transitorio y el input.
  async function handleDeleteKey(target: string) {
    setDeletingProvider(target)
    setDeleteError('')
    try {
      await deleteApiKey(target)
      if (target === provider) {
        clearTransient()
        setTransientActive(false)
        setApiKey('')
      }
    } catch (err) {
      setDeleteError((err as Error).message)
    } finally {
      setDeletingProvider(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      onMouseDown={onClose}
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Configuración del modelo de lenguaje"
        onMouseDown={(e) => e.stopPropagation()}
        className="relative w-[520px] max-w-[95vw] bg-[var(--color-surface)] border-[3px] border-[var(--color-ink)] rounded-[var(--radius)] shadow-[var(--shadow-brutal-lg)] p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto scrollbar-brutal"
      >
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute top-3 right-3 flex h-7 w-7 items-center justify-center border-[2px] border-[var(--color-ink)] rounded-[var(--radius)] bg-[var(--color-surface)] text-[var(--color-ink)] transition-all duration-75 hover:translate-x-[-1px] hover:translate-y-[-1px] active:translate-x-[1px] active:translate-y-[1px]"
        >
          <X size={14} />
        </button>

        <div>
          <h2 className="text-lg font-bold text-[var(--color-ink)] mb-0">Modelo de lenguaje</h2>
          <p className="text-sm text-[var(--color-ink)] opacity-70">
            Configura el proveedor y los modelos usados para generar diagramas.
          </p>
        </div>

        {/* Provider selector */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold uppercase tracking-wide text-[var(--color-ink)]">
            Proveedor
          </label>
          <div className="grid grid-cols-2 gap-2">
            {PROVIDER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => changeProvider(opt.value)}
                className={`
                  px-3 py-2 text-sm font-semibold border-[3px] border-[var(--color-ink)]
                  rounded-[var(--radius)] transition-all duration-75 text-left
                  ${provider === opt.value
                    ? 'bg-[var(--color-ink)] text-[var(--color-surface)] shadow-none'
                    : 'bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[var(--shadow-brutal)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[var(--shadow-brutal-lg)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none'
                  }
                `}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Ollama-specific: transport */}
        {isOllama(provider) && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold uppercase tracking-wide text-[var(--color-ink)]">
              Transporte
            </label>
            <div className="flex gap-2">
              {([
                { value: 'browser' as Transport, label: 'En mi navegador' },
                { value: 'direct' as Transport, label: 'Servidor directo' },
              ] as { value: Transport; label: string }[]).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setTransport(opt.value)}
                  className={`
                    flex-1 px-3 py-2 text-sm font-semibold border-[3px] border-[var(--color-ink)]
                    rounded-[var(--radius)] transition-all duration-75
                    ${transport === opt.value
                      ? 'bg-[var(--color-ink)] text-[var(--color-surface)] shadow-none'
                      : 'bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[var(--shadow-brutal)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[var(--shadow-brutal-lg)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none'
                    }
                  `}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Ollama direct: optional base_url */}
        {isOllama(provider) && transport === 'direct' && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold uppercase tracking-wide text-[var(--color-ink)]">
              URL base (opcional)
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:11434"
              className="px-3 py-2 text-sm font-mono border-[3px] border-[var(--color-ink)] rounded-[var(--radius)] bg-[var(--color-surface)] text-[var(--color-ink)] outline-none focus:shadow-[var(--shadow-brutal)]"
            />
          </div>
        )}

        {/* API key for commercial providers */}
        {!isOllama(provider) && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold uppercase tracking-wide text-[var(--color-ink)]">
              API Key
            </label>
            <input
              ref={apiKeyRef}
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                cameFromError
                  ? 'Introduce una API key válida'
                  : providerHasSavedKey
                    ? 'Introduce tu nueva api key'
                    : transientActive
                      ? '•••• activa solo esta sesión'
                      : 'Introduce tu API key'
              }
              className="px-3 py-2 text-sm font-mono border-[3px] border-[var(--color-ink)] rounded-[var(--radius)] bg-[var(--color-surface)] text-[var(--color-ink)] outline-none focus:shadow-[var(--shadow-brutal)]"
            />
            {/* S10.3b — texto informativo según el modo de guardado activo. Sin
                enlaces: el consentimiento salta solo al guardar; la revocación
                está debajo del botón de guardar. */}
            {providerHasSavedKey ? (
              <p className="text-xs opacity-70 text-[var(--color-ink)]">
                Tu API key está <strong>guardada de forma permanente</strong> y cifrada.
              </p>
            ) : (
              <p className="text-xs opacity-70 text-[var(--color-ink)]">
                Tu API key se cifra y <strong>nunca se guarda</strong>: tendrás que volver a
                introducirla en cada sesión de trabajo. La primera vez que la guardes te
                pediremos consentimiento para almacenarla.
              </p>
            )}
          </div>
        )}

        {/* Aviso de modelos Ollama detectados */}
        {isOllama(provider) && (
          ollamaModels.length > 0 ? (
            <p className="text-xs opacity-60 text-[var(--color-ink)] -mb-2">
              {ollamaModels.length} modelo{ollamaModels.length > 1 ? 's' : ''} instalado{ollamaModels.length > 1 ? 's' : ''} detectado{ollamaModels.length > 1 ? 's' : ''} · elígelo en la lista.
            </p>
          ) : ollamaTagsError ? (
            <p className="text-xs opacity-60 text-[var(--color-danger)] -mb-2">
              No se pudo leer tu Ollama local (¿está corriendo?). Usa «Otro…» para escribir el nombre a mano.
            </p>
          ) : null
        )}

        {/* Model fast */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold uppercase tracking-wide text-[var(--color-ink)]">
            Modelo rápido
          </label>
          <Dropdown
            ariaLabel="Modelo rápido"
            value={fastSel}
            options={options}
            onChange={setFastSel}
            mono
            placeholder="Selecciona un modelo…"
          />
          {fastSel === CUSTOM && (
            <input
              type="text"
              value={fastCustom}
              onChange={(e) => setFastCustom(e.target.value)}
              placeholder={isOllama(provider) ? 'qwen3:1.7b' : 'nombre del modelo'}
              className="mt-1 px-3 py-2 text-sm font-mono border-[3px] border-[var(--color-ink)] rounded-[var(--radius)] bg-[var(--color-surface)] text-[var(--color-ink)] outline-none focus:shadow-[var(--shadow-brutal)]"
            />
          )}
        </div>

        {/* Model capable */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold uppercase tracking-wide text-[var(--color-ink)]">
            Modelo capaz
          </label>
          <Dropdown
            ariaLabel="Modelo capaz"
            value={capableSel}
            options={options}
            onChange={setCapableSel}
            mono
            placeholder="Selecciona un modelo…"
          />
          {capableSel === CUSTOM && (
            <input
              type="text"
              value={capableCustom}
              onChange={(e) => setCapableCustom(e.target.value)}
              placeholder={isOllama(provider) ? 'qwen3:8b' : 'nombre del modelo'}
              className="mt-1 px-3 py-2 text-sm font-mono border-[3px] border-[var(--color-ink)] rounded-[var(--radius)] bg-[var(--color-surface)] text-[var(--color-ink)] outline-none focus:shadow-[var(--shadow-brutal)]"
            />
          )}
        </div>

        {/* Feedback */}
        {saveStatus === 'ok' && (
          <p className="text-sm font-semibold text-[var(--color-accent-3)] border-[2px] border-[var(--color-accent-3)] rounded-[var(--radius)] px-3 py-2">
            ✓ Configuración guardada correctamente.
          </p>
        )}
        {saveStatus === 'error' && (
          <p className="text-sm font-semibold text-[var(--color-danger)] border-[2px] border-[var(--color-danger)] rounded-[var(--radius)] px-3 py-2">
            ✗ {saveError}
          </p>
        )}

        {/* Save button — al guardar con una key nueva sin consentimiento previo,
            salta el modal de consentimiento (1ª vez); si no, guarda directo. */}
        <Button
          variant="primary"
          onClick={handleSaveClick}
          disabled={loading || !hasUsableKey || !isDirty}
          className="w-full justify-center"
        >
          {loading ? 'Guardando…' : 'Guardar configuración'}
        </Button>

        {/* S10.3c — revocación de las keys guardadas en Vault (una por proveedor).
            Se muestra qué key concreta está guardada y un botón de borrado por fila. */}
        {storedKeys.length > 0 && (
          <div className="flex flex-col gap-2 border-t-[2px] border-[var(--color-ink)] pt-4">
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-ink)]">
              Keys guardadas de forma permanente
            </p>
            {storedKeys.map((p) => (
              <div key={p.value} className="flex items-center justify-between gap-3">
                <p className="text-xs text-[var(--color-ink)] opacity-90">
                  API key de <strong>{p.label}</strong> — guardada y cifrada
                </p>
                <button
                  type="button"
                  onClick={() => handleDeleteKey(p.value)}
                  disabled={deletingProvider !== null || loading}
                  aria-label={`Borrar API key guardada de ${p.label}`}
                  className="group flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border-[2px] border-[var(--color-ink)] bg-[var(--color-surface)] text-[var(--color-danger)] rounded-[var(--radius)] shadow-[var(--shadow-brutal)] transition-all duration-75 hover:translate-x-[-2px] hover:translate-y-[-2px] hover:bg-[var(--color-danger)] hover:text-white hover:shadow-[6px_6px_0_0_var(--color-ink)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:bg-[var(--color-surface)] disabled:hover:text-[var(--color-danger)] disabled:hover:shadow-[var(--shadow-brutal)] whitespace-nowrap"
                >
                  <Trash2 size={13} /> {deletingProvider === p.value ? 'Borrando…' : 'Borrar key'}
                </button>
              </div>
            ))}
            {deleteError && (
              <p className="text-xs text-[var(--color-danger)] font-semibold">✗ {deleteError}</p>
            )}
          </div>
        )}
      </div>

      {/* S10.3b — modal de consentimiento. Se monta solo al abrirse para que su
          estado (frase escrita) nazca limpio. Cerrar sin consentir → transitorio. */}
      {consentOpen && (
        <ApiKeyPrivacyModal
          open={consentOpen}
          onClose={handleConsentDecline}
          providerLabel={PROVIDER_OPTIONS.find((p) => p.value === provider)?.label ?? provider}
          hasTypedKey={Boolean(typedKey)}
          onConfirm={handleConsentConfirm}
        />
      )}
    </div>
  )
}
