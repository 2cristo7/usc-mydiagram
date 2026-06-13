# MydIAgram

**Conversational AI agent that generates editable software diagrams from natural language.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/Python-3.12+-3776AB?logo=python&logoColor=white)](https://python.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.135-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)

MydIAgram turns plain-text descriptions into interactive, editable diagrams — ERD, UML class, sequence, flowchart, architecture (C4), state machine, and mindmap — rendered on a drag-and-drop canvas. An AI agent powered by LangGraph classifies the diagram type, extracts nodes and edges via structured LLM tool calls, validates the output against strict schemas, and streams every step to the UI in real time. Users can refine diagrams conversationally, and the agent can ask clarifying questions when the input is ambiguous.

## Features

- **Natural language to diagram** — describe what you need; the agent classifies the type, extracts structure, and renders it instantly
- **7 diagram types** — Entity-Relationship, UML Class, Sequence, Flowchart, Architecture (C4), State Machine, Mindmap — each with dedicated node shapes and layout logic
- **Real-time streaming** — every agent tool call (classify, extract, validate) streams to the frontend via WebSocket, with a collapsible tool tray showing live progress
- **Interactive canvas** — drag, resize, connect, and edit nodes directly on a React Flow canvas; undo/redo support for session edits
- **Conversational refinement** — after generating a diagram, send follow-up prompts to modify it; the agent can also ask clarification questions mid-generation
- **Neobrutalist UI** — bold borders, hard shadows, Space Grotesk / JetBrains Mono typography, orange accent, light/dark theme toggle persisted in localStorage
- **Multi-LLM support** — switch between local inference (Ollama / Qwen3), OpenAI (GPT-4o), or Anthropic via a single `LLM_PROFILE` env var
- **Auth + persistence** — Google OAuth via Supabase; diagrams saved to PostgreSQL with full history, search, and reload
- **Export** — PNG screenshot or JSON schema export; JSON import for sharing diagrams
- **Generation cache** — identical prompts return cached results, reducing LLM calls and latency
- **Rate limiting** — backend throttles requests to prevent abuse

## Architecture

```
┌──────────────┐       WebSocket / HTTP        ┌──────────────┐       HTTP / SSE        ┌──────────────────┐
│   Frontend   │  ◄──────────────────────────►  │   Backend    │  ◄──────────────────►   │   Agent (Python)  │
│  React + Vite│       Socket.io + REST         │  Express.js  │     FastAPI streaming   │   LangGraph ReAct │
│  React Flow  │                                │  Socket.io   │                         │   LLM tool calls  │
└──────┬───────┘                                └──────┬───────┘                         └──────────┬────────┘
       │                                               │                                           │
       └───────────────────────┬───────────────────────┘                                           │
                               │                                                                   │
                        ┌──────▼───────┐                                              ┌────────────▼──────┐
                        │   Supabase   │                                              │   LLM Provider    │
                        │  PostgreSQL  │                                              │ Ollama / OpenAI / │
                        │  + Auth      │                                              │ Anthropic         │
                        └──────────────┘                                              └───────────────────┘
```

| Layer | Stack |
|---|---|
| Frontend | React 19 + Vite 8 + React Flow 12 + Zustand 5 + Tailwind CSS 4 + TypeScript 5.9 |
| Backend (API Gateway) | Node.js 22 + Express 5 + Socket.io 4 + TypeScript 6 |
| Agent (AI Microservice) | Python 3.12 + FastAPI 0.135 + LangGraph + Pydantic 2.12 |
| Database & Auth | Supabase (PostgreSQL 16 + Google OAuth) |

## Requirements

| Dependency | Minimum version |
|---|---|
| Node.js | 22.x |
| npm | 10.x |
| Python | 3.12+ |
| pip | 23+ |
| Supabase CLI | latest ([install](https://supabase.com/docs/guides/cli/getting-started)) |
| Ollama (local LLM) | latest ([install](https://ollama.com/)) — only if using `LLM_PROFILE=local` |

## Installation

### 1. Clone the repository

```bash
git clone https://gitlab.com/HP-SCDS/Observatorio/2025-2026/mydiagram/usc-mydiagram.git
cd usc-mydiagram
```

### 2. Set up the database (Supabase)

```bash
supabase start
supabase db reset    # applies all migrations from supabase/migrations/
```

Note the `API URL`, `anon key`, and `service_role key` from the output.

### 3. Configure environment variables

**Backend** — create `backend/.env`:

```env
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<service_role key from step 2>
SUPABASE_JWT_SECRET=<jwt secret from supabase start output>
PORT=3001
AGENT_URL=http://localhost:8000
```

**Agent** — copy and edit `agent/.env`:

```bash
cp agent/.env.example agent/.env
```

```env
LLM_PROFILE=local              # or "openai" for production
OLLAMA_URL=http://localhost:11434/api/chat
OLLAMA_MODEL_FAST=qwen3:8b
OLLAMA_MODEL_CAPABLE=qwen3:8b
# For OpenAI: set OPENAI_API_KEY, OPENAI_MODEL_FAST, OPENAI_MODEL_CAPABLE
```

**Frontend** — create `frontend/.env`:

```env
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<anon key from step 2>
VITE_WS_URL=http://localhost:3001
```

### 4. Install dependencies

```bash
# Frontend
cd frontend && npm install && cd ..

# Backend
cd backend && npm install && cd ..

# Agent
cd agent && pip install -r requirements.txt && cd ..
```

### 5. Pull the local LLM model (if using Ollama)

```bash
ollama pull qwen3:8b
```

### 6. Start all three services

Open three terminal windows:

```bash
# Terminal 1 — Agent (Python)
cd agent && uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2 — Backend (Node.js)
cd backend && npm run dev

# Terminal 3 — Frontend (Vite)
cd frontend && npm run dev
```

The app will be available at `http://localhost:5173`.

## Usage

### Generate a diagram from natural language

Type a prompt in the floating input at the bottom of the canvas:

```
Diseña un diagrama entidad-relación para una tienda online con usuarios,
productos, pedidos y reseñas.
```

The agent will:
1. Classify the diagram type (or use your manual selection from the top bar)
2. Extract nodes and edges via LLM tool calls (streamed in the tool tray)
3. Validate the schema
4. Render the diagram on the canvas

### Refine an existing diagram

With a diagram loaded, type a follow-up:

```
Añade una entidad "Categoría" con relación muchos-a-muchos con Producto.
```

### Select a diagram type manually

Click one of the type cards in the top bar (ERD, UML Class, Sequence, Flowchart, Architecture, State Machine, Mindmap) before sending your prompt. Select "Auto" to let the agent decide.

### Export and import

Use the export menu (top-right) to:
- **Export PNG** — screenshot of the current canvas
- **Export JSON** — full diagram schema (nodes, edges, types)
- **Import JSON** — load a previously exported diagram

### Run tests

```bash
# Frontend (Vitest + jsdom)
cd frontend && npm test

# Backend (Vitest + supertest)
cd backend && npm test

# Agent (pytest)
cd agent && pytest
```

### Production build

```bash
cd frontend && npm run build    # outputs to frontend/dist/
cd backend && npm run build     # compiles to backend/dist/
```

## Project structure

```
usc-mydiagram/
├── frontend/                          # React SPA
│   ├── src/
│   │   ├── components/
│   │   │   ├── App.tsx                # Root layout — 3-column CSS grid
│   │   │   ├── TopBar.tsx             # Navigation bar with type cards, theme toggle, auth
│   │   │   ├── EditToolbar.tsx        # Left toolbar — add node/edge, undo/redo, zoom
│   │   │   ├── DiagramCanvas.tsx      # React Flow canvas with all node/edge types
│   │   │   ├── FloatingPrompt.tsx     # Chat input overlay — auto-resize, 3 modes
│   │   │   ├── ChatPanel.tsx          # Message history panel (right column)
│   │   │   ├── ChatMessage.tsx        # Individual message bubble
│   │   │   ├── ToolTray.tsx           # Collapsible agent tool trace viewer
│   │   │   ├── HistoryDrawer.tsx      # Slide-out drawer with diagram history + search
│   │   │   ├── DiagramTypeCards.tsx   # Horizontal type selector cards
│   │   │   ├── ExportMenu.tsx         # Export PNG/JSON, import, save, regenerate
│   │   │   ├── AuthButton.tsx         # Google OAuth login/logout
│   │   │   ├── NodePropertiesPanel.tsx# Floating panel for editing selected node
│   │   │   ├── nodes/                 # Custom React Flow node components
│   │   │   │   ├── TableNode.tsx      # ERD table with PK/FK markers
│   │   │   │   ├── UmlClassNode.tsx   # UML class (attrs/methods bands)
│   │   │   │   ├── C4Node.tsx         # C4 model (person/system/container/component)
│   │   │   │   ├── ArchitectureNode.tsx # DB/queue/gateway/service shapes
│   │   │   │   ├── FlowNode.tsx       # Flowchart (step/decision/terminator)
│   │   │   │   ├── StateNode.tsx      # State machine states
│   │   │   │   ├── MindmapNode.tsx    # Mindmap topic nodes
│   │   │   │   ├── SequenceActorNode.tsx # Sequence diagram participants
│   │   │   │   ├── LifelineNode.tsx   # Vertical dashed lifelines
│   │   │   │   └── ActivationNode.tsx # Activation bars on lifelines
│   │   │   └── edges/
│   │   │       └── SequenceMessageEdge.tsx # Horizontal sequence messages
│   │   ├── store/
│   │   │   ├── index.ts               # Main Zustand store (diagram state, UI state)
│   │   │   ├── auth.ts                # Authentication store (Supabase session)
│   │   │   ├── ui.ts                  # UI-only state (drawer, theme, tool tray)
│   │   │   ├── history.ts             # Undo/redo stack (session-scoped)
│   │   │   └── historyManager.ts      # Auto-capture snapshots on diagram change
│   │   ├── hooks/
│   │   │   ├── useWebSocket.ts        # Socket.io connection + message handling
│   │   │   └── useAuth.ts             # Supabase auth session hook
│   │   ├── ui/
│   │   │   ├── primitives/            # Reusable neobrutalist components
│   │   │   │   ├── Button.tsx         # Primary/secondary/danger button
│   │   │   │   ├── IconButton.tsx     # Square icon button with tooltip
│   │   │   │   ├── Card.tsx           # Bordered container
│   │   │   │   ├── Panel.tsx          # Floating panel
│   │   │   │   ├── Drawer.tsx         # Slide-in overlay
│   │   │   │   ├── Menu.tsx           # Dropdown menu
│   │   │   │   ├── Badge.tsx          # Status/type badge
│   │   │   │   └── Tooltip.tsx        # Tooltip popup
│   │   │   └── utils/
│   │   │       ├── diagramToFlow.ts   # Schema → React Flow nodes/edges + layout
│   │   │       └── sequenceLayout.ts  # Sequence diagram layout engine
│   │   ├── lib/
│   │   │   └── api.ts                 # Supabase REST client (CRUD operations)
│   │   ├── types.ts                   # Zod schemas + TypeScript types
│   │   ├── index.css                  # Tailwind v4 + neobrutalist design tokens
│   │   └── main.tsx                   # Entry point
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
├── backend/                           # API Gateway
│   └── src/
│       ├── index.ts                   # Express + Socket.io server (port 3001)
│       ├── diagrams.ts                # Diagram CRUD endpoints
│       ├── socketHandlers.ts          # WebSocket handlers — relay agent streams
│       ├── agentStream.ts             # HTTP/SSE client for agent microservice
│       ├── auth.ts                    # JWT verification middleware
│       ├── socketAuth.ts              # WebSocket authentication
│       ├── cache.ts                   # Generation cache (DB-backed)
│       ├── rateLimit.ts               # Request rate limiter
│       └── supabase.ts                # Supabase client singleton
├── agent/                             # AI Microservice
│   ├── main.py                        # FastAPI app (/generate/stream, /refine/stream)
│   ├── graph.py                       # LangGraph graph definition
│   ├── agent_graph.py                 # ReAct agent workflow
│   ├── llm.py                         # LLM provider abstraction (Ollama/OpenAI/Anthropic)
│   ├── prompts.py                     # Structured system + tool prompts
│   ├── schemas.py                     # Pydantic models for diagram validation
│   ├── nodes/                         # LangGraph agent nodes
│   │   ├── classify.py                # Diagram type classification
│   │   ├── extract_nodes.py           # Node extraction via LLM tool calls
│   │   ├── extract_edges.py           # Edge extraction via LLM tool calls
│   │   ├── validate_nodes.py          # Node schema validation
│   │   ├── validate_edges.py          # Edge schema validation
│   │   ├── validate_schema.py         # Full diagram schema validation
│   │   ├── synthesize.py              # Final diagram assembly
│   │   └── guard.py                   # Safety guardrails
│   ├── tests/                         # pytest test suite (14 files)
│   └── requirements.txt
├── supabase/
│   ├── config.toml                    # Local Supabase configuration
│   └── migrations/                    # SQL migrations (diagrams table, cache)
├── scripts/
│   └── test_tools_e2e.sh              # End-to-end integration test script
├── docs/                              # Technical documentation
└── LICENSE                            # MIT
```

## Contributing

1. Fork the repository on GitLab
2. Create a feature branch from `main`:
   ```bash
   git checkout -b feature/your-feature
   ```
3. Make your changes, ensuring:
   - `npm test` passes in both `frontend/` and `backend/`
   - `pytest` passes in `agent/`
   - `cd frontend && npm run build` compiles without errors
   - `cd frontend && npm run lint` reports no errors
4. Commit with a [Conventional Commits](https://www.conventionalcommits.org/) message:
   ```bash
   git commit -m "feat(frontend): add node grouping support"
   ```
5. Push and open a Merge Request against `main`

### Hard constraints (do not break)

- Do not rename or remove fields/actions in `store/index.ts` or `store/auth.ts`
- Do not change socket event names or payloads in `hooks/useWebSocket.ts`
- Do not modify enum values in `DiagramType`, `NodeType`, `EdgeType`, or Zod schemas in `types.ts`
- Do not change REST endpoint signatures in `lib/api.ts`

## License

[MIT](LICENSE) &copy; 2025 Observatorio HP SCDS
