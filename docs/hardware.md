# Hardware notes

The confirmed motion sensor is the BNO055. The confirmed I2C wiring is SDA on
ESP32 GPIO 25, SCL on GPIO 33, and BNO055 address `0x28`. GPS UART pins and
electrical details still depend on the exact GPS module and board; verify its
power, logic levels, pin labels, and baud rate before connecting it.

## BNO055 connection and mounting

| BNO055 breakout | ESP32 DevKit V1 |
| --- | --- |
| SDA | GPIO 25 |
| SCL | GPIO 33 |
| GND | GND |
| VIN/VCC | Use only a voltage supported by the exact breakout |

Disconnect power before changing wiring. Confirm the breakout's I2C pull-ups
and logic levels; do not expose ESP32 GPIO pins to 5 V. The firmware uses the
Adafruit BNO055 library at address `0x28`. Address selection is configurable as
`ROADWATCH_BNO055_ADDRESS` in the local firmware secrets header.

Attach the sensor rigidly to the vehicle's sprung chassis so it cannot shift.
Record its position and orientation. The detector uses BNO055 linear
acceleration (gravity compensated) and its quaternion to rotate acceleration
from sensor coordinates into the world vertical axis; it does not assume the
sensor's Z axis points upward. Mounting location still affects the measured
vibration and requires physical calibration. Avoid placing the unit where it
could interfere with vehicle controls, airbags, or other safety equipment.

The sensor must be calibrated while stationary before interpreting readings.
Keep the ESP32 level and still during startup, then follow the BNO055
calibration procedure for accelerometer and gyroscope calibration. The
detector currently requires accelerometer and gyroscope calibration levels
of at least 2 and a valid quaternion. Serial calibration values are diagnostic
only; they are not proof that the installed sensor is correctly aligned or
calibrated.

## GPS and timestamps

The firmware currently configures GPS UART1 with ESP32 RX on GPIO 16, ESP32 TX
on GPIO 17, and 9600 baud. Verify these provisional GPS settings against the
actual module before wiring. GPS TX connects to ESP32 RX; connect GPS RX to
ESP32 TX only if the module needs incoming configuration. Grounds must be
common. Location is included only for a valid, recent GPS fix. Missing GPS is
represented by null coordinates; the firmware never substitutes test or
placeholder coordinates.

Event timestamps use UTC from NTP when available. If NTP has not synchronized
yet, the uploader retains the event in RAM and estimates its original time
from elapsed device uptime after synchronization. A device reboot before
delivery loses that in-memory event.

## Detection and calibration

The detector is a configurable candidate rule, not a validated pothole
classifier. It filters BNO055 linear acceleration, projects it onto world
vertical, and looks for a sharp impact followed by an opposite-direction
rebound within a configured time window. Jerk, short-window vibration, and
gyroscope magnitude provide additional support. A cooldown suppresses
repeated candidates.

Defaults in `firmware/include/pothole_detector.h` are an impact threshold of
4.5 m/s², rebound threshold of 1.25 m/s², minimum jerk of 35 m/s³, rebound
window of 20–450 ms, and a 3-second cooldown. Severity is an estimated
impact-magnitude band. These values are starting points only: smooth roads,
rough pavement, vehicle suspension, mounting, speed, and speed bumps can all
cause false positives or missed events. The firmware does not claim it can
reliably distinguish potholes from speed bumps.

For calibration/debug output, set `ROADWATCH_DETECTOR_DEBUG` to `1` in
`firmware/include/secrets.h` and open the serial monitor at 460800 baud. The
newline-delimited JSON samples include linear acceleration, gyro, orientation,
calibration, filtered vertical acceleration, jerk, vibration RMS, candidate
state, and GPS validity. Collect data on controlled, known routes with the
vehicle parked before changing thresholds. Do not tune while driving or rely
on the detector as a safety system.

Synthetic tests cover smooth roads, rough-road vibration, a pothole-like
impact/rebound, a broad speed-bump profile, sensor rotation, and cooldown.
They validate rule behavior only; physical sensor data and real-world
validation are still required.

## Wi-Fi event uploads

The HTTPS uploader sends events to the same-origin Vercel endpoint
`/api/device-events` using a separate FreeRTOS task, so connection and request
waits do not run in the sensor sampling loop. It uses certificate validation,
a shared device token, stable UUIDs across retries, bounded exponential
backoff, and a 30-second delay before retrying an event that exhausts a retry
batch. Failed events remain in a small RAM queue; a power loss, queue
saturation, or prolonged outage can still lose detections.

Copy `firmware/include/secrets.example.h` to the ignored
`firmware/include/secrets.h`. Configure the Wi-Fi SSID/password, HTTPS Vercel
origin, `ROADWATCH_DEVICE_TOKEN`, and the trusted root CA certificate. The
token must match the private Vercel environment variable. A phone hotspot or
regular Wi-Fi network can be used, but internet access is not guaranteed while
driving. Do not assume events can upload in real time.
