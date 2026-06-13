import { create } from 'zustand'

type Theme = 'light' | 'dark'

interface UiStore {
  drawerOpen: boolean
  setDrawerOpen: (open: boolean) => void
  toggleDrawer: () => void
  toolTrayExpanded: boolean
  setToolTrayExpanded: (v: boolean) => void
  theme: Theme
  toggleTheme: () => void
}

function getInitialTheme(): Theme {
  try {
    return (localStorage.getItem('theme') as Theme) || 'light'
  } catch {
    return 'light'
  }
}

function applyTheme(theme: Theme) {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}

export const useUiStore = create<UiStore>((set) => {
  const initial = getInitialTheme()
  applyTheme(initial)

  return {
    drawerOpen: false,
    setDrawerOpen: (open) => set({ drawerOpen: open }),
    toggleDrawer: () => set((s) => ({ drawerOpen: !s.drawerOpen })),
    toolTrayExpanded: false,
    setToolTrayExpanded: (v) => set({ toolTrayExpanded: v }),
    theme: initial,
    toggleTheme: () =>
      set((s) => {
        const next: Theme = s.theme === 'light' ? 'dark' : 'light'
        try { localStorage.setItem('theme', next) } catch { /* SSR/test */ }
        applyTheme(next)
        return { theme: next }
      }),
  }
})
