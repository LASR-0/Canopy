import { contextBridge, ipcRenderer } from "electron";

export interface BleDeviceInfo {
  deviceId: string;
  deviceName: string;
}

/** The native surface the UI needs: window controls, platform, and PDF export. */
const windowApi = {
  minimize: () => ipcRenderer.send("window:minimize"),
  toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
  close: () => ipcRenderer.send("window:close"),
  platform: process.platform,
  /** The page as it prints now, as PDF bytes. */
  renderPdf: (): Promise<Uint8Array> => ipcRenderer.invoke("pdf:render"),
  /** Ask where to save the PDF and write it. The path, or null when cancelled. */
  savePdf: (fileName: string, data: Uint8Array): Promise<string | null> =>
    ipcRenderer.invoke("pdf:save", fileName, data),
};

/** BLE provisioning: wraps the main-process device chooser interception. */
const bleApi = {
  getDevices: (): Promise<BleDeviceInfo[]> => ipcRenderer.invoke("ble:get-devices"),
  selectDevice: (deviceId: string): void => ipcRenderer.send("ble:select-device", deviceId),
  cancel: (): void => ipcRenderer.send("ble:cancel"),
  onDevicesUpdated: (cb: (devices: BleDeviceInfo[]) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, devices: BleDeviceInfo[]) => cb(devices);
    ipcRenderer.on("ble:devices-updated", handler);
    return () => ipcRenderer.off("ble:devices-updated", handler);
  },
};

contextBridge.exposeInMainWorld("canopyWindow", windowApi);
contextBridge.exposeInMainWorld("canopyBle", bleApi);

export type CanopyWindowApi = typeof windowApi;
export type CanopyBleApi = typeof bleApi;
