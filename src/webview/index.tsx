import ReactDOM from 'react-dom/client';
import { App } from './App';
import { FlavorApp } from './FlavorApp';
import { RunApp } from './RunApp';

declare global {
	interface Window {
		__MEGALINTER_VIEW__?: 'config' | 'flavor' | 'run';
	}
}

const root = ReactDOM.createRoot(document.getElementById('root')!);
const view = window.__MEGALINTER_VIEW__ || 'config';
root.render(view === 'flavor' ? <FlavorApp /> : view === 'run' ? <RunApp /> : <App />);
