// The table's preferences (ct.prefs in the browser profile), one object shared by every module that reads or changes
// them; whoever changes one saves the whole object with store('ct.prefs', prefs). (Round 5 item 176)
import { store } from './util.js';

/** @type {Record<string, any>} */
export const prefs = store('ct.prefs') || {};
