# Provisional hardware notes

These notes are a starting point only. Confirm the exact ESP32 board, IMU, GPS module, pinout, logic levels, and power requirements from their manufacturer documentation before connecting or powering hardware. The PlatformIO `esp32dev` target is common but is not confirmation of the board in hand.

## Provisional ESP32 and MPU6050 wiring

The firmware currently uses the following conventional ESP32 DevKit defaults:

| MPU6050 breakout | ESP32 DevKit (provisional) |
| --- | --- |
| SDA | GPIO 21 |
| SCL | GPIO 22 |
| GND | GND |
| VCC | A voltage explicitly supported by the breakout |

The I2C pins are configurable in `firmware/include/config.h`. Check the board pinout and ensure the breakout's I2C pull-ups do not expose ESP32 pins to 5 V. Many MPU6050 chips use 3.3 V logic; breakout boards differ in regulators and level shifting, so do not assume every board accepts 5 V.

## Provisional GPS UART

The firmware configures UART1 with ESP32 RX on GPIO 16, ESP32 TX on GPIO 17, and a provisional baud rate of 9600. These values are in `firmware/include/config.h` and must be checked against the selected ESP32 board and GPS module.

For a UART connection, GPS TX connects to ESP32 RX, GPS RX connects to ESP32 TX when the module requires incoming configuration, and grounds must be common. Confirm the GPS module's supply voltage, UART logic level, default baud rate, and pin labels before wiring. Firmware reports a location only when actual incoming GPS data yields a valid, recent fix; it does not generate placeholder coordinates.

## Mounting, axes, and calibration

Secure the IMU firmly to the vehicle so its orientation does not shift during a trip. Record which sensor axis points in each physical direction for the chosen mounting. Do not assume the Y axis (or any single axis) is vertical. Measure the installed orientation and calibrate offsets and gravity direction before using acceleration to reason about road events. Keep the installation clear of moving parts and avoid interfering with vehicle controls or safety systems.

## Voltage and power precautions

- Disconnect power before changing wiring.
- Verify ESP32 GPIO voltage limits and the sensor/GPS board's specified supply and logic voltages.
- Do not connect a 5 V UART or I2C signal directly to an ESP32 GPIO unless suitable level shifting is confirmed.
- Use a stable, correctly rated supply; do not power a module from a pin beyond that pin's documented current rating.
- Check polarity and ground connections before power-up. Stop if board labels or electrical specifications are unclear.

The wiring above is provisional and must be verified before powering or flashing the device.
