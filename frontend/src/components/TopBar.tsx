import { Menu as MenuIcon } from 'lucide-react'
import { IconButton } from '../ui/primitives'
import { useUiStore } from '../store/ui'
import { DiagramTypeBar } from './DiagramTypeBar'
import { ExportMenu } from './ExportMenu'

interface TopBarProps {
  onRegenerate: () => void
}

export function TopBar({ onRegenerate }: TopBarProps) {
  const { toggleDrawer } = useUiStore()

  return (
    <div className="col-span-3 flex items-center gap-3 border-b-[3px] border-[var(--color-ink)] bg-[var(--color-surface)] px-3 py-2">
      <IconButton
        icon={<MenuIcon size={16} />}
        tooltip="Historial"
        onClick={toggleDrawer}
        className="shrink-0"
      />
      <div className="flex-1 min-w-0">
        <DiagramTypeBar />
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <ExportMenu onRegenerate={onRegenerate} />
      </div>
    </div>
  )
}
