import type { Metadata } from 'next';
import Dashboard from './dashboard';
export const metadata: Metadata = { title: '服务端监控 · Relayune', robots: { index: false, follow: false } };
export default function Page() { return <Dashboard />; }
