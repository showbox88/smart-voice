const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  onStartRecording: (cb) => ipcRenderer.on("start-recording", cb),
  onStopRecording: (cb) => ipcRenderer.on("stop-recording", cb),
  onSetState: (cb) => ipcRenderer.on("set-state", (_e, state) => cb(state)),
  transcribeAndPaste: (arrayBuffer) => ipcRenderer.invoke("transcribe-and-paste", arrayBuffer),
});
