import { useEffect, useState } from 'react';
import { ActivityFeed } from './ActivityFeed'; // ~25 ms render, 200 events
import { CustomerSearchResults } from './CustomerSearchResults';
import { KpiGrid } from './KpiGrid'; // ~15 ms render
import { RevenueChart } from './RevenueChart'; // ~40 ms render (canvas)
import type { Report } from './types';

function useWindowSize() {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return size;
}

export function Dashboard({ report }: { report: Report }) {
  const [search, setSearch] = useState('');
  const { width } = useWindowSize();
  const isNarrow = width < 900;

  return (
    <div className={isNarrow ? 'dashboard dashboard--stacked' : 'dashboard'}>
      <header className="dashboard__header">
        <h1>{report.title}</h1>
        <input
          placeholder="Search customers"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </header>

      {search && <CustomerSearchResults query={search} />}

      <KpiGrid kpis={report.kpis} />
      <RevenueChart points={report.revenue} compact={isNarrow} />
      <ActivityFeed events={report.activity} />
    </div>
  );
}
