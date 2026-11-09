const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = ['app:info', 'scan:all', 'scan:cancel', 'finding:act', 'ignored:reset', 'quarantine:list', 'quarantine:restore', 'quarantine:purge',
  'space:scan', 'space:review', 'space:trash', 'space:compress', 'space:replace', 'space:openOutput', 'space:addFolder', 'space:removeFolder', 'report:save', 'help:open', 'space:pending',
  'vault:status', 'vault:create', 'vault:unlock', 'vault:lock', 'vault:list', 'vault:addNote', 'vault:getNote', 'vault:deleteNote', 'vault:copy', 'vault:addFiles', 'vault:trashOriginals', 'vault:keepOriginals', 'vault:export', 'vault:removeFile',
  'ext:scan', 'ext:act', 'organize:state', 'organize:plan', 'organize:apply', 'organize:undo', 'weekly:get', 'weekly:set', 'update:get', 'update:check', 'update:install', 'update:setAuto'];
const EVENTS = ['progress', 'space:progress', 'update'];

contextBridge.exposeInMainWorld('api', {
  call: (ch, ...args) => INVOKE.includes(ch) ? ipcRenderer.invoke(ch, ...args) : Promise.reject(new Error('Неизвестный вызов')),
  on: (ch, cb) => { if (EVENTS.includes(ch)) ipcRenderer.on(ch, (_e, d) => cb(d)); }
});
