// Collapses or restores the preview in the real window, for taking screenshots.
// Usage: node collapse.mjs hide|show
import { connect } from './cdp.mjs';

const { evaluate, close } = await connect();
const label = process.argv[2] === 'show' ? 'Show the preview' : 'Hide the preview';
const found = await evaluate(`(() => { const b = document.querySelector('button[aria-label="${label}"]'); if (!b) return false; b.focus(); b.click(); return true; })()`);
await new Promise((resolve) => setTimeout(resolve, 900));
console.log(found ? `clicked "${label}"` : `no "${label}" button`);
close();
