import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'
import { NAV_MAIN, NAV_VAULT } from '@/components/navigation'

const GROUPS: Array<[string, Array<[string[], string]>]> = [
  ['Anywhere', [
    [['/'], 'Search'],
    [['⌘', 'K'], 'Search'],
    [['N'], 'New item'],
    [['⌘', 'Z'], 'Undo the last complete or process'],
    [['⌘', 'B'], 'Show or hide the sidebar'],
    [['?'], 'These shortcuts'],
  ]],
  ['Go to', [...NAV_MAIN, ...NAV_VAULT].filter(entry => entry.key).map(entry => [['G', entry.key!.toUpperCase()], entry.title])],
  ['Today and day pages', [
    [['←'], 'Previous day'],
    [['→'], 'Next day'],
    [['T'], 'Today'],
  ]],
  ['Item pages and forms', [
    [['E'], 'Edit the item'],
    [['⌘', 'S'], 'Save the edit'],
    [['⌘', 'Enter'], 'Save a form'],
    [['Esc'], 'Close or cancel'],
  ]],
]

/** Opened with "?" many times while learning; like Search, it appears at once. */
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent instant className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Keys work when the focus is not in a text field.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {GROUPS.map(([title, rows]) => (
            <section key={title} aria-label={title}>
              <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">{title}</h3>
              <dl className="grid gap-1.5">
                {rows.map(([keys, label]) => (
                  <div key={keys.join('+') + label} className="flex items-center justify-between gap-4 text-sm">
                    <dt>{label}</dt>
                    <dd className="flex shrink-0 gap-1">{keys.map(key => <Kbd key={key}>{key}</Kbd>)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
