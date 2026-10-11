import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { start, checkDate, flushSave } from './screen.js';

registerSW({ immediate: true });
start();

// The app may sit in the background overnight. Whenever it comes back, recompute "today".
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushSave();
  else checkDate();
});
window.addEventListener('pageshow', checkDate);
window.addEventListener('focus', checkDate);
window.addEventListener('pagehide', flushSave);
setInterval(checkDate, 30000);
