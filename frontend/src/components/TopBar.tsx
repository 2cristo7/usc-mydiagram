import { Menu as MenuIcon } from 'lucide-react'
import { IconButton } from '../ui/primitives'
import { useUiStore } from '../store/ui'
import { DiagramTypeCards } from './DiagramTypeCards'
import { ExportMenu } from './ExportMenu'
import { AuthButton } from './AuthButton'

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
      <div className="flex-1 min-w-0 overflow-hidden">
        <DiagramTypeCards />
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <ExportMenu onRegenerate={onRegenerate} />
        <AuthButton />
      </div>
    </div>
  )
}
