# Design System Specification (Tokens)

## Color Palette (Dark Theme First)
- **Background Base:** `#0f172a` (slate-900)
- **Background Surface:** `#1e293b` (slate-800)
- **Primary Accent:** `#3b82f6` (blue-500) - For active states and buttons.
- **Text Primary:** `#f8fafc` (slate-50)
- **Text Secondary:** `#94a3b8` (slate-400)
- **Danger/Error:** `#ef4444` (red-500)
- **Success:** `#22c55e` (green-500)

## Typography
- **Font Family:** Inter, system-ui, sans-serif. Monospace for code snippets (Fira Code).
- **Base Size:** `14px` (Tailwind text-sm for denser dev UI).
- **Headers:** `1.25rem` to `1.5rem`, semi-bold.

## Spacing & Layout
- **Base Unit:** `4px` (Tailwind spacing scale).
- **Padding/Margins:** Consistent use of `0.5rem` (8px), `1rem` (16px).
- **Border Radius:** `0.5rem` (rounded-lg) for cards and inputs.

## CSS Custom Properties (Variables Concept)
```css
:root {
  --bg-base: #0f172a;
  --bg-surface: #1e293b;
  --text-main: #f8fafc;
  --text-muted: #94a3b8;
  --accent: #3b82f6;
  --border-radius: 8px;
  --spacing-base: 1rem;
}
```