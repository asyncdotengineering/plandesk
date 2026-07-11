import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import type { EditorView } from '@tiptap/pm/view';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useRouter } from '@tanstack/react-router';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { MessageSquarePlusIcon } from 'lucide-react';
import { bodyToHtml } from '../../lib/markdown.js';
import { sanitizeHtml } from '../../lib/sanitize.js';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { createDocLinkExtension, createSlashExtension } from './editor-extensions.js';
import '../docs/document-editor.css';

const COMMENT_DRAFT_HIGHLIGHT = 'comment-draft';

// Persist a highlight over the passage being commented on, using the CSS Custom
// Highlight API so it tracks the actual text (survives losing the native
// selection when the composer takes focus, and follows the text on scroll).
// No-ops where the API is unavailable (e.g. jsdom in tests).
function setDraftHighlight(range: Range | null) {
  const highlights = (
    globalThis as unknown as { CSS?: { highlights?: Map<string, unknown> } }
  ).CSS?.highlights;
  const HighlightCtor = (globalThis as unknown as { Highlight?: new (r: Range) => unknown })
    .Highlight;
  if (highlights === undefined) {
    return;
  }
  if (range === null || HighlightCtor === undefined) {
    highlights.delete(COMMENT_DRAFT_HIGHLIGHT);
    return;
  }
  highlights.set(COMMENT_DRAFT_HIGHLIGHT, new HighlightCtor(range));
}

// Bodies stored as HTML round-trip through getHTML(). Task descriptions are
// markdown the MCP reads/writes, so those save paths call getMarkdown() — HTML
// back to GFM markdown (tables/strikethrough/task-lists via the gfm plugin).
const turndownService = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
});
turndownService.use(gfm);

// marked emits <input type="checkbox"> inside <li>; TipTap needs data-type attrs.
function taskListFromMarkdownHtml(html: string): string {
  const template = window.document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll('li').forEach((li) => {
    const firstChild = li.firstElementChild;
    if (firstChild?.tagName !== 'INPUT' || firstChild.getAttribute('type') !== 'checkbox') {
      return;
    }
    const checked = firstChild.hasAttribute('checked');
    firstChild.remove();
    li.setAttribute('data-type', 'taskItem');
    li.setAttribute('data-checked', checked ? 'true' : 'false');
    const firstNode = li.firstChild;
    if (firstNode?.nodeType === Node.TEXT_NODE) {
      firstNode.textContent = (firstNode.textContent ?? '').replace(/^\s+/, '');
    }
    const parent = li.parentElement;
    if (parent?.tagName === 'UL' || parent?.tagName === 'OL') {
      parent.setAttribute('data-type', 'taskList');
    }
  });
  return template.innerHTML;
}

function renderHtml(value: string): string {
  return taskListFromMarkdownHtml(bodyToHtml(value));
}

// TipTap serializes tables with a <colgroup> and wraps every cell in a <p>.
// Both defeat turndown-plugin-gfm's GFM-table detection (it needs <tbody> as the
// table's first child and inline cell content), so tables would otherwise fall
// back to raw HTML. Normalize the markup so tables round-trip to GFM Markdown.
// Task items need the inverse: unwrap TipTap's label/div so turndown sees a
// direct-child checkbox on each <li>.
function normalizeForMarkdown(html: string): string {
  const template = window.document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll('colgroup').forEach((el) => {
    el.remove();
  });
  template.content.querySelectorAll('th, td').forEach((cell) => {
    Array.from(cell.children).forEach((child) => {
      if (child.tagName === 'P') {
        child.replaceWith(...Array.from(child.childNodes));
      }
    });
  });
  template.content.querySelectorAll('li').forEach((li) => {
    if (li.closest('ul[data-type="taskList"], ol[data-type="taskList"]') !== null) {
      return;
    }
    Array.from(li.children).forEach((child) => {
      if (child.tagName === 'P') {
        child.replaceWith(...Array.from(child.childNodes));
      }
    });
  });
  template.content.querySelectorAll('ul[data-type="taskList"] > li[data-checked]').forEach((li) => {
    const checked = li.getAttribute('data-checked') === 'true';
    Array.from(li.children).forEach((child) => {
      if (child.tagName === 'LABEL') {
        child.remove();
      }
    });
    let inlineContentHtml = '';
    const contentDiv = Array.from(li.children).find((child) => child.tagName === 'DIV');
    if (contentDiv !== undefined) {
      Array.from(contentDiv.children).forEach((child) => {
        if (child.tagName === 'P') {
          child.replaceWith(...Array.from(child.childNodes));
        }
      });
      inlineContentHtml = contentDiv.innerHTML;
      contentDiv.remove();
    } else {
      const wrapper = window.document.createElement('span');
      Array.from(li.childNodes).forEach((node) => wrapper.appendChild(node.cloneNode(true)));
      inlineContentHtml = wrapper.innerHTML;
    }
    li.removeAttribute('data-type');
    li.removeAttribute('data-checked');
    const checkbox = checked ? '<input type="checkbox" checked>' : '<input type="checkbox">';
    // No space after the checkbox: turndown-plugin-gfm's taskListItems rule already
    // emits "[x] " with a trailing space, so adding one here would double it.
    li.innerHTML = `${checkbox}${inlineContentHtml.trim()}`;
  });
  template.content
    .querySelectorAll('ul[data-type="taskList"], ol[data-type="taskList"]')
    .forEach((list) => {
      list.removeAttribute('data-type');
    });
  template.content.querySelectorAll('p').forEach((p) => {
    if (p.closest('li, td, th') !== null) {
      return;
    }
    if (p.textContent.trim() === '') {
      p.remove();
    }
  });
  return template.innerHTML;
}

function insertImageFiles(view: EditorView, files: FileList | null | undefined, pos?: number) {
  const imageType = view.state.schema.nodes.image;
  if (imageType === undefined) {
    return false;
  }
  const images = Array.from(files ?? []).filter((file) => file.type.startsWith('image/'));
  for (const file of images) {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        return;
      }
      const node = imageType.create({ src: reader.result, alt: file.name });
      const tr =
        pos === undefined
          ? view.state.tr.replaceSelectionWith(node)
          : view.state.tr.insert(Math.min(pos, view.state.doc.content.size), node);
      view.dispatch(tr);
    };
    reader.readAsDataURL(file);
  }
  return images.length > 0;
}

export type RichTextEditorMode = 'reader' | 'editor';

// Imperative handle so each surface pulls content in its own storage format on
// save: getHTML() for documents/notes (stored as HTML), getMarkdown() for task
// descriptions (stored as markdown the MCP parses).
export type RichTextEditorHandle = {
  getHTML: () => string;
  getMarkdown: () => string;
  // True only after the user has edited the content since it was last loaded.
  // Lets a caller skip a lossy Markdown re-serialization when nothing changed.
  isDirty: () => boolean;
};

type RichTextEditorProps = {
  value: string;
  mode: RichTextEditorMode;
  minHeight?: string;
  ariaLabel?: string;
  // When provided (documents today), highlighting text surfaces a floating
  // "Add comment" button that hands the selected passage up to a composer.
  onCommentOnSelection?: (passage: string) => void;
  // Preferred inline flow: highlighting text opens an in-context composer
  // anchored to the selection (which stays highlighted). On submit the comment
  // is created and appears in the rail. Takes precedence over onCommentOnSelection.
  onCreateComment?: (input: { passage: string; body: string }) => Promise<void>;
  // When set, enables the Notion-style "/" slash menu and "[[" document-link
  // suggestion. `projectId` builds the link target; `docLinks` is the searchable
  // document list (read live, so a changing set never recreates the editor).
  projectId?: string;
  docLinks?: { id: string; title: string }[];
};

export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(
  function RichTextEditor(
    {
      value,
      mode,
      minHeight = '12rem',
      ariaLabel,
      onCommentOnSelection,
      onCreateComment,
      projectId,
      docLinks,
    },
    ref,
  ) {
    const router = useRouter();
    const contentRef = useRef<HTMLDivElement>(null);
    // Tracks real user edits; reset whenever a new `value` is loaded.
    const dirtyRef = useRef(false);
    // Live getters for the "[[" doc-link suggestion so a changing document set
    // never forces the editor to be recreated.
    const docLinksRef = useRef<{ id: string; title: string }[]>(docLinks ?? []);
    const projectIdRef = useRef<string | undefined>(projectId);
    useEffect(() => {
      docLinksRef.current = docLinks ?? [];
      projectIdRef.current = projectId;
    }, [docLinks, projectId]);
    const [selectionMenu, setSelectionMenu] = useState<{
      top: number;
      left: number;
      text: string;
    } | null>(null);
    // The in-context comment composer: the captured range (for the highlight +
    // repositioning), the passage text, and its on-screen anchor.
    const draftRangeRef = useRef<Range | null>(null);
    const [commentDraft, setCommentDraft] = useState<{
      passage: string;
      top: number;
      left: number;
    } | null>(null);
    const [draftBody, setDraftBody] = useState('');
    const [draftSubmitting, setDraftSubmitting] = useState(false);

    const closeDraft = () => {
      draftRangeRef.current = null;
      setDraftHighlight(null);
      setCommentDraft(null);
      setDraftBody('');
      setDraftSubmitting(false);
    };

    const openCommentDraft = () => {
      const selection = window.getSelection();
      if (selection === null || selection.rangeCount === 0) {
        return;
      }
      const passage = selection.toString().trim();
      if (passage === '') {
        return;
      }
      const range = selection.getRangeAt(0).cloneRange();
      draftRangeRef.current = range;
      setDraftHighlight(range);
      let top = selectionMenu?.top ?? 0;
      let left = selectionMenu?.left ?? 0;
      try {
        const rect = range.getBoundingClientRect();
        top = rect.bottom;
        left = rect.left;
      } catch {
        // detached range — fall back to the button anchor
      }
      setCommentDraft({ passage, top, left });
      setDraftBody('');
      setSelectionMenu(null);
      // Drop the native selection; the CSS highlight keeps the passage marked
      // so it stays visible once the composer takes focus.
      selection.removeAllRanges();
    };

    const submitDraft = async () => {
      if (onCreateComment === undefined || commentDraft === null) {
        return;
      }
      const body = draftBody.trim();
      if (body === '') {
        return;
      }
      setDraftSubmitting(true);
      try {
        await onCreateComment({ passage: commentDraft.passage, body });
        closeDraft();
      } catch {
        setDraftSubmitting(false);
      }
    };

    const extensions = useMemo(() => {
      const base = [
        // openOnClick:false — links (incl. doc links) never navigate from inside
        // the editable surface; reader-mode navigation is handled on click below.
        StarterKit.configure({ link: { openOnClick: false } }),
        Image.configure({ allowBase64: true }),
        TableKit,
        TaskList,
        TaskItem.configure({ nested: true }),
      ];
      if (projectId !== undefined) {
        base.push(createSlashExtension());
        base.push(
          createDocLinkExtension({
            getDocs: () => docLinksRef.current,
            getProjectId: () => projectIdRef.current,
          }),
        );
      }
      return base;
      // projectId presence is stable per mount; the doc set is read live via refs.
    }, [projectId]);

    const editor = useEditor({
      extensions,
      content: renderHtml(value),
      editable: mode === 'editor',
      onUpdate: () => {
        dirtyRef.current = true;
      },
      editorProps: {
        attributes: {
          class: 'document-editor-content',
          ...(ariaLabel !== undefined ? { 'aria-label': ariaLabel } : {}),
        },
        handlePaste: (view, event) => insertImageFiles(view, event.clipboardData?.files),
        handleDrop: (view, event, _slice, moved) => {
          if (moved) {
            return false;
          }
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          return insertImageFiles(view, event.dataTransfer?.files, pos);
        },
      },
    });

    useImperativeHandle(
      ref,
      () => ({
        getHTML: () => editor.getHTML(),
        getMarkdown: () => turndownService.turndown(normalizeForMarkdown(editor.getHTML())),
        isDirty: () => dirtyRef.current,
      }),
      [editor],
    );

    useEffect(() => {
      editor.setEditable(mode === 'editor');
      // Toggling editable (e.g. read-first Edit) is not a user edit — keep the
      // dirty flag clean so a no-op Edit→Save never re-serializes (and thereby
      // corrupts, via the lossy round-trip) agent-authored Markdown.
      dirtyRef.current = false;
    }, [editor, mode]);

    useEffect(() => {
      // A freshly loaded value is not a user edit.
      dirtyRef.current = false;
      const current = editor.getHTML();
      const next = renderHtml(value);
      if (current !== next) {
        editor.commands.setContent(next, { emitUpdate: false });
      }
    }, [editor, value]);

    // DOM-selection based so it works in both reader and editor mode; `window`
    // avoids the `document` global shadow. Best-effort positioning
    // (getBoundingClientRect can throw on a detached range under jsdom).
    useEffect(() => {
      if (onCommentOnSelection === undefined && onCreateComment === undefined) {
        return;
      }
      const container = contentRef.current;
      if (container === null) {
        return;
      }
      const showForSelection = () => {
        const selection = window.getSelection();
        const text = selection?.toString().trim() ?? '';
        if (selection === null || selection.rangeCount === 0 || text === '') {
          setSelectionMenu(null);
          return;
        }
        const anchor = selection.anchorNode;
        if (anchor !== null && !container.contains(anchor)) {
          setSelectionMenu(null);
          return;
        }
        let top = 0;
        let left = 0;
        try {
          const rect = selection.getRangeAt(0).getBoundingClientRect();
          top = rect.top;
          left = rect.left + rect.width / 2;
        } catch {
          // detached range
        }
        setSelectionMenu({ top, left, text });
      };
      const clearSelection = () => {
        setSelectionMenu(null);
      };
      container.addEventListener('mouseup', showForSelection);
      container.addEventListener('mousedown', clearSelection);
      return () => {
        container.removeEventListener('mouseup', showForSelection);
        container.removeEventListener('mousedown', clearSelection);
      };
    }, [onCommentOnSelection, onCreateComment]);

    // While the inline composer is open, keep it anchored to the highlighted
    // passage as the document column scrolls or the window resizes.
    useEffect(() => {
      if (commentDraft === null) {
        return;
      }
      const reposition = () => {
        const range = draftRangeRef.current;
        if (range === null) {
          return;
        }
        try {
          const rect = range.getBoundingClientRect();
          setCommentDraft((current) =>
            current === null ? current : { ...current, top: rect.bottom, left: rect.left },
          );
        } catch {
          // detached range
        }
      };
      window.addEventListener('scroll', reposition, true);
      window.addEventListener('resize', reposition);
      return () => {
        window.removeEventListener('scroll', reposition, true);
        window.removeEventListener('resize', reposition);
      };
    }, [commentDraft]);

    // Clear any lingering highlight if the editor unmounts mid-draft.
    useEffect(
      () => () => {
        setDraftHighlight(null);
      },
      [],
    );

    return (
      <div>
        {mode === 'editor' ? <RichTextToolbar editor={editor} /> : null}

        <div ref={contentRef}>
          {mode === 'reader' ? (
            <div
              className="document-reader-content"
              aria-label={ariaLabel}
              // Doc links are stored as internal <a href="/projects/…">; intercept
              // clicks so they navigate in-app (SPA) instead of a full reload.
              onClick={(event) => {
                const anchor = (event.target as HTMLElement).closest('a');
                const href = anchor?.getAttribute('href');
                if (href !== null && href !== undefined && href.startsWith('/')) {
                  event.preventDefault();
                  void router.navigate({ to: href });
                }
              }}
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(renderHtml(value)) }}
              style={{
                lineHeight: 1.6,
                padding: '1rem',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                minHeight,
              }}
            />
          ) : (
            <div
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: '0.75rem 1rem',
                minHeight,
              }}
            >
              <EditorContent editor={editor} />
            </div>
          )}
        </div>

        {selectionMenu !== null &&
        commentDraft === null &&
        (onCreateComment !== undefined || onCommentOnSelection !== undefined) ? (
          <div
            style={{
              position: 'fixed',
              top: Math.max(selectionMenu.top - 46, 8),
              left: selectionMenu.left,
              transform: 'translateX(-50%)',
              zIndex: 50,
            }}
          >
            <Button
              type="button"
              size="sm"
              className="shadow-md"
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                if (onCreateComment !== undefined) {
                  openCommentDraft();
                  return;
                }
                onCommentOnSelection?.(selectionMenu.text);
                setSelectionMenu(null);
                window.getSelection()?.removeAllRanges();
              }}
            >
              <MessageSquarePlusIcon className="size-3.5" /> Add comment
            </Button>
          </div>
        ) : null}

        {commentDraft !== null && onCreateComment !== undefined ? (
          <div
            role="dialog"
            aria-label="Add comment"
            className="w-80 rounded-lg border bg-popover p-2.5 text-popover-foreground shadow-lg"
            style={{
              position: 'fixed',
              top: commentDraft.top + 8,
              left: commentDraft.left,
              maxWidth: 'calc(100vw - 2rem)',
              zIndex: 60,
            }}
          >
            <p className="mb-2 line-clamp-2 border-l-2 border-primary/50 pl-2 text-[12px] italic text-muted-foreground">
              &ldquo;{commentDraft.passage}&rdquo;
            </p>
            <Textarea
              autoFocus
              value={draftBody}
              onChange={(event) => {
                setDraftBody(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  closeDraft();
                }
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void submitDraft();
                }
              }}
              placeholder="Add a comment…"
              rows={3}
              className="mb-2 text-[12.5px]"
            />
            <div className="flex items-center justify-end gap-1.5">
              <Button type="button" variant="ghost" size="sm" onClick={closeDraft}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={draftBody.trim() === '' || draftSubmitting}
                onClick={() => void submitDraft()}
              >
                {draftSubmitting ? 'Adding…' : 'Comment'}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    );
  },
);

type ToolbarEditor = NonNullable<ReturnType<typeof useEditor>>;

function RichTextToolbar({ editor }: { editor: ToolbarEditor }) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const buttonStyle = (active: boolean): CSSProperties => ({
    padding: '0.25rem 0.5rem',
    borderRadius: 4,
    border: '1px solid #d1d5db',
    background: active ? '#e5e7eb' : '#fff',
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
  });

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}
    >
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBold().run()}
        aria-pressed={editor.isActive('bold')}
        style={buttonStyle(editor.isActive('bold'))}
      >
        Bold
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        aria-pressed={editor.isActive('italic')}
        style={buttonStyle(editor.isActive('italic'))}
      >
        Italic
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        aria-pressed={editor.isActive('heading', { level: 2 })}
        style={buttonStyle(editor.isActive('heading', { level: 2 }))}
      >
        H2
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        aria-pressed={editor.isActive('bulletList')}
        style={buttonStyle(editor.isActive('bulletList'))}
      >
        List
      </button>
      <button
        type="button"
        onClick={() =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }
        style={buttonStyle(editor.isActive('table'))}
      >
        Table
      </button>
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        style={buttonStyle(false)}
      >
        Image
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        aria-label="Insert image"
        style={{ display: 'none' }}
        onChange={(event) => {
          insertImageFiles(editor.view, event.target.files);
          event.target.value = '';
        }}
      />
    </div>
  );
}
