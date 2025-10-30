/**
 * DEVELOPMENT ENTRY POINT ONLY
 * 
 * This file is ONLY used by the Vite dev server for local debugging.
 * It is NOT used in production or by ChatGPT integration.
 * 
 * For production (ChatGPT):
 * - The MCP server uses src/components/todo/index.jsx as the entry point
 * - Build process bundles components into dist/ folder
 * - ChatGPT receives pre-built assets from the MCP server
 * 
 * To test with ChatGPT: run "pnpm run build" then "pnpm run server"
 */

import { createRoot } from 'react-dom/client';
import App from './components/todo/todo';
import './index.css';
import 'react-datepicker/dist/react-datepicker.css';

// Create the root element if it doesn't exist
const rootElement = document.getElementById('root');
if (!rootElement) {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
}

// Render the app
const root = createRoot(document.getElementById('root')!);
root.render(<App />);
