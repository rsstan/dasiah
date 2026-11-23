// Layout of the pages without a map (home, sign-in, places, history, account, admin, 404): the
// site menu on top, the page below.
import { Outlet, useMatch } from 'react-router';
import { Brand, SiteNav } from './SiteNav.tsx';

export function SiteLayout() {
  const home = useMatch({ path: '/', end: true }) !== null;
  return (
    <div className={home ? 'site site-home' : 'site'}>
      <header className="site-header">
        <Brand />
        <SiteNav />
      </header>
      <main className={home ? 'site-main' : 'site-main page'}>
        <Outlet />
      </main>
      <footer className="site-footer">
        Timetables: open GTFS feeds. Maps and roads: ©{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
          OpenStreetMap contributors
        </a>
        .
      </footer>
    </div>
  );
}
