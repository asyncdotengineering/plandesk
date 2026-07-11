import {
  CodeIcon,
  FileTextIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ListIcon,
  ListChecksIcon,
  ListOrderedIcon,
  MinusIcon,
  QuoteIcon,
  TableIcon,
  TextIcon,
} from 'lucide-react';
import { createSuggestionExtension, type SuggestionItem } from './EditorSuggestion.js';

const ICON = 'size-4';

const SLASH_ITEMS: SuggestionItem[] = [
  {
    title: 'Text',
    subtitle: 'Plain paragraph',
    icon: <TextIcon className={ICON} />,
    keywords: ['paragraph', 'p', 'body'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setParagraph().run();
    },
  },
  {
    title: 'Heading 1',
    icon: <Heading1Icon className={ICON} />,
    keywords: ['h1', 'title', 'big'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleHeading({ level: 1 }).run();
    },
  },
  {
    title: 'Heading 2',
    icon: <Heading2Icon className={ICON} />,
    keywords: ['h2', 'subtitle'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleHeading({ level: 2 }).run();
    },
  },
  {
    title: 'Heading 3',
    icon: <Heading3Icon className={ICON} />,
    keywords: ['h3'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleHeading({ level: 3 }).run();
    },
  },
  {
    title: 'Bullet list',
    icon: <ListIcon className={ICON} />,
    keywords: ['ul', 'unordered', 'point'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    title: 'Numbered list',
    icon: <ListOrderedIcon className={ICON} />,
    keywords: ['ol', 'ordered', 'number'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
  {
    title: 'To-do list',
    icon: <ListChecksIcon className={ICON} />,
    keywords: ['task', 'todo', 'checkbox', 'check'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run();
    },
  },
  {
    title: 'Quote',
    icon: <QuoteIcon className={ICON} />,
    keywords: ['blockquote', 'cite'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run();
    },
  },
  {
    title: 'Code block',
    icon: <CodeIcon className={ICON} />,
    keywords: ['code', 'snippet', 'pre'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
    },
  },
  {
    title: 'Divider',
    icon: <MinusIcon className={ICON} />,
    keywords: ['hr', 'rule', 'separator', 'line'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run();
    },
  },
  {
    title: 'Table',
    icon: <TableIcon className={ICON} />,
    keywords: ['grid'],
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run();
    },
  },
];

function filterItems(items: SuggestionItem[], query: string): SuggestionItem[] {
  const q = query.toLowerCase().trim();
  if (q === '') {
    return items;
  }
  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      (item.keywords ?? []).some((keyword) => keyword.includes(q)),
  );
}

export function createSlashExtension() {
  return createSuggestionExtension({
    name: 'slashCommand',
    char: '/',
    getItems: (query) => filterItems(SLASH_ITEMS, query),
  });
}

export type DocLinkTarget = { id: string; title: string };

// The doc list + project id are read through getters so a changing document set
// never forces the editor to be recreated.
export function createDocLinkExtension(getters: {
  getDocs: () => DocLinkTarget[];
  getProjectId: () => string | undefined;
}) {
  return createSuggestionExtension({
    name: 'docLink',
    char: '[[',
    getItems: (query) => {
      const projectId = getters.getProjectId();
      if (projectId === undefined) {
        return [];
      }
      const q = query.toLowerCase().trim();
      return getters
        .getDocs()
        .filter((doc) => q === '' || doc.title.toLowerCase().includes(q))
        .slice(0, 12)
        .map((doc) => ({
          title: doc.title,
          icon: <FileTextIcon className={ICON} />,
          command: ({ editor, range }) => {
            const href = `/projects/${projectId}/documents/${doc.id}`;
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent([
                { type: 'text', text: doc.title, marks: [{ type: 'link', attrs: { href } }] },
                { type: 'text', text: ' ' },
              ])
              .run();
          },
        }));
    },
  });
}
