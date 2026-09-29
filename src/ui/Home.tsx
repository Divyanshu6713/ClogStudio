import { useEffect, useRef, useState } from 'react';
import { Box, FileUp, Footprints, Trash2 } from 'lucide-react';
import { localProjects, type ProjectSummary } from '@/persistence/repositories';
import { createProjectFromModelFile, createReferenceProject, openProject } from '@/app/projectActions';
import { toast, useRuntime } from '@/runtime';
import { Disclaimer } from './Disclaimer';

export function Home() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [name, setName] = useState('Untitled clog');
  const [busy, setBusy] = useState<string | null>(null);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const status = useRuntime((s) => s.status);

  const refresh = () =>
    localProjects
      .list()
      .then(setProjects)
      .catch((e) => {
        setProjects([]);
        toast(e instanceof Error ? e.message : String(e), 'error');
      });
  useEffect(() => void refresh(), []);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const projectName = name.trim() || 'Untitled clog';
  const first = projects !== null && projects.length === 0;

  return (
    <div className="home">
      <header className="home-top">
        <div className="brand">
          <span className="brand-mark"><Footprints size={14} /></span>
          Clog Design Studio
        </div>
        <span className="spacer" />
        <button className="disclaimer-link" onClick={() => setShowDisclaimer(true)}>Digital visualization — about accuracy</button>
      </header>
      <main className="home-main">
        <h1>{first ? 'Create your first clog design' : 'Clog designs'}</h1>
        <p className="muted" style={{ margin: 0 }}>Place your real artwork on a 3D clog, inspect it from every angle, and keep versions before production.</p>
        <ol className="steps">
          <li><span>1</span>Select a clog model</li>
          <li><span>2</span>Choose base colours</li>
          <li><span>3</span>Upload artwork</li>
          <li><span>4</span>Place, inspect, iterate</li>
        </ol>

        <div className="section-title" style={{ marginTop: 8 }}>New design</div>
        <label className="sr-only" htmlFor="new-name">Project name</label>
        <input id="new-name" className="text-input" style={{ maxWidth: 360, marginBottom: 12, background: '#fff' }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" />
        <div className="model-cards">
          <div className="model-card">
            <h3><Box size={15} style={{ verticalAlign: -2 }} /> Reference clog</h3>
            <p className="muted" style={{ margin: 0 }}>A procedurally generated stand-in model with 5 colour zones and 13 vent holes. Good for learning the workflow.</p>
            <div className="toggle-row"><span className="badge warn">Reference geometry</span><span className="badge">Not calibrated</span><span className="badge">Right shoe</span></div>
            <button className="btn primary lg" disabled={!!busy} onClick={() => run('ref', () => createReferenceProject(projectName))}>
              {busy === 'ref' ? status.label || 'Loading…' : 'Start with reference clog'}
            </button>
          </div>
          <div className="model-card">
            <h3><FileUp size={15} style={{ verticalAlign: -2 }} /> Your clog model</h3>
            <p className="muted" style={{ margin: 0 }}>Import the real product model as <b>.glb</b> (or self-contained .gltf). Named meshes become colour zones; empties named <span className="mono">charm_hole_01…</span> become charm points.</p>
            <div className="toggle-row"><span className="badge">GLB / GLTF</span><span className="badge">OBJ · FBX later</span></div>
            <input
              ref={fileRef}
              type="file"
              accept=".glb,.gltf,.obj,.fbx"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f)
                  run('model', async () => {
                    const warnings = await createProjectFromModelFile(f, projectName);
                    for (const w of warnings) toast(w, 'warn', 9000);
                  });
              }}
            />
            <button className="btn lg" disabled={!!busy} onClick={() => fileRef.current?.click()}>
              {busy === 'model' ? status.label || 'Reading model…' : 'Import model file…'}
            </button>
          </div>
        </div>

        {projects && projects.length > 0 && (
          <>
            <div className="section-title" style={{ marginTop: 28 }}>Projects on this device</div>
            <ul className="proj-list">
              {projects.map((p) => (
                <li key={p.id}>
                  <button className="proj-open" onClick={() => run('open', () => openProject(p.id))}>
                    <strong>{p.name}</strong>
                    <span className="faint">{p.modelName} · {p.versionCount} version{p.versionCount === 1 ? '' : 's'} · edited {new Date(p.updatedAt).toLocaleString()}</span>
                  </button>
                  <button className="btn sm" onClick={() => run('open', () => openProject(p.id))}>Open</button>
                  <button
                    className="icon-btn"
                    aria-label={`Delete project ${p.name}`}
                    title="Delete project"
                    onClick={() => {
                      if (confirm(`Delete "${p.name}" and its stored assets from this browser? This cannot be undone.`))
                        run('del', async () => {
                          await localProjects.remove(p.id);
                          await refresh();
                        });
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="hint" style={{ marginTop: 20 }}>Projects are stored in this browser (IndexedDB). Clearing site data removes them.</p>
      </main>
      {showDisclaimer && <Disclaimer onClose={() => setShowDisclaimer(false)} />}
    </div>
  );
}
