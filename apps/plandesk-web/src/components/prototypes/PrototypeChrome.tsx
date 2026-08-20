import { useState, type ReactNode } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { ShareButton } from '@/components/share/ShareButton';
import type { FlowCoverage } from '@/lib/api.js';
import { CANVAS_MODES, modeLabel, type CanvasMode } from './canvas-mode.js';
import { useCanvasMode } from './CanvasModeContext.js';

const CLUSTER = 'rounded-xl border border-border bg-card/85 shadow-sm backdrop-blur-md';

/**
 * Prototype canvas chrome: back link, name, mode selector, coverage, share.
 *
 * The bar floats over the canvas rather than sitting above it. A canvas is a
 * document surface — every row of fixed chrome is area the artwork loses, and
 * the shell's own sidebar and breadcrumb are already gone on this route (see
 * `isCanvasPath` in __root.tsx). The back link carries the way out that the
 * breadcrumb used to.
 */
export function PrototypeChrome({
  prototypeId,
  name,
  coverage,
  readOnly = false,
  modes = CANVAS_MODES,
  backSlot,
}: {
  prototypeId: string;
  name: string;
  coverage?: FlowCoverage;
  readOnly?: boolean;
  modes?: readonly CanvasMode[];
  backSlot?: ReactNode;
}) {
  const { mode, setMode } = useCanvasMode();
  const showTrailing = coverage !== undefined || !readOnly;

  return (
    <header
      data-prototype-chrome
      data-canvas-mode={mode}
      className="pointer-events-none absolute inset-x-0 top-0 z-20 p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className={`pointer-events-auto flex min-w-0 items-center gap-1.5 py-1 pr-3 pl-1 ${CLUSTER}`}
        >
          {backSlot}
          {backSlot !== undefined ? (
            <span aria-hidden className="text-muted-foreground/50">
              /
            </span>
          ) : null}
          <h1 className="truncate text-[13px] font-semibold tracking-tight">{name}</h1>
        </div>

        {showTrailing ? (
          <div className={`pointer-events-auto flex shrink-0 items-center gap-1 p-1 ${CLUSTER}`}>
            {coverage !== undefined ? <CoverageBadge coverage={coverage} /> : null}
            {readOnly ? null : <ShareButton resource={{ kind: 'prototype', id: prototypeId }} />}
          </div>
        ) : null}
      </div>

      <div
        role="radiogroup"
        aria-label="Canvas mode"
        data-mode-selector
        className={`pointer-events-auto absolute top-3 left-1/2 flex -translate-x-1/2 gap-0.5 p-1 ${CLUSTER}`}
      >
        {modes.map((option) => (
          <ModeButton key={option} mode={option} selected={mode === option} onSelect={setMode} />
        ))}
      </div>
    </header>
  );
}

/**
 * `built/planned` reads as a broken fraction when the flow document plans
 * nothing — "4/0" claims four of zero. Count the screens instead.
 */
export function coverageLabel(coverage: FlowCoverage): string {
  if (!coverage.parseable) {
    return 'Flow unparseable';
  }
  if (coverage.planned.length === 0) {
    return `${String(coverage.built.length)} screens`;
  }
  return `${String(coverage.built.length)}/${String(coverage.planned.length)}`;
}

function isCoverageClean(coverage: FlowCoverage): boolean {
  return coverage.parseable && coverage.missing.length === 0 && coverage.unplanned.length === 0;
}

/**
 * Coverage collapses to a badge. The full line ran to a paragraph of screen
 * titles across the header — a status nobody reads is a status that costs space.
 */
function CoverageBadge({ coverage }: { coverage: FlowCoverage }) {
  const [open, setOpen] = useState(false);
  const clean = isCoverageClean(coverage);

  return (
    <div className="relative">
      <button
        type="button"
        data-coverage-badge
        data-coverage-parseable={coverage.parseable ? 'true' : 'false'}
        data-coverage-clean={clean ? 'true' : 'false'}
        aria-expanded={open}
        aria-label="Flow coverage"
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={() => {
          setOpen((previous) => !previous);
        }}
      >
        <span
          aria-hidden
          className={
            clean ? 'size-1.5 rounded-full bg-emerald-500' : 'size-1.5 rounded-full bg-amber-500'
          }
        />
        {coverageLabel(coverage)}
        <ChevronDownIcon className="size-3 opacity-60" />
      </button>
      {open ? (
        <>
          <div
            aria-hidden
            className="fixed inset-0 z-10"
            onClick={() => {
              setOpen(false);
            }}
          />
          <div
            data-coverage-detail
            className="absolute top-full right-0 z-20 mt-2 w-72 rounded-xl border border-border bg-card p-3 text-[12px] shadow-lg"
          >
            <CoverageDetail coverage={coverage} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function CoverageDetail({ coverage }: { coverage: FlowCoverage }) {
  if (!coverage.parseable) {
    return (
      <p className="text-amber-700">
        Flow coverage: unparseable — {coverage.parse_error ?? 'unknown'}
      </p>
    );
  }
  return (
    <dl className="grid gap-2">
      <CoverageRow
        label="Built"
        value={`${String(coverage.built.length)} of ${String(coverage.planned.length)} planned`}
      />
      <CoverageRow
        label="Missing"
        value={coverage.missing.length > 0 ? coverage.missing.join(', ') : 'none missing'}
      />
      <CoverageRow
        label="Unplanned"
        value={coverage.unplanned.length > 0 ? coverage.unplanned.join(', ') : 'none'}
      />
    </dl>
  );
}

function CoverageRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5rem_1fr] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
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
          ? 'rounded-lg bg-foreground px-3 py-1 text-xs font-medium text-background'
          : 'rounded-lg px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground'
      }
      onClick={() => {
        onSelect(mode);
      }}
    >
      {modeLabel(mode)}
    </button>
  );
}
