import os from "node:os";
import { execSync } from "node:child_process";
import chalk from "chalk";
import readline from "node:readline";

let oldCpus = os.cpus();
let oldNetStats = getNetworkStats();
let scrollOffset = 0;
let contentLines = [];

// Setup readline for keyboard input
readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}

process.stdin.on("keypress", (str, key) => {
  if (key.ctrl && key.name === "c") {
    process.exit();
  } else if (key.name === "up" || key.name === "k") {
    scrollOffset = Math.max(0, scrollOffset - 1);
  } else if (key.name === "down" || key.name === "j") {
    const maxScroll = Math.max(0, contentLines.length - process.stdout.rows + 1);
    scrollOffset = Math.min(maxScroll, scrollOffset + 1);
  } else if (key.name === "pageup") {
    scrollOffset = Math.max(0, scrollOffset - 10);
  } else if (key.name === "pagedown") {
    const maxScroll = Math.max(0, contentLines.length - process.stdout.rows + 1);
    scrollOffset = Math.min(maxScroll, scrollOffset + 10);
  } else if (key.name === "home") {
    scrollOffset = 0;
  } else if (key.name === "end") {
    scrollOffset = Math.max(0, contentLines.length - process.stdout.rows + 1);
  }
});

function getNetworkStats() {
  try {
    const stats = execSync("cat /proc/net/dev", { encoding: "utf8" });
    const lines = stats.split("\n").slice(2);
    let totalRx = 0,
      totalTx = 0;

    lines.forEach((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length > 9 && parts[0] !== "lo:") {
        totalRx += parseInt(parts[1]) || 0;
        totalTx += parseInt(parts[9]) || 0;
      }
    });

    return { rx: totalRx, tx: totalTx, timestamp: Date.now() };
  } catch {
    return { rx: 0, tx: 0, timestamp: Date.now() };
  }
}

function getDiskUsage() {
  try {
    const output = execSync("df -h / | tail -1", { encoding: "utf8" });
    const parts = output.trim().split(/\s+/);
    return {
      total: parts[1],
      used: parts[2],
      available: parts[3],
      percent: parseInt(parts[4]),
    };
  } catch {
    return { total: "N/A", used: "N/A", available: "N/A", percent: 0 };
  }
}

function getTopProcesses() {
  try {
    const output = execSync("ps aux --sort=-%cpu | head -6 | tail -5", { encoding: "utf8" });
    return output
      .trim()
      .split("\n")
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        return {
          user: parts[0],
          cpu: parseFloat(parts[2]).toFixed(1) + "%",
          mem: parseFloat(parts[3]).toFixed(1) + "%",
          command: parts.slice(10).join(" ").substring(0, 30),
        };
      });
  } catch {
    return [];
  }
}

function getLoadAverage() {
  const loads = os.loadavg();
  return {
    "1min": loads[0].toFixed(2),
    "5min": loads[1].toFixed(2),
    "15min": loads[2].toFixed(2),
  };
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B/s";
  const k = 1024;
  const sizes = ["B/s", "KB/s", "MB/s", "GB/s"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function calculateCpu(oldCpu, newCpu) {
  const oldTotal = Object.values(oldCpu.times).reduce((a, b) => a + b, 0);
  const newTotal = Object.values(newCpu.times).reduce((a, b) => a + b, 0);
  const total = newTotal - oldTotal;
  const idle = newCpu.times.idle - oldCpu.times.idle;
  const used = total - idle;
  return ((used / total) * 100).toFixed(1);
}

function getColorForPercentage(percent) {
  if (percent < 50) return chalk.greenBright;
  if (percent < 75) return chalk.yellowBright;
  return chalk.redBright;
}

function drawProgressBar(percent, width = 30) {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const color = getColorForPercentage(percent);
  return color("█".repeat(filled)) + chalk.gray("░".repeat(empty));
}

let firstRun = true;

// Hide cursor and use alternate screen buffer
process.stdout.write("\x1b[?25l"); // Hide cursor
process.stdout.write("\x1b[?1049h"); // Enable alternate buffer

// Cleanup on exit
process.on("exit", () => {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  process.stdout.write("\x1b[?25h"); // Show cursor
  process.stdout.write("\x1b[?1049l"); // Disable alternate buffer
});

process.on("SIGINT", () => {
  process.exit();
});

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function monitor() {
  let output = "";

  // Header
  output += chalk.cyan.bold(
    "\n╔═══════════════════════════════════════════════════════════════╗\n",
  );
  output +=
    chalk.cyan.bold("║") +
    chalk.white.bold("              SYSTEM MONITOR - LIVE STATS                  ") +
    chalk.cyan.bold("║\n");
  output += chalk.cyan.bold(
    "╚═══════════════════════════════════════════════════════════════╝\n\n",
  );

  // System Info
  output += chalk.magenta.bold("🖥️  SYSTEM: ") + chalk.white(os.type() + " " + os.release()) + "\n";
  output +=
    chalk.magenta.bold("⏱️  UPTIME: ") +
    chalk.white(
      Math.floor(os.uptime() / 3600) + "h " + Math.floor((os.uptime() % 3600) / 60) + "m",
    ) +
    "\n";
  output += chalk.magenta.bold("🏠 HOST:   ") + chalk.white(os.hostname()) + "\n\n";

  // CPU Usage
  output += chalk.yellow.bold("┌─ CPU USAGE ─────────────────────────────────────────┐\n");
  const newCpus = os.cpus();
  const cpuModel = newCpus[0].model;
  output += chalk.gray(`  Model: ${cpuModel.substring(0, 45)}...\n`);

  newCpus.forEach((cpu, idx) => {
    const usage = parseFloat(calculateCpu(oldCpus[idx], cpu));
    const bar = drawProgressBar(usage, 25);
    const color = getColorForPercentage(usage);
    output += `  Core ${idx.toString().padStart(2)}: ${bar} ${color(
      usage.toFixed(1).padStart(5),
    )}%\n`;
  });

  const avgCpu =
    newCpus.reduce((sum, cpu, idx) => sum + parseFloat(calculateCpu(oldCpus[idx], cpu)), 0) /
    newCpus.length;

  output += chalk.yellow(`  Average: ${getColorForPercentage(avgCpu)(avgCpu.toFixed(1))}%\n`);

  oldCpus = newCpus;

  // Load Average
  const loads = getLoadAverage();
  output += chalk.gray(
    `  Load Avg: ${loads["1min"]} (1m) | ${loads["5min"]} (5m) | ${loads["15min"]} (15m)\n`,
  );
  output += chalk.yellow.bold("└─────────────────────────────────────────────────────┘\n\n");

  // Memory Usage
  output += chalk.green.bold("┌─ MEMORY USAGE ──────────────────────────────────────┐\n");
  const totalMem = os.totalmem() / 1024 ** 3;
  const freeMem = os.freemem() / 1024 ** 3;
  const usedMem = totalMem - freeMem;
  const memPercent = (usedMem / totalMem) * 100;

  output += `  Total:     ${chalk.white(totalMem.toFixed(2))} GB\n`;
  output += `  Used:      ${getColorForPercentage(memPercent)(usedMem.toFixed(2))} GB\n`;
  output += `  Free:      ${chalk.white(freeMem.toFixed(2))} GB\n`;
  output += `  ${drawProgressBar(memPercent, 40)} ${getColorForPercentage(memPercent)(
    memPercent.toFixed(1),
  )}%\n`;
  output += chalk.green.bold("└─────────────────────────────────────────────────────┘\n\n");

  // Disk Usage
  output += chalk.blue.bold("┌─ DISK USAGE (/) ────────────────────────────────────┐\n");
  const disk = getDiskUsage();
  output += `  Total:     ${chalk.white(disk.total)}\n`;
  output += `  Used:      ${getColorForPercentage(disk.percent)(disk.used)}\n`;
  output += `  Available: ${chalk.white(disk.available)}\n`;
  output += `  ${drawProgressBar(disk.percent, 40)} ${getColorForPercentage(disk.percent)(
    disk.percent,
  )}%\n`;
  output += chalk.blue.bold("└─────────────────────────────────────────────────────┘\n\n");

  // Network Stats
  const newNetStats = getNetworkStats();
  const timeDiff = (newNetStats.timestamp - oldNetStats.timestamp) / 1000;
  const rxSpeed = (newNetStats.rx - oldNetStats.rx) / timeDiff;
  const txSpeed = (newNetStats.tx - oldNetStats.tx) / timeDiff;

  output += chalk.cyan.bold("┌─ NETWORK STATS ─────────────────────────────────────┐\n");
  output += `  Download: ${chalk.greenBright("↓")} ${chalk.white(formatBytes(rxSpeed))}\n`;
  output += `  Upload:   ${chalk.redBright("↑")} ${chalk.white(formatBytes(txSpeed))}\n`;
  output += chalk.cyan.bold("└─────────────────────────────────────────────────────┘\n\n");

  oldNetStats = newNetStats;

  // Top Processes
  output += chalk.magenta.bold("┌─ TOP PROCESSES (CPU) ───────────────────────────────┐\n");
  const processes = getTopProcesses();
  if (processes.length > 0) {
    processes.forEach((proc) => {
      output += `  ${chalk.yellow(proc.cpu.padEnd(6))} ${chalk.green(
        proc.mem.padEnd(6),
      )} ${chalk.white(proc.command)}\n`;
    });
  } else {
    output += chalk.gray("  No process data available\n");
  }
  output += chalk.magenta.bold("└─────────────────────────────────────────────────────┘\n\n");

  // Footer
  const maxScroll = Math.max(0, contentLines.length - process.stdout.rows + 1);
  const scrollIndicator =
    contentLines.length > process.stdout.rows
      ? chalk.yellow(` [Scroll: ${scrollOffset}/${maxScroll}]`)
      : "";
  output += chalk.gray(
    `  ↑↓/j/k: Scroll | PgUp/PgDn: Fast scroll | Home/End | Ctrl+C: Exit${scrollIndicator}\n`,
  );

  // Split output into lines and store for scrolling
  contentLines = output.split("\n");

  // Calculate visible window
  const terminalHeight = process.stdout.rows || 40;
  const visibleLines = contentLines.slice(scrollOffset, scrollOffset + terminalHeight);

  // Write visible portion
  process.stdout.write("\x1b[H"); // Move to top
  process.stdout.write(visibleLines.join("\n"));
}

// Initial run
monitor();
setInterval(monitor, 1000);
