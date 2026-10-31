import { Command, Entry, SectionHead, repo } from './ui.tsx'

export const quickStart = `git clone ${repo}.git
cd 2b
npm install && npm run build
node --experimental-strip-types --no-warnings src/v3/install-surreal.ts
./bin/2b start`

const stopDashboard = 'pkill -f "src/v3/cli.ts serve"'

/** The full v3 install, shared by the home page and the v3 page. */
export function InstallSteps() {
  return (
    <section className="section" aria-labelledby="install">
      <SectionHead id="install" title="Install 2b on your Mac">
        Five steps, about five minutes. Copy each block into Terminal and press Return.
      </SectionHead>

      <Entry label={<strong>Before you start</strong>}>
        <h3>Check your Mac</h3>
        <p>
          2b v3 needs <strong>macOS on Apple silicon</strong> (M1 or later), <strong>Git</strong>, and <strong>Node.js 22 or later</strong>. Run these two
          commands to check:
        </p>
        <Command label="check your Mac" code={'uname -m        # must print arm64\nnode --version  # must print v22 or later'} />
        <p className="note">
          No Node.js, or an older one? Install the current version from <a href="https://nodejs.org">nodejs.org</a>, or run <code>brew install node</code>.
        </p>
      </Entry>

      <Entry label={<strong>Step 1</strong>}>
        <h3>Get the code</h3>
        <Command label="get the code" code={`git clone ${repo}.git\ncd 2b`} />
        <p className="note">
          Run all the next commands inside this <code>2b</code> folder.
        </p>
      </Entry>

      <Entry label={<strong>Step 2</strong>}>
        <h3>Build the dashboard</h3>
        <Command label="build the dashboard" code={'npm install\nnpm run build'} />
        <p className="note">
          This takes about a minute. It puts the dashboard in <code>dash-v3/dist</code>.
        </p>
      </Entry>

      <Entry label={<strong>Step 3</strong>}>
        <h3>Install the database</h3>
        <Command label="install the database" code="node --experimental-strip-types --no-warnings src/v3/install-surreal.ts" />
        <p className="note">
          2b keeps types, links, and status in SurrealDB. This command downloads SurrealDB 2.3.10 from GitHub, checks its SHA-256 checksum, and puts it in{' '}
          <code>.tools/</code> inside the 2b folder. When it is done, it prints <code>2.3.10 for macos on aarch64</code>.
        </p>
      </Entry>

      <Entry label={<strong>Step 4</strong>}>
        <h3>Set your time zone</h3>
        <p>
          2b uses your time zone to show the right day. It starts with <code>Asia/Kolkata</code>. If you live somewhere else, open the settings file and change{' '}
          <code>"timezone"</code> to your zone, for example <code>"Europe/London"</code> or <code>"America/New_York"</code>.
        </p>
        <Command
          label="open the settings file"
          code={'./bin/2b config            # creates and shows ~/.2b/config.json\nopen -e ~/.2b/config.json  # edit "timezone", then save'}
        />
        <p className="note">
          In the same file, <code>"vaultPath"</code> sets the folder for your notes (default <code>~/obsidian/2b</code>), and <code>"dashboardPort"</code> sets
          the port (default <code>4423</code>).
        </p>
      </Entry>

      <Entry label={<strong>Step 5</strong>}>
        <h3>Start 2b</h3>
        <Command label="start 2b" code="./bin/2b start" />
        <p className="note">
          Your browser opens the dashboard at <code>http://127.0.0.1:4423</code>. The first start creates your vault. Next time, run <code>./bin/2b start</code>{' '}
          again, or double-click <strong>Start 2b V3.command</strong> in the 2b folder.
        </p>
      </Entry>

      <Entry label={<strong>Optional</strong>}>
        <h3>Use the 2b command from any folder</h3>
        <Command
          label="add 2b to your PATH"
          code={
            'mkdir -p ~/.local/bin\nln -s "$PWD/bin/2b" ~/.local/bin/2b\n# Only if "2b" is still not found after this:\necho \'export PATH="$HOME/.local/bin:$PATH"\' >> ~/.zshrc'
          }
        />
        <p className="note">
          Run this inside the 2b folder. Open a new Terminal window, then try <code>2b today</code>.
        </p>
      </Entry>

      <Entry label={<strong>Optional</strong>}>
        <h3>Let your agent use 2b</h3>
        <Command
          label="install the agent skill"
          code={
            'mkdir -p ~/.claude/skills ~/.agents/skills\nln -s "$PWD/skill" ~/.claude/skills/2b  # Claude Code\nln -s "$PWD/skill" ~/.agents/skills/2b  # Codex'
          }
        />
        <p className="note">
          Do the step above first: the skill runs the <code>2b</code> command. Then ask your agent things like “put this in 2b” or “what is due this week?”.
        </p>
      </Entry>
    </section>
  )
}

/** Update, stop, and where the data lives. */
export function Upkeep() {
  return (
    <section className="section" aria-labelledby="upkeep">
      <SectionHead id="upkeep" title="Update, stop, and back up" />

      <Entry label={<strong>Update</strong>}>
        <Command label="update 2b" code={`git pull\nnpm install\nnpm run build\n${stopDashboard}  # stop the old dashboard\n./bin/2b start`} />
      </Entry>

      <Entry label={<strong>Stop</strong>}>
        <Command label="stop the dashboard" code={stopDashboard} />
        <p className="note">The dashboard keeps running after you close the browser tab. This command stops it.</p>
      </Entry>

      <Entry label={<strong>Your data</strong>}>
        <dl className="pairs">
          <dt>
            <code>~/obsidian/2b</code>
          </dt>
          <dd>
            <strong>Your vault.</strong> Notes and files as plain Markdown. Open it in Obsidian, Finder, or any editor.
          </dd>
          <dt>
            <code>~/.2b/config.json</code>
          </dt>
          <dd>
            <strong>Settings.</strong> Vault folder, dashboard port, time zone, and agent choice.
          </dd>
          <dt>
            <code>~/.2b/vaults/&lt;id&gt;/</code>
          </dt>
          <dd>
            <strong>The database</strong> for each vault, with its logs and recovery journal.
          </dd>
        </dl>
        <p className="note">Back up the vault folder and its database folder together. One without the other is not a full backup.</p>
      </Entry>
    </section>
  )
}
