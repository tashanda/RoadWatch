# RoadWatch

RoadWatch is a hardware-first pothole reporting prototype. Phase 1 provides an ESP32 firmware foundation, a minimal FastAPI health endpoint, and a Next.js landing page. It does not yet classify road events or display a map.

## Repository layout

- `firmware/` — PlatformIO ESP32 firmware
- `backend/` — FastAPI service
- `frontend/` — Next.js application
- `data/` — local, untracked data files
- `docs/` — hardware notes and safety guidance

## Prerequisites on Windows

1. Install [Visual Studio Code](https://code.visualstudio.com/), then use **File > Open Folder...** to open this `RoadWatch` folder.
2. Install the **PlatformIO IDE** extension in VS Code. PlatformIO will install its toolchain and libraries the first time you build.
3. Install Python 3.10 or newer and Node.js 18 or newer. Confirm in a new VS Code PowerShell terminal:

   ```powershell
   python --version
   node --version
   npm --version
   ```

4. Before connecting or flashing hardware, identify the exact ESP32 board and sensor/GPS models. `esp32dev`, the pin assignments, and peripheral settings in this starter are provisional; verify them against your hardware.

## Firmware: build, upload, and monitor

In VS Code, open the PlatformIO sidebar, choose **Open Project**, and select this repository's `firmware` folder. Use the PlatformIO **Build** action to compile. Alternatively, open a PowerShell terminal in `firmware` if PlatformIO Core CLI is installed and available on `PATH`:

```powershell
cd firmware
pio run
```

Only after verifying the exact board, wiring, and selected PlatformIO environment, connect the ESP32 and use the PlatformIO **Upload** action. The equivalent CLI commands are:

```powershell
pio run -t upload
pio device monitor
```

The monitor uses **460800 baud** to accommodate newline-delimited readings near 100 Hz. Firmware samples the MPU6050 at approximately 100 Hz and prints one JSON object per sample; `timestamp_ms` is elapsed milliseconds since boot, not UTC time. GPS values are `null` until TinyGPSPlus receives a valid, recent fix from actual GPS UART data. No fix is simulated. Sensor initialization and hardware compatibility require physical verification.

## Backend: install and run

From the repository root in PowerShell:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

If PowerShell blocks activation, use the venv interpreter directly instead:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

Check `http://127.0.0.1:8000/health` or the interactive API docs at `http://127.0.0.1:8000/docs`.

## Frontend: install and run

Open another VS Code PowerShell terminal from the repository root:

```powershell
cd frontend
npm install
npm run dev
```

Visit `http://localhost:3000`. To make a production build, run `npm run build` in `frontend`.

## Hardware and configuration

Review [`docs/hardware.md`](docs/hardware.md) before wiring anything. Provisional firmware pin and UART settings live in `firmware/include/config.h`; the MPU6050 implementation is isolated behind `firmware/include/imu.h`. Do not assume an axis is vertical—mounting orientation must be measured and calibrated.

No secrets or external service credentials are needed in this phase, so environment files are not required. Do not commit local credentials or collected data.
