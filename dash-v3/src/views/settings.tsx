import { useEffect, useState, type ReactNode } from 'react'
import { MonitorIcon, MoonIcon, RefreshCwIcon, SunIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ItemRow } from '@/components/item-bits'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { PageHeader, Section } from '@/components/page'
import { useVault, useVaultContext } from '@/lib/store'
import { setThemePreference, useThemePreference, type ThemePreference } from '@/lib/theme'
import { api, errorText, isDisabledSchedule, isPendingReview, type Item } from '@/lib/vault'

interface ReconcileReport { checked: number; recovered: string[]; missing: string[]; changed: string[]; unregistered: string[] }

function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="facts">
      {rows.map(([label, value]) => <div key={label} className="contents"><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
  )
}

export function SettingsView() {
  const vault = useVault()
  const { reload } = useVaultContext()
  const [health, setHealth] = useState('Checking…')
  const [report, setReport] = useState<ReconcileReport | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState('')
  const theme = useThemePreference()
  useEffect(() => {
    api<{ ok: boolean; version: string }>('/api/health')
      .then(result => setHealth(result.ok ? `Running, version ${result.version}` : 'Not healthy'))
      .catch(error => setHealth(errorText(error)))
  }, [])
  const schedules = vault.items.filter(item => ['reminder', 'agent-job'].includes(item.type) || isPendingReview(item))
  const waiting = schedules.filter(isPendingReview)
  const state = (item: Item) => isPendingReview(item) ? 'Imported, waiting for review' : isDisabledSchedule(item) ? 'Disabled' : 'Enabled, runs only with the 2b worker'

  const check = async () => {
    setChecking(true)
    setCheckError('')
    try {
      setReport(await api<ReconcileReport>('/api/reconcile', { method: 'POST' }))
      await reload()
    } catch (error) {
      setCheckError(errorText(error))
    } finally {
      setChecking(false)
    }
  }
  const list = (ids: string[]) => ids.length
    ? (
      <Collapsible>
        <span className="tabular-nums">{ids.length}</span>{' '}
        <CollapsibleTrigger asChild><Button variant="link" size="xs" className="h-auto p-0">Show</Button></CollapsibleTrigger>
        <CollapsibleContent><pre className="mt-1 max-h-60 overflow-auto rounded-md bg-muted p-2 text-xs">{ids.slice(0, 200).join('\n')}{ids.length > 200 ? '\n…' : ''}</pre></CollapsibleContent>
      </Collapsible>
    )
    : <span className="tabular-nums">0</span>

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" description="Appearance, where your vault lives, and checks you can run." />
      <Section title="Appearance">
        <ToggleGroup type="single" variant="outline" spacing={0} value={theme} onValueChange={value => value && setThemePreference(value as ThemePreference)} aria-label="Theme" className="mt-2">
          <ToggleGroupItem value="light"><SunIcon />Light</ToggleGroupItem>
          <ToggleGroupItem value="dark"><MoonIcon />Dark</ToggleGroupItem>
          <ToggleGroupItem value="system"><MonitorIcon />System</ToggleGroupItem>
        </ToggleGroup>
        <p className="mt-2 text-sm text-muted-foreground">System follows the light or dark setting of this device. The choice is saved in this browser.</p>
      </Section>

      <Section title="Vault">
        <Facts rows={[
          ['Vault folder', <code className="break-all text-xs">{vault.root}</code>],
          ['Items', <span className="tabular-nums">{vault.stats.objects.toLocaleString('en-IN')}</span>],
          ['Links', <span className="tabular-nums">{vault.stats.relationships.toLocaleString('en-IN')}</span>],
          ['Content files', <span className="tabular-nums">{vault.stats.files.toLocaleString('en-IN')}</span>],
          ['Types', <span className="tabular-nums">{vault.stats.types.toLocaleString('en-IN')}</span>],
          ['Time zone', 'Asia/Kolkata'],
          ['Server', health],
        ]} />
        <p className="mt-3 max-w-[70ch] text-sm text-muted-foreground">To change the vault folder or the agent settings, edit <code className="text-xs">~/.2b/config.json</code> and restart 2b.</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void reload()}><RefreshCwIcon />Reload items</Button>
      </Section>

      <Section title="Reminders and agent jobs" count={schedules.length}>
        <p className="mb-2 max-w-[70ch] text-sm text-muted-foreground">
          This dashboard does not run schedules or commands. {waiting.length > 0 && <>{waiting.length} imported {waiting.length === 1 ? 'schedule waits' : 'schedules wait'} for review. Review one from the CLI with <code className="text-xs">2b show ID</code>, then <code className="text-xs">2b object set ID migrationReview reviewed</code> and <code className="text-xs">2b object set ID enabled true</code>. </>}An enabled schedule runs only while <code className="text-xs">2b worker</code> runs.
        </p>
        {schedules.length ? (
          <ul>
            {schedules.map(item => (
              <ItemRow key={item.id} item={item} showDescription={false} meta={<>{typeof item.properties.every === 'string' && <span>every {item.properties.every}</span>}</>} actions={<Badge variant="outline">{state(item)}</Badge>} />
            ))}
          </ul>
        ) : <p className="text-sm text-muted-foreground">No reminder or agent job.</p>}
      </Section>

      <Section title="Check files">
        <p className="max-w-[70ch] text-sm text-muted-foreground">2b watches the vault folder and picks up file changes by itself. Run this check only when something looks out of date. It repairs interrupted saves and reports missing, changed, and unregistered files. It does not delete anything.</p>
        <Button variant="outline" className="mt-3" onClick={check} disabled={checking}>{checking ? 'Checking…' : 'Check files now'}</Button>
        {checkError && <p role="alert" className="mt-2 text-sm text-destructive">Check failed: {checkError}</p>}
        {report && (
          <div className="mt-4">
            <Facts rows={[
              ['Checked', <span className="tabular-nums">{report.checked}</span>],
              ['Recovered saves', list(report.recovered)],
              ['Missing files', list(report.missing)],
              ['Changed outside 2b', list(report.changed)],
              ['Unregistered files', list(report.unregistered)],
            ]} />
          </div>
        )}
      </Section>
    </div>
  )
}
