import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Electron's main process is deliberately thin. The controller (devices,
 * broker, scheduler, db) is a SEPARATE OS-managed service — not here. This
 * process only owns the native window and chrome; the renderer talks to the
 * controller directly over HTTP + WebSocket.
 */

/**
 * HiDPI under WSLg.
 *
 * WSLg does not propagate Windows' display scaling to Linux clients: on a 4K
 * panel it reports 3840x2160 at scaleFactor 1, so the UI renders at 1x and
 * looks tiny, while the cursor (drawn by the Windows RDP client at Windows'
 * own scaling) looks oversized next to it. Native Windows and macOS builds
 * report their scale factor correctly and must NOT be overridden, so this is
 * opt-in via env rather than a platform default.
 *
 *   CANOPY_UI_SCALE=2 pnpm dev
 */
const uiScale = process.env["CANOPY_UI_SCALE"];
if (uiScale && Number.isFinite(Number(uiScale)) && Number(uiScale) > 0) {
  app.commandLine.appendSwitch("force-device-scale-factor", uiScale);
}

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
    // The smallest window every page is laid out for. 1100 leaves the content
    // area about 850 px beside the sidebar, which the two-column pages (Setup
    // View's plan and panels, Target ranges' stage matrix) need; 700 tall fits
    // a 1366 × 768 laptop screen with its taskbar.
    minWidth: 1100,
    minHeight: 700,
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

  // PDF export, in two steps so the page can leave its print state (light
  // theme, every photo shown) before the save dialog opens: render, then save.
  ipcMain.handle("pdf:render", () =>
    win.webContents.printToPDF({ printBackground: true, pageSize: "A4", margins: { marginType: "default" } }),
  );
  ipcMain.handle("pdf:save", async (_e, fileName: string, data: Uint8Array) => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: join(app.getPath("documents"), fileName),
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (canceled || !filePath) return null;
    await writeFile(filePath, data);
    return filePath;
  });

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
