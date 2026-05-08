import type { Meta, StoryObj } from '@storybook/nextjs';
import Win95Window, {
  Win95MenuBar,
  Win95MenuItem,
  Win95StatusBar,
  Win95StatusPanel,
} from './Win95Window';

const meta: Meta<typeof Win95Window> = {
  title: 'Shell / Win95Window',
  component: Win95Window,
  parameters: {
    layout: 'centered',
  },
  args: {
    title: 'Untitled',
    active: true,
  },
};

export default meta;
type Story = StoryObj<typeof Win95Window>;

/* ─── Baseline ─── */

export const Default: Story = {
  args: {
    title: 'My Document — Notepad',
    style: { width: 400, height: 260 },
    children: (
      <div style={{ padding: 8, fontFamily: 'var(--font-shell)', fontSize: 'var(--win-font-size)' }}>
        Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor.
      </div>
    ),
  },
};

/* ─── Active vs Inactive ─── */

export const ActiveWindow: Story = {
  args: {
    title: 'Specimen.exe — Active',
    active: true,
    style: { width: 380 },
    children: (
      <div style={{ padding: 8, fontFamily: 'var(--font-shell)', fontSize: 'var(--win-font-size)' }}>
        Active window — navy title bar, white text.
      </div>
    ),
  },
};

export const InactiveWindow: Story = {
  args: {
    title: 'Specimen.exe — Inactive',
    active: false,
    style: { width: 380 },
    children: (
      <div style={{ padding: 8, fontFamily: 'var(--font-shell)', fontSize: 'var(--win-font-size)' }}>
        Inactive window — grey title bar, muted text.
      </div>
    ),
  },
};

/* ─── With Menu Bar ─── */

export const WithMenuBar: Story = {
  args: {
    title: 'Explorer',
    icon: '🖥️',
    style: { width: 480, height: 320 },
    menuBar: (
      <Win95MenuBar>
        <Win95MenuItem>File</Win95MenuItem>
        <Win95MenuItem>Edit</Win95MenuItem>
        <Win95MenuItem active>View</Win95MenuItem>
        <Win95MenuItem>Help</Win95MenuItem>
      </Win95MenuBar>
    ),
    children: (
      <div style={{ padding: 8, fontFamily: 'var(--font-shell)', fontSize: 'var(--win-font-size)' }}>
        File explorer body area.
      </div>
    ),
  },
};

/* ─── With Status Bar ─── */

export const WithStatusBar: Story = {
  args: {
    title: 'Specimen — Analysis',
    icon: '🔍',
    style: { width: 520, height: 360 },
    children: (
      <>
        <div style={{ flex: 1, padding: 8, fontFamily: 'var(--font-shell)', fontSize: 'var(--win-font-size)' }}>
          Analysis content area.
        </div>
        <Win95StatusBar>
          <Win95StatusPanel style={{ flex: 1 }}>12 fonts found</Win95StatusPanel>
          <Win95StatusPanel style={{ width: 100 }}>Klim Type</Win95StatusPanel>
          <Win95StatusPanel style={{ width: 60 }}>Ready</Win95StatusPanel>
        </Win95StatusBar>
      </>
    ),
  },
};

/* ─── Dialog / Narrow ─── */

export const Dialog: Story = {
  args: {
    title: 'Specimen — Open URL',
    icon: '🔍',
    style: { width: 380 },
    children: (
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--win-face)' }}>
        <label style={{ fontFamily: 'var(--font-shell)', fontSize: 'var(--win-font-size)' }}>
          Foundry URL:
        </label>
        <input
          className="win-input"
          placeholder="https://..."
          defaultValue="https://klim.co.nz/retail-fonts/domaine-display/"
          readOnly
        />
        <div style={{ height: 1, background: 'var(--win-shadow)' }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="win-btn win-btn-primary">Analyze</button>
          <button className="win-btn">Clear</button>
        </div>
      </div>
    ),
  },
};

/* ─── Font rendering verification ─── */

export const FontRendering: Story = {
  name: 'Font — MS Sans Serif Verification',
  args: {
    title: 'Font Verification',
    style: { width: 440 },
    children: (
      <div style={{ padding: 12, fontFamily: 'var(--font-shell)', fontSize: 'var(--win-font-size)', lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p style={{ fontWeight: 400 }}>Regular — The quick brown fox jumps over the lazy dog 1234567890</p>
        <p style={{ fontWeight: 700 }}>Bold — The quick brown fox jumps over the lazy dog 1234567890</p>
        <p>ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz</p>
        <p>{'!@#$%^&*() ,.?\';":[]{}'} — …</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button className="win-btn win-btn-primary">OK</button>
          <button className="win-btn">Cancel</button>
          <button className="win-btn" disabled>Disabled</button>
        </div>
      </div>
    ),
  },
};
