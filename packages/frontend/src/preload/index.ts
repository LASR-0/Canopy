import { contextBridge, ipcRenderer } from "electron";

export interface BleDeviceInfo {
  deviceId: string;
  deviceName: string;
}

/** The only native surface the UI needs right now: window controls + platform. */
const windowApi = {
  minimize: () => ipcRenderer.send("window:minimize"),
  toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
  close: () => ipcRenderer.send("window:close"),
  platform: process.platform,
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
