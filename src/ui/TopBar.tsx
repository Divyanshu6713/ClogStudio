import { useEffect, useState } from 'react';
import { ChevronLeft, Footprints } from 'lucide-react';
import { closeProject } from '@/app/projectActions';
import { saveNow } from '@/persistence/autosave';
import { cmd } from '@/state/commands';
import { useStudio } from '@/state/store';
import { useProject, useVersion } from '@/state/selectors';
import { SaveStatus } from './SaveStatus';

export function TopBar() {
  const project = useProject();
  const version = useVersion();
  const [name, setName] = useState(project.name);
  useEffect(() => setName(project.name), [project.name]);

  const commitName = () => {
    const n = name.trim();
    if (n && n !== project.name) cmd.renameProject(n);
    else setName(project.name);
  };

  return (
    <header className="topbar">
      <button
        className="icon-btn"
        title="All projects"
        aria-label="Back to all projects"
        onClick={async () => {
          if (useStudio.getState().save.status !== 'saved') await saveNow();
          closeProject();
        }}
      >
        <ChevronLeft size={16} />
      </button>
      <div className="brand">
        <span className="brand-mark"><Footprints size={14} /></span>
        <span className="desk-only">Clog Studio</span>
      </div>
      <span className="vsep" />
      <label className="sr-only" htmlFor="proj-name">Project name</label>
      <input
        id="proj-name"
        className="project-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setName(project.name);
            (e.target as HTMLInputElement).blur();
          }
        }}
        size={Math.min(28, Math.max(8, name.length))}
      />
      <span className="badge" title="Version management (duplicate, branch, compare) is the next build step.">
        {version.name} · {version.status === 'final-candidate' ? 'Final candidate' : 'Draft'}
      </span>
      <span className="spacer" />
      <span className="faint desk-only" style={{ fontSize: 12 }}>{project.model.name}</span>
      <span className="vsep desk-only" />
      <SaveStatus />
    </header>
  );
}
