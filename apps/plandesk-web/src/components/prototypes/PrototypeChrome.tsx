import { ShareButton } from '@/components/share/ShareButton';
import type { FlowCoverage } from '@/lib/api.js';
import { CANVAS_MODES, modeLabel, type CanvasMode } from './canvas-mode.js';
import { useCanvasMode } from './CanvasModeContext.js';

/**
 * Prototype canvas chrome: name, coverage line, mode selector, share.
 */
export function PrototypeChrome({
  prototypeId,
  name,
  coverage,
  readOnly = false,
  modes = CANVAS_MODES,
}: {
  prototypeId: string;
  name: string;
  coverage?: FlowCoverage;
  readOnly?: boolean;
  modes?: readonly CanvasMode[];
}) {
  const { mode, setMode } = useCanvasMode();

  return (
    <header
      data-prototype-chrome
      data-canvas-mode={mode}
      className="flex items-center justify-between gap-3 border-b border-border px-4 py-2"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="truncate text-sm font-semibold tracking-tight">{name}</h1>
          <div
            role="radiogroup"
            aria-label="Canvas mode"
            data-mode-selector
            className="flex shrink-0 overflow-hidden rounded-md border border-border"
          >
            {modes.map((option) => (
              <ModeButton
                key={option}
                mode={option}
                selected={mode === option}
                onSelect={setMode}
              />
            ))}
          </div>
        </div>
        {coverage !== undefined ? <CoverageLine coverage={coverage} /> : null}
      </div>
      {readOnly ? null : <ShareButton resource={{ kind: 'prototype', id: prototypeId }} />}
    </header>
  );
}

function CoverageLine({ coverage }: { coverage: FlowCoverage }) {
  if (!coverage.parseable) {
    return (
      <p data-coverage-line data-coverage-parseable="false" className="text-[11px] text-amber-700">
        Flow coverage: unparseable — {coverage.parse_error ?? 'unknown'}
      </p>
    );
  }
  const missing =
    coverage.missing.length > 0 ? `missing ${coverage.missing.join(', ')}` : 'none missing';
  const unplanned =
    coverage.unplanned.length > 0 ? ` · unplanned ${coverage.unplanned.join(', ')}` : '';
  return (
    <p
      data-coverage-line
      data-coverage-parseable="true"
      className="text-[11px] text-muted-foreground"
    >
      Coverage: {coverage.built.length}/{coverage.planned.length} planned · {missing}
      {unplanned}
    </p>
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
