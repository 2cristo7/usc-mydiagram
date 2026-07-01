# Sistema de diseño — Documentación web de MydIAgram

Normas de estilo para **toda** la documentación HTML que viva en `docs/web/`.
El objetivo: que cualquier documento generado aquí herede el mismo lenguaje visual
**neobrutalista** del frontend de la app, sin que haya que volver a explicarlo.

> **Fuente de verdad**: el tema del frontend en
> `usc-mydiagram/frontend/src/index.css` (bloque `@theme`) y las primitivas en
> `usc-mydiagram/frontend/src/ui/primitives/` (`Card`, `Button`, `Badge`…).
> Si la app cambia su paleta o sus tokens, este documento se actualiza para seguirla.

---

## 0. Regla de oro — la documentación es VISUAL

Esto no es un wiki de texto plano. Cuando se pida documentar algo, el resultado por
defecto es una **página HTML con estilo**, no un `.md` ni un volcado de párrafos.

- Si el tema admite **diagrama, esquema, flujo, tabla comparativa, línea de tiempo,
  arquitectura de cajas, jerarquía…**, hay que dibujarlo. Preferir **SVG inline**
  (o HTML/CSS con cajas y flechas) sobre describirlo con palabras.
- Todo diagrama lleva el mismo estilo brutalista: cajas con borde negro de 3px,
  sombra dura, color de acento por categoría, tipografía mono en las etiquetas.
- Texto y figura conviven: el texto explica, la figura muestra. Una sección densa
  sin ningún apoyo visual es una señal de que falta trabajo.
- **Seriedad sin aburrimiento**: es documentación académica/técnica de un TFG. El
  estilo es llamativo y cuidado, pero la información manda — nada de chartjunk,
  emojis decorativos sueltos ni adornos que no comuniquen (criterio Tufte).

Plantilla de referencia viva: **`docs/web/index.html`**. Al crear un documento nuevo,
partir de su `<head>`/`<style>` (cópialos tal cual) y rellenar el contenido.

---

## 1. Tokens (copiar este `:root` en cada documento)

```css
:root{
  --bg:#f5f0e8;          /* fondo crema */
  --surface:#ffffff;     /* tarjetas */
  --ink:#111111;         /* negro estructural: texto, bordes, sombras */
  --ink-soft:#33312c;
  --muted:#75716a;
  --line:#e2dccf;        /* línea interna suave */
  --accent:#ff5c00;      /* naranja — color primario de marca */
  --accent-soft:#ffe7d6;
  --accent-ink:#b83f00;  /* naranja oscuro para texto/enlaces */
  --ok:#16a34a;          --ok-soft:#d8f3e1;     /* decisión / éxito */
  --warn:#b07c00;        --warn-soft:#fdf0b8;   /* aviso / tensión */
  --blue:#2563eb;        --blue-soft:#dbe6ff;   /* categoría secundaria */
  --code-bg:#f3eee4;
  --shadow:4px 4px 0 0 var(--ink);     /* sombra dura, SIN blur */
  --shadow-lg:6px 6px 0 0 var(--ink);
  --radius:4px;
  --font:"Space Grotesk",system-ui,sans-serif;
  --mono:"JetBrains Mono",ui-monospace,monospace;
}
```

Fuentes vía Google Fonts en el `<head>`:

```html
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

---

## 2. Principios visuales

| Principio | Cómo se aplica |
|---|---|
| **Bordes negros gruesos** | 3px en elementos estructurales (cards, tablas, sidebar), 2px en chips/botones pequeños |
| **Sombras duras** | `Npx Npx 0 0 #111` — desplazamiento sólido, **nunca** blur ni opacidad |
| **Esquinas casi rectas** | `--radius: 4px`. Nada de cards muy redondeadas |
| **Acento con mesura** | Naranja para marca/CTA; verde=decisión, amarillo=aviso, azul=categoría neutra. No teñir todo |
| **Mono para metadatos** | Eyebrow, etiquetas de sección, tags, `.lab`, encabezados de tabla → JetBrains Mono mayúsculas |
| **Microinteracción brutalista** | Al hover, los elementos accionables hacen `translate(-1px,-1px)` y **crecen** la sombra; al `active`, se hunden (`translate(2px,2px)` + sombra a 0) |
| **Fondo crema, tarjetas blancas** | El contraste blanco-sobre-crema da profundidad sin sombras suaves |

---

## 3. Componentes (clases ya definidas en la plantilla)

- **`.card`** — contenedor blanco, borde 3px, `--shadow-lg`. Unidad básica de contenido.
- **`.pill`** — chip de metadato en la cabecera (borde 2px + sombra 3px).
- **`.tag` + `.t-blue` / `.t-green` / `.t-warn`** — etiquetas mono pequeñas para clasificar.
- **`.def`** — definición destacada: fondo `accent-soft`, borde izquierdo grueso (6px).
- **`.decision`** — callout verde para una decisión cerrada (`.lab` = badge "Decisión").
- **`.caveat`** — callout amarillo para tensiones/avisos (`.lab` = badge).
- **`table`** — cabecera negra con texto blanco mono, filas zebra, hover naranja.
- **`code`** — mono con borde 1.5px y fondo crema.
- **Nav lateral** — links que al hover/activo ganan borde + sombra; grupo en mono.
- **Badges de sección** (`.sec-head .badge`) — cuadrado 50px con icono, borde 3px + sombra.

La cabecera de página usa `.eyebrow` (chip mono amarillo), `h1` grande con
`letter-spacing` negativo y `.lede` de subtítulo.

---

## 4. Diagramas y esquemas

El núcleo de "que quede chulo". Pautas para figuras:

- **SVG inline** dentro de un `.card` (o a sangre completa con su propio borde).
- Cajas: `rect` con `stroke="#111"` `stroke-width="3"` `rx="4"`, relleno
  `--surface` o un `*-soft` según categoría, y **sombra dura simulada** con un
  `rect` gemelo desplazado 4px en negro por debajo (no hay box-shadow en SVG).
- Flechas/conectores: línea negra de 2–3px con `marker-end` triangular negro.
- Etiquetas: `font-family:"JetBrains Mono"`, tamaño pequeño, mayúsculas para roles.
- Color = significado (categoría, estado, capa), nunca decoración aleatoria.
- Para grafos/jerarquías complejas, una imagen exportada del propio editor también
  vale, pero enmarcada con borde 3px + sombra para integrarse.

Mini-ejemplo de caja con sombra dura en SVG:

```html
<svg viewBox="0 0 200 80" width="200">
  <rect x="14" y="14" width="160" height="50" rx="4" fill="#111"/>           <!-- sombra -->
  <rect x="10" y="10" width="160" height="50" rx="4" fill="#fff" stroke="#111" stroke-width="3"/>
  <text x="90" y="40" text-anchor="middle" font-family="JetBrains Mono" font-size="13" font-weight="600">NODO</text>
</svg>
```

---

## 5. Estructura y accesibilidad

- Layout estándar: **sidebar sticky** (índice navegable + scroll-spy) + columna de
  contenido centrada (`max-width ~880px`). En móvil (`<980px`) la sidebar se oculta.
- Jerarquía clara: `h1` (página) → `h2` por sección con badge → `h3` mono como
  subtítulo dentro de la card.
- Responsivo siempre; nada de anchos fijos que rompan en pantallas estrechas.
- Contraste: texto sobre fondos `*-soft` siempre en `--ink`. El acento naranja sobre
  blanco se reserva para enlaces/marca, no para párrafos largos.

---

## 6. Checklist antes de dar por hecho un documento

- [ ] Copiado el `:root` + fuentes de la plantilla; paleta coherente con el frontend.
- [ ] Bordes negros y sombras duras (sin blur) en todo elemento estructural.
- [ ] Al menos un apoyo visual (diagrama, esquema, tabla rica) si el tema lo admite.
- [ ] Etiquetas/metadatos en JetBrains Mono mayúsculas.
- [ ] Hover brutalista en elementos accionables.
- [ ] Responsivo y legible; el contenido domina, el estilo acompaña.
- [ ] Archivo dentro de `docs/web/`.
</content>
</invoke>
