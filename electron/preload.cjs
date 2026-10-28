const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('pimplay', {
  library: {
    list: invoke('library:list'),
    refresh: invoke('library:refresh'),
    addCustom: invoke('library:addCustom'),
    removeCustom: invoke('library:removeCustom'),
    favorite: invoke('library:favorite'),
    hide: invoke('library:hide'),
    owned: invoke('library:owned'),
    install: invoke('library:install'),
  },
  meta: {
    search: invoke('meta:search'),
    link: invoke('meta:link'),
    unlink: invoke('meta:unlink'),
    rename: invoke('meta:rename'),
    setImage: invoke('meta:setImage'),
    clearImage: invoke('meta:clearImage'),
    setHeroPosition: invoke('meta:setHeroPosition'),
  },
  game: {
    launch: invoke('game:launch'),
    launchState: invoke('launch:state'),
    stop: invoke('game:stop'),
    openFolder: invoke('game:openFolder'),
  },
  trainer: {
    get: invoke('trainer:get'),
    save: invoke('trainer:save'),
    import: invoke('trainer:import'),
    export: invoke('trainer:export'),
  },
  session: {
    activate: invoke('session:activate'),
    deactivate: invoke('session:deactivate'),
    state: invoke('session:state'),
  },
  cheat: {
    toggle: invoke('cheat:toggle'),
    setValue: invoke('cheat:setValue'),
    trigger: invoke('cheat:trigger'),
  },
  process: { list: invoke('process:list') },
  stats: { sessions: invoke('stats:sessions'), lifetime: invoke('stats:lifetime') },
  steam: {
    account: invoke('steam:account'),
    refresh: invoke('steam:refresh'),
    login: invoke('steam:login'),
    logout: invoke('steam:logout'),
  },
  epic: {
    account: invoke('epic:account'),
    refresh: invoke('epic:refresh'),
    login: invoke('epic:login'),
    logout: invoke('epic:logout'),
    freeGames: invoke('epic:freeGames'),
    openStore: invoke('epic:openStore'),
  },
  gog: {
    account: invoke('gog:account'),
    refresh: invoke('gog:refresh'),
    login: invoke('gog:login'),
    logout: invoke('gog:logout'),
    browserLogin: invoke('gog:browserLogin'),
    submitCode: invoke('gog:submitCode'),
  },
  scanner: {
    attach: invoke('scanner:attach'),
    first: invoke('scanner:first'),
    next: invoke('scanner:next'),
    cancel: invoke('scanner:cancel'),
    reset: invoke('scanner:reset'),
    results: invoke('scanner:results'),
    write: invoke('scanner:write'),
    writeAll: invoke('scanner:writeAll'),
  },
  watch: {
    start: invoke('watch:start'),
    stop: invoke('watch:stop'),
    patch: invoke('watch:patch'),
  },
  settings: { get: invoke('settings:get'), set: invoke('settings:set') },
  update: { state: invoke('update:state'), check: invoke('update:check'), install: invoke('update:install') },
  app: { openData: invoke('app:openData'), info: invoke('app:info'), closeChoice: invoke('app:closeChoice'), fullscreen: invoke('app:fullscreen') },
  on(channel, cb) {
    const allowed = ['session', 'running', 'hotkey', 'scanner:progress', 'watch:update', 'library', 'launch', 'close-request', 'sessions', 'steam', 'epic', 'gog', 'update'];
    if (!allowed.includes(channel)) throw new Error(`Canal non autorisé : ${channel}`);
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
