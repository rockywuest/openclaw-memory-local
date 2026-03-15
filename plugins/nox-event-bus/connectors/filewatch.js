"use strict";
/**
 * filewatch.js — File Sensor Connector
 *
 * Watches memory/ directory for changes.
 * Emits sensor.file events when .md files are created or modified.
 */

const fs = require("fs");
const path = require("path");

class FileWatchConnector {
  constructor(workspaceRoot, eventBus) {
    this.workspaceRoot = workspaceRoot;
    this.eventBus = eventBus;
    this.watchDir = path.join(workspaceRoot, "memory");
    this.watcher = null;
    this.fileStates = new Map(); // path -> lastModified
  }

  /**
   * Start watching.
   */
  start() {
    if (!fs.existsSync(this.watchDir)) {
      console.log(`[filewatch] Watch dir does not exist: ${this.watchDir}`);
      return;
    }

    try {
      // Try fs.watch first (more efficient)
      this.watcher = fs.watch(this.watchDir, { recursive: true }, (eventType, filename) => {
        if (filename && filename.endsWith(".md")) {
          this.handleFileChange(filename);
        }
      });
      console.log(`[filewatch] Started watching: ${this.watchDir}`);
    } catch (err) {
      console.log(`[filewatch] fs.watch failed, falling back to polling: ${err.message}`);
      this.startPolling();
    }
  }

  /**
   * Fallback: polling-based file monitoring.
   */
  startPolling() {
    const pollInterval = 60000; // 1 minute

    const scan = () => {
      this.scanDirectory(this.watchDir);
    };

    scan(); // Initial scan
    this.pollingTimer = setInterval(scan, pollInterval);
    console.log(`[filewatch] Polling started (${pollInterval}ms)`);
  }

  /**
   * Recursively scan directory for .md files.
   */
  scanDirectory(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          this.scanDirectory(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          const stats = fs.statSync(fullPath);
          const lastModified = stats.mtimeMs;
          const relativePath = path.relative(this.workspaceRoot, fullPath);

          if (!this.fileStates.has(relativePath)) {
            // New file
            this.emitFileEvent(relativePath, "created", lastModified);
            this.fileStates.set(relativePath, lastModified);
          } else if (this.fileStates.get(relativePath) < lastModified) {
            // Modified file
            this.emitFileEvent(relativePath, "modified", lastModified);
            this.fileStates.set(relativePath, lastModified);
          }
        }
      }
    } catch (err) {
      console.error(`[filewatch] Scan error: ${err.message}`);
    }
  }

  /**
   * Handle file change (from fs.watch).
   */
  handleFileChange(filename) {
    const fullPath = path.join(this.watchDir, filename);
    
    if (!fs.existsSync(fullPath)) return; // File deleted or moved

    try {
      const stats = fs.statSync(fullPath);
      const lastModified = stats.mtimeMs;
      const relativePath = path.relative(this.workspaceRoot, fullPath);

      if (!this.fileStates.has(relativePath)) {
        this.emitFileEvent(relativePath, "created", lastModified);
      } else if (this.fileStates.get(relativePath) < lastModified) {
        this.emitFileEvent(relativePath, "modified", lastModified);
      }

      this.fileStates.set(relativePath, lastModified);
    } catch (err) {
      console.error(`[filewatch] Error handling file change: ${err.message}`);
    }
  }

  /**
   * Emit file event to event bus.
   */
  emitFileEvent(filePath, changeType, lastModified) {
    if (!this.eventBus) return;

    const importance = filePath.includes("events/") ? 0.6 : 0.5;

    this.eventBus.emit("sensor.file", {
      source: "filewatch",
      importance,
      data: {
        file: filePath,
        change: changeType,
        timestamp: new Date(lastModified).toISOString(),
      },
      ttl_hours: 24, // File events expire after 24h
    });

    console.log(`[filewatch] ${changeType}: ${filePath}`);
  }

  /**
   * Stop watching.
   */
  stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    console.log("[filewatch] Stopped");
  }
}

module.exports = FileWatchConnector;
