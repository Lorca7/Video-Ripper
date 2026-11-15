const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (callback) => {
  ipcRenderer.removeAllListeners(channel);
  ipcRenderer.on(channel, (_e, payload) => callback(payload));
};

contextBridge.exposeInMainWorld('ripper', {
  download: (url, quality) => ipcRenderer.invoke('download', { url, quality }),
  cancelDownload: () => ipcRenderer.invoke('cancel-download'),
  openFile: () => ipcRenderer.invoke('open-file'),
  updateDownloader: () => ipcRenderer.invoke('update-downloader'),
  exportClip: (job) => ipcRenderer.invoke('export', job),
  cancelExport: () => ipcRenderer.invoke('cancel-export'),
  reveal: (file) => ipcRenderer.invoke('reveal', file),
  onDownloadProgress: on('download-progress'),
  onExportProgress: on('export-progress'),
});
