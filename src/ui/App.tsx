import { useEffect, useState } from 'react';
import { useStudio } from '@/state/store';
import { lastProjectId, openProject, rememberLast } from '@/app/projectActions';
import { Home } from './Home';
import { Studio } from './Studio';
import { Toasts } from './Toasts';

export function App() {
  const hasProject = useStudio((s) => !!s.project);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const id = lastProjectId();
    if (!id) return setBooting(false);
    openProject(id)
      .catch(() => rememberLast(null))
      .finally(() => setBooting(false));
  }, []);

  if (booting) return null;
  return (
    <>
      {hasProject ? <Studio /> : <Home />}
      <Toasts />
    </>
  );
}
