import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";

/**
 * Electron's main process is deliberately thin. The controller (devices,
 * broker, scheduler, db) is a SEPARATE OS-managed service — not here. This
 * process only owns the native window and chrome; the renderer talks to the
 * controller directly over HTTP + WebSocket.
 */

interface BleDevice {
  deviceId: string;
  deviceName: string;
}

let mainWin: BrowserWindow | null = null;
let bleCallback: ((deviceId: string) => void) | null = null;
let bleDevices: BleDevice[] = [];

// BLE IPC — registered once at module level (not per-window)
ipcMain.handle("ble:get-devices", () => bleDevices);

ipcMain.on("ble:select-device", (_e, deviceId: string) => {
  bleCallback?.(deviceId);
  bleCallback = null;
});

ipcMain.on("ble:cancel", () => {
  bleCallback?.("");
  bleCallback = null;
  bleDevices = [];
});

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 832,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: "#0d1117",
    // Native traffic lights on macOS; frameless elsewhere (renderer draws controls).
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const }
      : { frame: false }),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWin = win;
  win.on("closed", () => { mainWin = null; });
  win.on("ready-to-show", () => win.show());

  // Window controls for the custom titlebar.
  ipcMain.on("window:minimize", () => win.minimize());
  ipcMain.on("window:toggle-maximize", () =>
    win.isMaximized() ? win.unmaximize() : win.maximize(),
  );
  ipcMain.on("window:close", () => win.close());

  // BLE scanning: intercept native device chooser so the renderer can show its own UI.
  win.webContents.on("select-bluetooth-device", (event, deviceList, callback) => {
    event.preventDefault();
    bleDevices = deviceList.map((d) => ({ deviceId: d.deviceId, deviceName: d.deviceName }));
    bleCallback = callback;
    win.webContents.send("ble:devices-updated", bleDevices);
  });

  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

void app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
