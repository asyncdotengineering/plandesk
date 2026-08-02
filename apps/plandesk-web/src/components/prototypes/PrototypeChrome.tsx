import { ShareButton } from '@/components/share/ShareButton';
import { CANVAS_MODES, modeLabel, type CanvasMode } from './canvas-mode.js';
import { useCanvasMode } from './CanvasModeContext.js';

/**
 * Prototype canvas chrome: name, mode selector (always visible), share.
 * Mode lives here so a person can always see which gesture layer is active.
 */
export function PrototypeChrome({ prototypeId, name }: { prototypeId: string; name: string }) {
  const { mode, setMode } = useCanvasMode();

  return (
    <header
      data-prototype-chrome
      data-canvas-mode={mode}
      className="flex items-center justify-between gap-3 border-b border-border px-4 py-2"
    >
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="truncate text-sm font-semibold tracking-tight">{name}</h1>
        <div
          role="radiogroup"
          aria-label="Canvas mode"
          data-mode-selector
          className="flex shrink-0 overflow-hidden rounded-md border border-border"
        >
          {CANVAS_MODES.map((option) => (
            <ModeButton key={option} mode={option} selected={mode === option} onSelect={setMode} />
          ))}
        </div>
      </div>
      <ShareButton resource={{ kind: 'prototype', id: prototypeId }} />
    </header>
  );
}

function ModeButton({
  mode,
  selected,
  onSelect,
}: {
  mode: CanvasMode;
  selected: boolean;
  onSelect: (mode: CanvasMode) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-mode={mode}
      data-mode-selected={selected ? 'true' : 'false'}
      className={
        selected
          ? 'bg-foreground px-2.5 py-1 text-xs font-medium text-background'
          : 'bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground'
      }
      onClick={() => {
        onSelect(mode);
      }}
    >
      {modeLabel(mode)}
    </button>
  );
}
