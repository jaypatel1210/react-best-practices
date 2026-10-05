import { createContext, memo, use, useCallback, useMemo, useState } from 'react';
import { DemoShell, Meter, RenderLegend, Tracked, useWorkMeter } from './kit';

type Theme = 'light' | 'dark';
const flip = (theme: Theme): Theme => (theme === 'light' ? 'dark' : 'light');

function NoteField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <input
      className="demo-input"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder="Type a note (nothing below reads it)"
      aria-label="Note"
    />
  );
}

/* ---------- The issue: one context, and a value object created inline on every render ---------- */

const SettingsContext = createContext<{ theme: Theme; toggleTheme: () => void } | null>(null);

const BadgeA = memo(function ThemeBadge() {
  const { theme } = use(SettingsContext)!;
  return <Tracked name="ThemeBadge" kind="memo" tag="memo · reads theme" note={`Theme: ${theme}`} />;
});

const ButtonA = memo(function ToggleThemeButton() {
  const { toggleTheme } = use(SettingsContext)!;
  return (
    <Tracked name="ToggleThemeButton" kind="memo" tag="memo · reads toggleTheme">
      <button type="button" className="demo-btn" onClick={toggleTheme}>
        Toggle theme
      </button>
    </Tracked>
  );
});

const PanelA = memo(function ReportPanel() {
  const { theme } = use(SettingsContext)!;
  return <Tracked name="ReportPanel" kind="memo" tag="memo · reads theme" cost={16} note={`Charts styled for ${theme}.`} />;
});

function AppWithInlineValue({ measure }: { measure: () => void }) {
  const [note, setNote] = useState('');
  const [theme, setTheme] = useState<Theme>('light');
  const toggleTheme = () => setTheme(flip);

  return (
    <Tracked name="App" kind="state" tag="owns note, theme">
      <NoteField
        value={note}
        onChange={(value) => {
          measure();
          setNote(value);
        }}
      />
      <SettingsContext value={{ theme, toggleTheme }}>
        <div className="tracked-body row">
          <BadgeA />
          <ButtonA />
          <PanelA />
        </div>
      </SettingsContext>
    </Tracked>
  );
}

/* ---------- The fix: memoized values, with state and actions in separate contexts ---------- */

const ThemeContext = createContext<Theme>('light');
const ThemeActionsContext = createContext<{ toggleTheme: () => void } | null>(null);

const BadgeB = memo(function ThemeBadge() {
  const theme = use(ThemeContext);
  return <Tracked name="ThemeBadge" kind="memo" tag="memo · reads theme" note={`Theme: ${theme}`} />;
});

const ButtonB = memo(function ToggleThemeButton() {
  const { toggleTheme } = use(ThemeActionsContext)!;
  return (
    <Tracked name="ToggleThemeButton" kind="memo" tag="memo · reads actions">
      <button type="button" className="demo-btn" onClick={toggleTheme}>
        Toggle theme
      </button>
    </Tracked>
  );
});

const PanelB = memo(function ReportPanel() {
  const theme = use(ThemeContext);
  return <Tracked name="ReportPanel" kind="memo" tag="memo · reads theme" cost={16} note={`Charts styled for ${theme}.`} />;
});

function AppWithStableValues({ measure }: { measure: () => void }) {
  const [note, setNote] = useState('');
  const [theme, setTheme] = useState<Theme>('light');
  const toggleTheme = useCallback(() => setTheme(flip), []);
  const actions = useMemo(() => ({ toggleTheme }), [toggleTheme]);

  return (
    <Tracked name="App" kind="state" tag="owns note, theme">
      <NoteField
        value={note}
        onChange={(value) => {
          measure();
          setNote(value);
        }}
      />
      <ThemeContext value={theme}>
        <ThemeActionsContext value={actions}>
          <div className="tracked-body row">
            <BadgeB />
            <ButtonB />
            <PanelB />
          </div>
        </ThemeActionsContext>
      </ThemeContext>
    </Tracked>
  );
}

function Stage({ mode }: { mode: 'issue' | 'fix' }) {
  const meter = useWorkMeter();
  return (
    <>
      <div className="meters">
        <Meter label="Main-thread work per keystroke" outRef={meter.outRef} />
      </div>
      {mode === 'issue' ? <AppWithInlineValue measure={meter.measure} /> : <AppWithStableValues measure={meter.measure} />}
    </>
  );
}

export default function ContextDemo() {
  return (
    <DemoShell
      title="Type in an unrelated field, then toggle the theme"
      hint="All three consumers are wrapped in memo, so only a context change can re-render them. Type a few letters, then press Toggle theme."
      issueLabel="Inline value"
      fixLabel="Memoized and split"
      legend={<RenderLegend />}
      explain={{
        issue: (
          <>
            <code>{'value={{ theme, toggleTheme }}'}</code> is a new object every time <code>App</code> renders. React
            compares context values by identity, so every keystroke re-renders every consumer, <code>memo</code> or not.
          </>
        ),
        fix: (
          <>
            Typing re-renders only <code>App</code>: the context values keep their identity. Toggling the theme
            re-renders the two components that read it, while the button, which reads only the stable actions, stays
            put.
          </>
        ),
      }}
    >
      {(mode) => <Stage mode={mode} />}
    </DemoShell>
  );
}
