'use strict';
/**
 * system.js — System Sensor Connector
 *
 * Monitors system health: disk space, CPU, memory pressure.
 * Only emits sensor.system events when problems are detected.
 */

const fs = require('fs');
const { execSync } = require('child_process');

class SystemConnector {
  constructor(workspaceRoot, eventBus) {
    this.workspaceRoot = workspaceRoot;
    this.eventBus = eventBus;
    this.checkInterval = 5 * 60 * 1000; // 5 minutes
    this.timer = null;

    // Thresholds
    this.diskThreshold = 85; // % full
    this.cpuTempThreshold = 75; // °C
    this.memThreshold = 90; // % used
  }

  /**
   * Start monitoring.
   */
  start() {
    this.check(); // Initial check
    this.timer = setInterval(() => this.check(), this.checkInterval);
    console.log(`[system] Monitoring started (${this.checkInterval / 1000}s interval)`);
  }

  /**
   * Run system checks.
   */
  check() {
    this.checkDiskSpace();
    this.checkCPUTemp();
    this.checkMemory();
  }

  /**
   * Check disk space.
   */
  checkDiskSpace() {
    try {
      const output = execSync('df -h / | tail -1', { encoding: 'utf8' });
      const parts = output.trim().split(/\s+/);
      const usedPercent = parseInt(parts[4]); // "85%" -> 85

      if (usedPercent >= this.diskThreshold) {
        this.emitEvent(
          {
            type: 'disk_warning',
            message: `Disk usage critical: ${usedPercent}%`,
            value: usedPercent,
            threshold: this.diskThreshold
          },
          0.85
        );
      }
    } catch (err) {
      // Silently fail (not critical)
    }
  }

  /**
   * Check CPU temperature.
   */
  checkCPUTemp() {
    try {
      // Read /sys/class/thermal/thermal_zone0/temp (millidegrees Celsius)
      const tempPath = '/sys/class/thermal/thermal_zone0/temp';
      if (!fs.existsSync(tempPath)) return;

      const tempStr = fs.readFileSync(tempPath, 'utf8').trim();
      const temp = parseInt(tempStr) / 1000; // Convert to °C

      if (temp >= this.cpuTempThreshold) {
        this.emitEvent(
          {
            type: 'cpu_temp_warning',
            message: `CPU temperature high: ${temp.toFixed(1)}°C`,
            value: temp,
            threshold: this.cpuTempThreshold
          },
          0.8
        );
      }
    } catch (err) {
      // Silently fail
    }
  }

  /**
   * Check memory pressure.
   */
  checkMemory() {
    try {
      // Read /proc/meminfo
      const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
      const lines = meminfo.split('\n');

      let memTotal = 0;
      let memAvailable = 0;

      for (const line of lines) {
        if (line.startsWith('MemTotal:')) {
          memTotal = parseInt(line.split(/\s+/)[1]);
        } else if (line.startsWith('MemAvailable:')) {
          memAvailable = parseInt(line.split(/\s+/)[1]);
        }
      }

      if (memTotal > 0 && memAvailable > 0) {
        const usedPercent = ((memTotal - memAvailable) / memTotal) * 100;

        if (usedPercent >= this.memThreshold) {
          this.emitEvent(
            {
              type: 'memory_pressure',
              message: `Memory usage high: ${usedPercent.toFixed(1)}%`,
              value: usedPercent,
              threshold: this.memThreshold
            },
            0.75
          );
        }
      }
    } catch (err) {
      // Silently fail
    }
  }

  /**
   * Emit system event.
   */
  emitEvent(data, importance) {
    if (!this.eventBus) return;

    this.eventBus.emit('sensor.system', {
      source: 'system',
      importance,
      data,
      ttl_hours: 2 // System alerts expire quickly
    });

    console.log(`[system] ${data.type}: ${data.message}`);
  }

  /**
   * Stop monitoring.
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[system] Monitoring stopped');
  }
}

module.exports = SystemConnector;
