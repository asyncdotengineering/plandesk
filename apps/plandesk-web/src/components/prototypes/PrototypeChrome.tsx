import { ShareButton } from '@/components/share/ShareButton';

/**
 * Minimal chrome for a prototype canvas: name + share action.
 * The full canvas route is owned by a later task; this is the share surface
 * that chrome mounts so a person can share without leaving the flow.
 */
export function PrototypeChrome({ prototypeId, name }: { prototypeId: string; name: string }) {
  return (
    <header
      data-prototype-chrome
      className="flex items-center justify-between gap-3 border-b border-border px-4 py-2"
    >
      <h1 className="truncate text-sm font-semibold tracking-tight">{name}</h1>
      <ShareButton resource={{ kind: 'prototype', id: prototypeId }} />
    </header>
  );
}
