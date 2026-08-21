import { Extension } from '@tiptap/core';
import type { Editor, Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type SuggestionItem = {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  // extra terms the query can match on (beyond the title)
  keywords?: string[];
  command: (props: { editor: Editor; range: Range }) => void;
};

type MenuProps = {
  items: SuggestionItem[];
  selected: number;
  onHover: (index: number) => void;
};

// Purely presentational — the extension owns selection + all interaction, since
// React synthetic events do not fire on this element (it is appended to
// document.body, outside the app's React root, so v19 event delegation misses
// it). Clicks are handled by a native listener in the extension below.
function SuggestionMenu({ items, selected, onHover }: MenuProps) {
  if (items.length === 0) {
    return (
      <div className="w-[min(16rem,calc(100vw-2rem))] rounded-lg border bg-popover p-2 text-[12.5px] text-muted-foreground shadow-lg">
        No results
      </div>
    );
  }
  return (
    <div className="max-h-72 w-[min(16rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
      {items.map((item, index) => (
        <div
          key={`${item.title}-${String(index)}`}
          data-suggestion-index={index}
          onMouseEnter={() => {
            onHover(index);
          }}
          className={cn(
            'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left',
            index === selected ? 'bg-accent' : '',
          )}
        >
          {item.icon !== undefined ? (
            <span className="flex size-6 shrink-0 items-center justify-center rounded border bg-card text-muted-foreground">
              {item.icon}
            </span>
          ) : null}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">{item.title}</span>
            {item.subtitle !== undefined ? (
              <span className="block truncate text-[11px] text-muted-foreground">
                {item.subtitle}
              </span>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}

export function createSuggestionExtension(config: {
  name: string;
  char: string;
  getItems: (query: string) => SuggestionItem[];
}): Extension {
  return Extension.create({
    name: config.name,
    addProseMirrorPlugins() {
      return [
        Suggestion<SuggestionItem, SuggestionItem>({
          editor: this.editor,
          char: config.char,
          pluginKey: new PluginKey(config.name),
          command: ({ editor, range, props }) => {
            props.command({ editor, range });
          },
          items: ({ query }) => config.getItems(query),
          render: () => {
            let component: ReactRenderer<unknown, MenuProps> | null = null;
            let wrapper: HTMLDivElement | null = null;
            const state: {
              items: SuggestionItem[];
              selected: number;
              command: ((item: SuggestionItem) => void) | null;
            } = { items: [], selected: 0, command: null };

            const rerender = () => {
              component?.updateProps({
                items: state.items,
                selected: state.selected,
                onHover: (index: number) => {
                  state.selected = index;
                  rerender();
                },
              });
            };

            const run = (index: number) => {
              const item = state.items[index];
              if (item !== undefined && state.command !== null) {
                state.command(item);
              }
            };

            const place = (rect: DOMRect | null | undefined) => {
              if (wrapper === null || rect === null || rect === undefined) {
                return;
              }
              const below = rect.bottom + 6;
              const wouldOverflow = below + 300 > window.innerHeight;
              wrapper.style.left = `${String(rect.left)}px`;
              if (wouldOverflow) {
                wrapper.style.top = 'auto';
                wrapper.style.bottom = `${String(window.innerHeight - rect.top + 6)}px`;
              } else {
                wrapper.style.bottom = 'auto';
                wrapper.style.top = `${String(below)}px`;
              }
            };

            return {
              onStart: (props: SuggestionProps<SuggestionItem, SuggestionItem>) => {
                state.items = props.items;
                state.selected = 0;
                state.command = props.command;
                component = new ReactRenderer(SuggestionMenu, {
                  props: {
                    items: state.items,
                    selected: 0,
                    onHover: (index: number) => {
                      state.selected = index;
                      rerender();
                    },
                  },
                  editor: props.editor,
                });
                wrapper = document.createElement('div');
                wrapper.style.position = 'fixed';
                wrapper.style.zIndex = '70';
                wrapper.appendChild(component.element);
                wrapper.addEventListener('mousedown', (event) => {
                  const target = (event.target as HTMLElement).closest('[data-suggestion-index]');
                  if (target === null) {
                    return;
                  }
                  // preventDefault keeps the editor focused so the command applies.
                  event.preventDefault();
                  run(Number(target.getAttribute('data-suggestion-index')));
                });
                document.body.appendChild(wrapper);
                place(props.clientRect?.());
              },
              onUpdate: (props: SuggestionProps<SuggestionItem, SuggestionItem>) => {
                state.items = props.items;
                state.command = props.command;
                if (state.selected >= props.items.length) {
                  state.selected = 0;
                }
                rerender();
                place(props.clientRect?.());
              },
              onKeyDown: (props) => {
                const key = props.event.key;
                if (key === 'Escape') {
                  wrapper?.remove();
                  return true;
                }
                if (state.items.length === 0) {
                  return false;
                }
                if (key === 'ArrowUp') {
                  state.selected = (state.selected + state.items.length - 1) % state.items.length;
                  rerender();
                  return true;
                }
                if (key === 'ArrowDown') {
                  state.selected = (state.selected + 1) % state.items.length;
                  rerender();
                  return true;
                }
                if (key === 'Enter') {
                  run(state.selected);
                  return true;
                }
                return false;
              },
              onExit: () => {
                wrapper?.remove();
                component?.destroy();
                wrapper = null;
                component = null;
              },
            };
          },
        }),
      ];
    },
  });
}
