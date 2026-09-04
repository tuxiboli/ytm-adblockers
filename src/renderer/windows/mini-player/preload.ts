import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("miniPlayer", {
  playPause: () => ipcRenderer.send("miniPlayer:playPause"),
  next: () => ipcRenderer.send("miniPlayer:next"),
  previous: () => ipcRenderer.send("miniPlayer:previous"),
  toggleRepeat: () => ipcRenderer.send("miniPlayer:toggleRepeat"),
  toggleLike: () => ipcRenderer.send("miniPlayer:toggleLike"),
  toggleDislike: () => ipcRenderer.send("miniPlayer:toggleDislike"),
  setVolume: (volume: number) => ipcRenderer.send("miniPlayer:setVolume", volume),
  seekTo: (time: number) => ipcRenderer.send("miniPlayer:seekTo", time),
  openMain: () => ipcRenderer.send("miniPlayer:openMain"),
  close: () => ipcRenderer.send("miniPlayer:close"),
  playQueueIndex: (index: number) => ipcRenderer.send("miniPlayer:playQueueIndex", index),
  requestInitialData: () => ipcRenderer.send("miniPlayer:requestInitialData"),
  onTrackInfo: (callback: (event: Electron.IpcRendererEvent, data: any) => void) =>
    ipcRenderer.on("miniPlayer:trackInfo", callback),
  onPlayerState: (callback: (event: Electron.IpcRendererEvent, state: any) => void) =>
    ipcRenderer.on("miniPlayer:playerState", callback),
  onRepeatChange: (callback: (event: Electron.IpcRendererEvent, repeatMode: string) => void) =>
    ipcRenderer.on("miniPlayer:repeatChange", callback),
  onQueueUpdate: (callback: (event: Electron.IpcRendererEvent, queue: any[]) => void) =>
    ipcRenderer.on("miniPlayer:queueUpdate", callback),
  onVolumeChange: (callback: (event: Electron.IpcRendererEvent, volume: number) => void) =>
    ipcRenderer.on("miniPlayer:volumeChange", callback)
});
