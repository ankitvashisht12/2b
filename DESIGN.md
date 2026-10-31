# 2b V3 design system

World: a calm day book inside a standard app workspace, close to Obsidian or a mail app. The code is React with shadcn/ui (Radix, style `radix-nova`) in `dash-v3/src`. Tokens are in `dash-v3/src/index.css`. Direction, views, and review notes: `docs/design-v3.md`.

## Words

- **Item**: a saved thing. **Type**: the category of an item. When the type is known, use its own name: Project, Task, Note, Person (People), Book, Collection.
- Never show "object" in the UI. The API keeps its wire names (`/api/objects`). Server messages are mapped to item words.
- Field and link names are plain words: "Inbox state", "Starts at", "Part of", "Contains", "Mentioned in". Raw keys show only on the Types page.
- **Scope**: All, Work, or Personal. Work and Personal come from the `work`/`personal` tags or a project's `area`.

## Shell

- shadcn Sidebar, collapsible to icons (⌘B or the rail). Main group: Today, Timeline, Calendar, Inbox, Projects, Library. Vault group: Tags, Types, Graph, Settings.
- Sticky top bar: sidebar toggle, breadcrumb (the current place), scope switch, Search (`/` or ⌘K), New item (`N`).
- The scope switch is always in the top bar and is remembered (`localStorage` key `2b.scope`). It filters Today, Timeline, Calendar, Inbox, Projects, Library, Tags counts, the Graph list, and search. Today, Timeline, Calendar, Inbox, Projects, and Library say how many lines or items another scope hides and offer "Show all scopes". Tags and Graph count the current scope only.

## Colour (Restrained, oklch)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `oklch(0.988 0.003 106)` | `oklch(0.2 0.008 255)` | Page ground (warm paper / ink night) |
| `--sidebar` | `oklch(0.966 0.005 106)` | `oklch(0.175 0.008 255)` | Navigation panel |
| `--foreground` / `--primary` | `oklch(0.255 0.017 254)` | `oklch(0.925 0.008 250)` | Text, primary buttons |
| `--muted-foreground` | `oklch(0.49 0.015 250)` | `oklch(0.72 0.015 250)` | Meta text (≥4.5:1) |
| `--border` | `oklch(0.912 0.006 106)` | `oklch(0.3 0.01 255)` | Rules |
| `--work` | `oklch(0.55 0.15 258)` | `oklch(0.72 0.12 258)` | Work scope dot |
| `--personal` | `oklch(0.52 0.12 160)` | `oklch(0.75 0.12 160)` | Personal scope dot (≥4.3:1 on the selected cell) |
| `--warn` | `oklch(0.52 0.17 29)` | `oklch(0.74 0.14 30)` | Overdue, due dates in the month grid |
| `--progress` | `oklch(0.62 0.13 70)` | `oklch(0.8 0.12 75)` | In progress |
| `--margin` | `oklch(0.6 0.15 32)` | `oklch(0.6 0.13 32)` | The day spine rule (at 45%) |
| `--link` | `oklch(0.43 0.12 258)` | `oklch(0.78 0.1 258)` | Links in prose, focus ring, selection |

Light or dark follows the system setting.

## Type

System sans (SF on the Mac). 14px UI, 22px page title, 15px reading prose at 70ch, 12px meta. Times, dates, and counts use tabular numerals. Monospace only for paths, IDs, and code.

## Signature: the day spine

Times in a 3.25rem gutter, one thin margin rule, and the type or log icon on the rule. It is used for the Today schedule and activity, the Timeline, the Calendar day panel, and an item's History.

## Components

shadcn: Sidebar, Breadcrumb, ToggleGroup (scope, ranges, sort), Button and ButtonGroup, Calendar (react-day-picker: date picker, range picker, side month, and the month grid with a custom day button), Popover (date pickers, Add link), Dialog (New item, Process, New type, tag description, keyboard shortcuts), AlertDialog (leave or discard unsaved edits), Command (search palette, item picker), Collapsible (Overdue, In progress, folded files, done tasks), Table (Types, Tags), Field, Input, Select, Checkbox, Textarea, Alert, Empty, Skeleton, Badge, Tooltip, DropdownMenu, Sonner (with Undo).

- Dialogs fit the viewport (`100dvh − 2rem`) and scroll inside; the footer stays in view. Focus returns to the control that opened a dialog.
- Touch (coarse pointer or below 768 px): top-bar, day, and row buttons are at least 40 px; task boxes have a 44 px hit area.

- **Item row**: type icon or task checkbox · name (the whole row opens the item) · one meta line (type, status, project, tags) · date · scope dot.
- **Bulk files**: artifacts, evidence, agent runs, and archived records fold under their parent item on day views. "All items" in the Library leaves them out unless you search or pick their type.
- **Errors**: an Alert that names the problem and gives Try again plus a way out. A page that fails to render does not take the app down.

## Motion

- New item, Search, and the shortcuts list open from the keyboard many times a day: no animation (`DialogContent instant`). Page and day changes do not animate. ⌘B shows or hides the sidebar at once; a pointer toggle takes 150ms.
- Popovers, menus, and other dialogs: 100ms fade and zoom from the trigger, `--ease-out` (`cubic-bezier(0.23, 1, 0.32, 1)`). The overlay dims with no blur. The phone sidebar uses `--ease-drawer` (`cubic-bezier(0.32, 0.72, 0, 1)`), 250ms in and 200ms out.
- Folding groups: 180ms open, 120ms close, `--ease-out`. The chevron turns in 150ms.
- A completed task: the strike-through fades in over 200ms; in a list the row stays 1.5s, then fades and folds in 180ms.
- Buttons scale to 0.97 while pressed (150ms).
- Hover colour: 120ms, fine pointers only.
- Reduced motion: fades and colour changes stay; zoom, slide, height, and press scale go; skeleton pulses and spinners stop.
