# Documentación técnica de MydIAgram (sitio web)

Sitio HTML estático que documenta el **proyecto MydIAgram**: su arquitectura, el
motor de generación de diagramas, el modelo de datos y sus funcionalidades. Es
documentación *del producto y del sistema*, no del proceso de desarrollo.

## Cómo verlo

Las páginas son autocontenidas y usan rutas relativas: abre `index.html` con doble
clic en el navegador, o sírvelo como estático (por ejemplo con GitHub Pages
apuntando a esta carpeta, o `python3 -m http.server` desde aquí).

No forma parte del *build* de la aplicación ni se sirve desde ella; vive en el
repositorio como documentación.

## Páginas

| Archivo | Contenido |
|---|---|
| `index.html` | Portada: mapa del sistema y acceso a todas las secciones |
| `arquitectura.html` | Los 3 procesos independientes, su comunicación y el flujo E2E |
| `despliegue.html` | Arranque en desarrollo, Docker Compose, variables de entorno y perfiles de LLM |
| `langgraph-generacion.html` | Grafo de generación (pipeline de nodos + bucles de reintento) |
| `langgraph-refinamiento.html` | Grafo de refinamiento (loop ReAct + herramientas) |
| `modelo-datos.html` | Contratos schema-first (Pydantic ↔ Zod) y validación en 3 niveles |
| `features.html` | Catálogo de funcionalidades: 6 tipos de diagrama, edición, exportación… |
| `layouts.html` | Cómo se posiciona cada tipo de diagrama |
| `decisiones.html` | Decisiones de diseño cerradas con su porqué |

## Estilo

Todas las páginas comparten `assets/docs.css` (sistema visual neobrutalista alineado
con el frontend de la app). Las normas de estilo están en [`design.md`](design.md).

El contenido está fundamentado en el código fuente del proyecto (`usc-mydiagram/`).
