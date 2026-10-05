import { useEffect, useId, useRef, useState } from 'react';
import '../demos/demo.css';
import './SessionExplainer.css';

export interface ExplainerStep {
  actor: 'you' | 'match' | 'load' | 'claude';
  text: string;
  /** Repository path of a file Claude reads in this step. */
  file?: string;
  tokens?: number;
  code?: string;
  link?: { href: string; label: string };
}

export interface ExplainerScenario {
  id: string;
  label: string;
  steps: ExplainerStep[];
}

interface Props {
  scenarios: ExplainerScenario[];
  /** Skill folder names, in display order. */
  skills: string[];
  /** Tokens for the 15 names and descriptions, which are always in context. */
  metadataTokens: number;
  /** Tokens for every file in every skill, for comparison. */
  totalTokens: number;
}

const STEP_MS = 1900;

const ACTOR_LABEL: Record<ExplainerStep['actor'], string> = {
  you: 'You',
  match: 'Claude Code',
  load: 'Reads file',
  claude: 'Claude',
};

function fileLabel(path: string) {
  return path.replace(/^skills\//, '');
}

export default function SessionExplainer({ scenarios, skills, metadataTokens, totalTokens }: Props) {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [shown, setShown] = useState(1);
  const [playing, setPlaying] = useState(false);
  const transcriptRef = useRef<HTMLOListElement>(null);
  const id = useId();

  const scenario = scenarios[scenarioIndex];
  const steps = scenario.steps.slice(0, shown);
  const done = shown >= scenario.steps.length;
  const loaded = steps.filter((s) => s.file).map((s) => s.file!);
  const loadedTokens = steps.reduce((sum, s) => sum + (s.tokens ?? 0), 0);
  const used = metadataTokens + loadedTokens;
  const activeSkills = new Set(loaded.map((file) => file.split('/')[1]));

  useEffect(() => {
    if (!playing) return;
    if (done) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setShown((n) => n + 1), STEP_MS);
    return () => clearTimeout(timer);
  }, [playing, done, shown]);

  useEffect(() => {
    const list = transcriptRef.current;
    if (!list) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    list.scrollTo({ top: list.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  }, [shown, scenarioIndex]);

  const choose = (index: number) => {
    setScenarioIndex(index);
    setShown(1);
    setPlaying(false);
  };

  return (
    <div className="sx" aria-labelledby={`${id}-title`}>
      <div className="sx-head">
        <p className="sx-title" id={`${id}-title`}>
          Watch a session, step by step
        </p>
        <div className="sx-scenarios" role="group" aria-label="Scenario">
          {scenarios.map((s, i) => (
            <button key={s.id} type="button" aria-pressed={i === scenarioIndex} onClick={() => choose(i)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="sx-body">
        <section className="sx-session" aria-label="Session transcript">
          <ol className="sx-transcript" ref={transcriptRef} aria-live="polite">
            {steps.map((step, i) => (
              <li key={`${scenario.id}-${i}`} className="sx-step" data-actor={step.actor}>
                <span className="sx-actor">{ACTOR_LABEL[step.actor]}</span>
                <div className="sx-bubble">
                  {step.file && (
                    <code className="sx-file">
                      {fileLabel(step.file)}
                      {step.tokens ? <span> · {step.tokens.toLocaleString('en-US')} tokens</span> : null}
                    </code>
                  )}
                  <p>{step.text}</p>
                  {step.code && <pre className="sx-code">{step.code}</pre>}
                  {step.link && (
                    <a className="sx-link" href={step.link.href}>
                      {step.link.label} →
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <div className="sx-controls">
            <button
              type="button"
              className="demo-btn demo-btn-primary"
              onClick={() => (done ? choose(scenarioIndex) : setPlaying((p) => !p))}
            >
              {done ? 'Replay' : playing ? 'Pause' : 'Play'}
            </button>
            <button
              type="button"
              className="demo-btn"
              disabled={done}
              onClick={() => {
                setPlaying(false);
                setShown((n) => Math.min(n + 1, scenario.steps.length));
              }}
            >
              Next step
            </button>
            <span className="sx-progress">
              Step {shown} of {scenario.steps.length}
            </span>
          </div>
        </section>

        <aside className="sx-side" aria-label="What Claude has loaded">
          <div className="sx-meter">
            <p className="sx-meter-label">Skill content in Claude’s context</p>
            <p className="sx-meter-value">
              {used.toLocaleString('en-US')} <span>of {totalTokens.toLocaleString('en-US')} tokens</span>
            </p>
            <div className="sx-bar" aria-hidden="true">
              <span className="sx-bar-meta" style={{ width: `${(metadataTokens / totalTokens) * 100}%` }} />
              <span className="sx-bar-files" style={{ width: `${(loadedTokens / totalTokens) * 100}%` }} />
            </div>
            <p className="sx-meter-note">
              {((used / totalTokens) * 100).toFixed(1)}% of all skill text. The 15 descriptions are always loaded;
              everything else is read only when the task needs it.
            </p>
          </div>

          <ul className="sx-tree" aria-label="skills folder">
            {skills.map((skill) => {
              const files = loaded.filter((file) => file.split('/')[1] === skill);
              return (
                <li key={skill} data-active={activeSkills.has(skill)}>
                  <span className="sx-folder">{skill}/</span>
                  {files.length > 0 && (
                    <ul>
                      {files.map((file) => (
                        <li key={file}>{file.split('/').slice(2).join('/')}</li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </aside>
      </div>
    </div>
  );
}
