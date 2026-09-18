/**
 * `daemon` CLI subcommand (FEAT-DAEMON-001).
 *
 * Turns the local-memory-mcp combined server (dashboard + MCP Streamable HTTP
 * on ONE loopback port) into a true background daemon:
 *
 *   daemon            → fork the worker detached, write its PID, print, exit
 *   daemon stop       → SIGTERM the PID from the file, delete it, print
 *   daemon status     → print "running (pid N)" or "not running"
 *   daemon install    → register the worker with the OS service manager
 *   daemon uninstall  → deregister it again
 *
 * `install`/`uninstall` are cross-platform (FEAT-DAEMON-001 extension):
 *   - Linux   → systemd user unit (`systemctl --user`), cron `@reboot` fallback
 *   - macOS   → launchd LaunchAgent plist (`launchctl`), manual hint fallback
 *   - Windows → Task Scheduler (`schtasks.exe`), Startup-folder hint fallback
 * All three register an absolute command so the service survives a reboot.
 *
 * The parent NEVER keeps the worker attached: the worker is spawned with
 * `detached: true`, its stdout/stderr redirected to the daemon log file, then
 * `unref()`ed so the parent can exit and the terminal returns to the prompt.
 * The worker itself is re-entered through `--daemon-worker`
 * (see {@link ../cli/combined-server}).
 *
 * PID / log location: alongside the memory database (see
 * {@link resolveDaemonDir}), i.e. `~/.config/local-memory-mcp/daemon.pid` and
 * `~/.config/local-memory-mcp/daemon.log` on Linux. `MEMORY_DB_PATH` (used by
 * tests) and `LOCAL_MEMORY_DAEMON_DIR` relocate both.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";

/** Absolute paths the daemon manages. */
export interface DaemonPaths {
	/** Config directory (same dir as memory.db). */
	dir: string;
	/** PID file path. */
	pidFile: string;
	/** Worker stdout+stderr log file path. */
	logFile: string;
}

/** Outcome of {@link startDaemon}. */
export interface StartDaemonResult {
	/** Whether a new worker was forked. `false` when one was already running. */
	started: boolean;
	/** PID of the running/forked worker. */
	pid: number;
}

/** Outcome of {@link stopDaemon}. */
export interface StopDaemonResult {
	/** Whether a live process was signalled. */
	stopped: boolean;
	/** PID that was targeted, when a PID file existed. */
	pid?: number;
}

/** Outcome of {@link statusDaemon}. */
export interface StatusDaemonResult {
	running: boolean;
	pid: number | null;
}

/** Injectable seams (all default to the real process/filesystem). */
export interface DaemonIo {
	log: (message: string) => void;
	spawnFn: typeof spawn;
	kill: (pid: number, signal: NodeJS.Signals) => void;
	isAlive: (pid: number) => boolean;
	execPath: string;
	workerArg: string;
}

function defaultIo(): DaemonIo {
	return {
		log: (message) => process.stdout.write(`${message}\n`),
		spawnFn: spawn,
		kill: (pid, signal) => process.kill(pid, signal),
		isAlive: isProcessAlive,
		execPath: process.execPath,
		// process.argv[1] is the bin entry (bin/mcp-memory-server.js) that
		// re-imports dist/mcp/server.js. Re-exec'ing it with `--daemon-worker`
		// re-enters this module's worker branch.
		workerArg: process.argv[1] ?? ""
	};
}

/**
 * Resolve the daemon config directory.
 *
 * Mirrors `SQLiteStore`'s DB-path resolution so the PID/log files always sit
 * next to `memory.db`. An explicit `LOCAL_MEMORY_DAEMON_DIR` wins; otherwise a
 * non-memory `MEMORY_DB_PATH` contributes its directory, and finally the
 * platform-standard config dir is used (Linux `~/.config/local-memory-mcp`).
 */
export function resolveDaemonDir(env: NodeJS.ProcessEnv = process.env): string {
	const explicit = env.LOCAL_MEMORY_DAEMON_DIR?.trim();
	if (explicit) return explicit;

	const dbPath = env.MEMORY_DB_PATH?.trim();
	if (dbPath && dbPath !== ":memory:") return path.dirname(dbPath);

	if (process.platform === "win32") return path.join(os.homedir(), ".local-memory-mcp");
	if (process.platform === "darwin") {
		return path.join(os.homedir(), "Library", "Application Support", "local-memory-mcp");
	}
	return path.join(os.homedir(), ".config", "local-memory-mcp");
}

/** Resolve the PID + log file paths for the daemon. */
export function resolveDaemonPaths(env: NodeJS.ProcessEnv = process.env): DaemonPaths {
	const dir = resolveDaemonDir(env);
	return {
		dir,
		pidFile: path.join(dir, "daemon.pid"),
		logFile: path.join(dir, "daemon.log")
	};
}

/**
 * Read the daemon PID from the PID file, or `null` when the file is absent,
 * empty, or does not contain a positive integer.
 */
export function readDaemonPid(pidFile: string): number | null {
	try {
		const raw = fs.readFileSync(pidFile, "utf8").trim();
		const pid = Number.parseInt(raw, 10);
		return Number.isInteger(pid) && pid > 0 ? pid : null;
	} catch {
		return null;
	}
}

/** Persist the daemon PID (creates the directory when missing). */
export function writeDaemonPid(pidFile: string, pid: number): void {
	fs.mkdirSync(path.dirname(pidFile), { recursive: true });
	fs.writeFileSync(pidFile, `${pid}\n`, "utf8");
}

/** Best-effort PID-file removal. */
export function removeDaemonPid(pidFile: string): void {
	try {
		fs.unlinkSync(pidFile);
	} catch {
		/* already gone — best effort */
	}
}

/**
 * Whether a process with `pid` is alive. `process.kill(pid, 0)` performs the
 * existence check without delivering a signal; `EPERM` means the process
 * exists but is owned by another user, so it counts as alive.
 */
export function isProcessAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/**
 * Fork the detached worker, write its PID, and report.
 *
 * When a live daemon is already recorded in the PID file, the fork is skipped
 * and the existing PID is reported (idempotent start). The worker's stdout and
 * stderr are redirected to the daemon log file; the inherited log descriptor
 * is closed in the parent immediately after spawn.
 */
export function startDaemon(options: { paths?: DaemonPaths; io?: Partial<DaemonIo> } = {}): StartDaemonResult {
	const paths = options.paths ?? resolveDaemonPaths();
	const io = { ...defaultIo(), ...options.io };

	const existing = readDaemonPid(paths.pidFile);
	if (existing !== null && io.isAlive(existing)) {
		io.log(`Daemon already running (pid ${existing})`);
		return { started: false, pid: existing };
	}

	fs.mkdirSync(paths.dir, { recursive: true });
	const logFd = fs.openSync(paths.logFile, "a");

	let child: ChildProcess;
	try {
		child = io.spawnFn(io.execPath, [io.workerArg, "--daemon-worker"], {
			detached: true,
			shell: false,
			windowsHide: true,
			stdio: ["ignore", logFd, logFd],
			env: { ...process.env },
			cwd: process.cwd()
		});
	} finally {
		// The child holds its own duplicate of the descriptor; the parent's copy
		// must be closed or it would keep the log file open for the process'
		// (short) lifetime.
		fs.closeSync(logFd);
	}

	const pid = child.pid ?? 0;
	if (pid > 0) writeDaemonPid(paths.pidFile, pid);
	child.unref();
	io.log(`Daemon started (pid ${pid})`);
	return { started: true, pid };
}

/**
 * Stop the daemon: SIGTERM the recorded PID and remove the PID file.
 *
 * A missing PID file, or a stale PID whose process is already gone, is
 * reported as "Daemon not running" (and the stale file is cleaned up).
 */
export function stopDaemon(options: { paths?: DaemonPaths; io?: Partial<DaemonIo> } = {}): StopDaemonResult {
	const paths = options.paths ?? resolveDaemonPaths();
	const io = { ...defaultIo(), ...options.io };

	const pid = readDaemonPid(paths.pidFile);
	if (pid === null) {
		io.log("Daemon not running");
		return { stopped: false };
	}

	if (io.isAlive(pid)) {
		try {
			io.kill(pid, "SIGTERM");
		} catch {
			// ESRCH race: the process exited between the liveness check and the
			// signal — treat as stopped.
		}
		removeDaemonPid(paths.pidFile);
		io.log("Daemon stopped");
		return { stopped: true, pid };
	}

	// Stale PID file: the recorded process no longer exists.
	removeDaemonPid(paths.pidFile);
	io.log("Daemon not running");
	return { stopped: false, pid };
}

/** Report whether the daemon is running. */
export function statusDaemon(options: { paths?: DaemonPaths; io?: Partial<DaemonIo> } = {}): StatusDaemonResult {
	const paths = options.paths ?? resolveDaemonPaths();
	const io = { ...defaultIo(), ...options.io };

	const pid = readDaemonPid(paths.pidFile);
	const running = pid !== null && io.isAlive(pid);
	io.log(running ? `running (pid ${pid})` : "not running");
	return { running, pid: running ? pid : null };
}

/** systemd user-unit name (Linux). */
export const SYSTEMD_UNIT_NAME = "local-memory-mcp";
/** launchd LaunchAgent label (macOS). */
export const LAUNCHD_LABEL = "io.github.vheins.local-memory-mcp";
/** Task Scheduler task name (Windows). */
export const WINDOWS_TASK_NAME = "local-memory-mcp-daemon";

/** An absolute program + its argument vector, ready to be registered with an OS service manager. */
export interface ServiceCommand {
	/** Absolute path to the executable (never relative — relative paths break on reboot). */
	program: string;
	/** Arguments passed to {@link program}. */
	args: string[];
}

/** Result of a captured subprocess invocation. */
export interface ServiceRunResult {
	status: number | null;
	stdout: string;
	stderr: string;
}

/** Injectable seams for service installation (all default to the real system). */
export interface ServiceIo {
	log: (message: string) => void;
	run: (command: string, args: string[]) => ServiceRunResult;
	platform: NodeJS.Platform;
	homedir: string;
	execPath: string;
	workerArg: string;
	username: string;
}

/** Outcome of {@link installDaemon}. */
export interface InstallDaemonResult {
	/** Whether the service definition was written. */
	installed: boolean;
	platform: NodeJS.Platform;
	/** Path of the written service file (Linux/macOS). */
	servicePath?: string;
	/** `true` when an existing definition was found and `--force` was not given. */
	alreadyInstalled?: boolean;
	/** `true` when the platform's service tool was unavailable and a hint was printed. */
	hint?: boolean;
}

/** Outcome of {@link uninstallDaemon}. */
export interface UninstallDaemonResult {
	/** Whether an existing definition was removed. */
	uninstalled: boolean;
	platform: NodeJS.Platform;
	servicePath?: string;
	/** `true` when a hint was printed instead of running the service tool. */
	hint?: boolean;
}

function defaultServiceIo(): ServiceIo {
	return {
		log: (message) => process.stdout.write(`${message}\n`),
		run: (command, args) => {
			try {
				const result = spawnSync(command, args, { encoding: "utf8" });
				return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
			} catch {
				return { status: null, stdout: "", stderr: "" };
			}
		},
		platform: process.platform,
		homedir: os.homedir(),
		execPath: process.execPath,
		workerArg: process.argv[1] ?? "",
		username: process.env.USERNAME ?? process.env.USER ?? ""
	};
}

/** Absolute-path check for the given platform (injected platform may differ from the host). */
function isAbsoluteFor(platform: NodeJS.Platform, value: string): boolean {
	return platform === "win32" ? path.win32.isAbsolute(value) : path.isAbsolute(value);
}

/** Worker argument vector for a platform: `daemon --daemon-worker` (POSIX) or `--daemon-worker`. */
function workerArgs(platform: NodeJS.Platform): string[] {
	return platform === "darwin" || platform === "win32" ? ["--daemon-worker"] : ["daemon", "--daemon-worker"];
}

/** Whether a command is resolvable on PATH (`which` / `where.exe`). */
function commandExists(io: ServiceIo, command: string): boolean {
	const locator = io.platform === "win32" ? "where.exe" : "which";
	return io.run(locator, [command]).status === 0;
}

/**
 * Resolve the absolute command the service manager should launch.
 *
 * Prefers the globally installed `local-memory-mcp` binary (so `npx`/global
 * installs run through their shim); when it cannot be found, falls back to
 * `node <absolute entrypoint>`. Both branches are absolute.
 */
export function resolveServiceCommand(io: ServiceIo): ServiceCommand {
	const locator = io.platform === "win32" ? "where.exe" : "which";
	const found = io.run(locator, ["local-memory-mcp"]);
	if (found.status === 0) {
		const first = found.stdout
			.split(/\r?\n/)
			.map((line) => line.trim())
			.find((line) => line.length > 0);
		if (first && isAbsoluteFor(io.platform, first)) {
			return { program: first, args: workerArgs(io.platform) };
		}
	}
	return { program: io.execPath, args: [io.workerArg, ...workerArgs(io.platform)] };
}

/** Quote an argument for a systemd `ExecStart` line when it contains whitespace. */
function systemdArg(arg: string): string {
	return /\s/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

/** Build the systemd user-unit file body. */
export function buildSystemdUnit(command: ServiceCommand): string {
	return [
		"[Unit]",
		"Description=local-memory-mcp daemon (combined dashboard + MCP HTTP)",
		"After=network.target",
		"",
		"[Service]",
		"Type=simple",
		`ExecStart=${[command.program, ...command.args].map(systemdArg).join(" ")}`,
		"Restart=on-failure",
		"RestartSec=5",
		"",
		"[Install]",
		"WantedBy=default.target",
		""
	].join("\n");
}

/** Escape a string for inclusion in an XML text node / attribute. */
function escapeXml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Build the launchd LaunchAgent plist body. */
export function buildLaunchdPlist(command: ServiceCommand, logFile: string): string {
	const args = [command.program, ...command.args].map((arg) => `\t\t<string>${escapeXml(arg)}</string>`).join("\n");
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
		'<plist version="1.0">',
		"<dict>",
		"\t<key>Label</key>",
		`\t<string>${LAUNCHD_LABEL}</string>`,
		"\t<key>ProgramArguments</key>",
		"\t<array>",
		args,
		"\t</array>",
		"\t<key>RunAtLoad</key>",
		"\t<true/>",
		"\t<key>KeepAlive</key>",
		"\t<true/>",
		"\t<key>StandardOutPath</key>",
		`\t<string>${escapeXml(logFile)}</string>`,
		"\t<key>StandardErrorPath</key>",
		`\t<string>${escapeXml(logFile)}</string>`,
		"</dict>",
		"</plist>",
		""
	].join("\n");
}

/** Build the `schtasks /tr` command string (`"<program>" <args>`). */
export function buildSchtasksCommand(command: ServiceCommand): string {
	return `"${command.program}" ${command.args.join(" ")}`.trim();
}

/** Absolute path of the systemd user unit (Linux). */
export function systemdUnitPath(homedir: string): string {
	return path.join(homedir, ".config", "systemd", "user", `${SYSTEMD_UNIT_NAME}.service`);
}

/** Absolute path of the launchd LaunchAgent plist (macOS). */
export function launchdPlistPath(homedir: string): string {
	return path.join(homedir, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
}

/** Install the daemon as an OS-managed service (Linux systemd / macOS launchd / Windows Task Scheduler). */
export function installDaemon(
	options: { force?: boolean; paths?: DaemonPaths; io?: Partial<ServiceIo> } = {}
): InstallDaemonResult {
	const io = { ...defaultServiceIo(), ...options.io };
	const paths = options.paths ?? resolveDaemonPaths();
	const force = options.force === true;

	if (io.platform === "darwin") return installLaunchd(io, paths, force);
	if (io.platform === "win32") return installWindows(io, force);
	return installSystemd(io, force);
}

/** Remove the daemon's OS-managed service definition. */
export function uninstallDaemon(options: { io?: Partial<ServiceIo> } = {}): UninstallDaemonResult {
	const io = { ...defaultServiceIo(), ...options.io };

	if (io.platform === "darwin") return uninstallLaunchd(io);
	if (io.platform === "win32") return uninstallWindows(io);
	return uninstallSystemd(io);
}

function installSystemd(io: ServiceIo, force: boolean): InstallDaemonResult {
	const unitPath = systemdUnitPath(io.homedir);
	if (fs.existsSync(unitPath) && !force) {
		io.log(`Daemon service already installed (${unitPath}). Use --force to overwrite.`);
		return { installed: false, platform: io.platform, servicePath: unitPath, alreadyInstalled: true };
	}

	const command = resolveServiceCommand(io);
	if (!commandExists(io, "systemctl")) {
		io.log("systemctl not found — cannot install a systemd user service.");
		io.log("Add this line to your crontab (`crontab -e`) instead:");
		io.log(`@reboot ${command.program} ${command.args.join(" ")}`);
		return { installed: false, platform: io.platform, servicePath: unitPath, hint: true };
	}

	fs.mkdirSync(path.dirname(unitPath), { recursive: true });
	fs.writeFileSync(unitPath, buildSystemdUnit(command), "utf8");
	io.run("systemctl", ["--user", "daemon-reload"]);
	io.run("systemctl", ["--user", "enable", "--now", SYSTEMD_UNIT_NAME]);
	io.log(`Daemon service installed (systemd user unit: ${unitPath})`);
	return { installed: true, platform: io.platform, servicePath: unitPath };
}

function uninstallSystemd(io: ServiceIo): UninstallDaemonResult {
	const unitPath = systemdUnitPath(io.homedir);
	if (!fs.existsSync(unitPath)) {
		io.log("Daemon service not installed");
		return { uninstalled: false, platform: io.platform, servicePath: unitPath };
	}

	if (!commandExists(io, "systemctl")) {
		fs.rmSync(unitPath, { force: true });
		io.log(`systemctl not found — removed ${unitPath} and the crontab @reboot entry manually.`);
		return { uninstalled: true, platform: io.platform, servicePath: unitPath, hint: true };
	}

	io.run("systemctl", ["--user", "disable", "--now", SYSTEMD_UNIT_NAME]);
	fs.rmSync(unitPath, { force: true });
	io.run("systemctl", ["--user", "daemon-reload"]);
	io.log("Daemon service uninstalled");
	return { uninstalled: true, platform: io.platform, servicePath: unitPath };
}

function installLaunchd(io: ServiceIo, paths: DaemonPaths, force: boolean): InstallDaemonResult {
	const plistPath = launchdPlistPath(io.homedir);
	if (fs.existsSync(plistPath) && !force) {
		io.log(`Daemon service already installed (${plistPath}). Use --force to overwrite.`);
		return { installed: false, platform: io.platform, servicePath: plistPath, alreadyInstalled: true };
	}

	const command = resolveServiceCommand(io);
	if (!commandExists(io, "launchctl")) {
		io.log("launchctl not found — cannot install a LaunchAgent.");
		io.log("Start the daemon manually at login:");
		io.log(`${command.program} ${command.args.join(" ")}`);
		return { installed: false, platform: io.platform, servicePath: plistPath, hint: true };
	}

	fs.mkdirSync(path.dirname(plistPath), { recursive: true });
	fs.writeFileSync(plistPath, buildLaunchdPlist(command, paths.logFile), "utf8");
	io.run("launchctl", ["load", "-w", plistPath]);
	io.log(`Daemon service installed (launchd LaunchAgent: ${plistPath})`);
	return { installed: true, platform: io.platform, servicePath: plistPath };
}

function uninstallLaunchd(io: ServiceIo): UninstallDaemonResult {
	const plistPath = launchdPlistPath(io.homedir);
	if (!fs.existsSync(plistPath)) {
		io.log("Daemon service not installed");
		return { uninstalled: false, platform: io.platform, servicePath: plistPath };
	}

	if (!commandExists(io, "launchctl")) {
		fs.rmSync(plistPath, { force: true });
		io.log(`launchctl not found — removed ${plistPath} manually.`);
		return { uninstalled: true, platform: io.platform, servicePath: plistPath, hint: true };
	}

	io.run("launchctl", ["unload", "-w", plistPath]);
	fs.rmSync(plistPath, { force: true });
	io.log("Daemon service uninstalled");
	return { uninstalled: true, platform: io.platform, servicePath: plistPath };
}

function installWindows(io: ServiceIo, force: boolean): InstallDaemonResult {
	const command = resolveServiceCommand(io);
	if (!commandExists(io, "schtasks")) {
		io.log("schtasks not found — cannot create a scheduled task.");
		io.log("Add a shortcut to the Startup folder (Win+R → `shell:startup`) that runs:");
		io.log(buildSchtasksCommand(command));
		return { installed: false, platform: io.platform, hint: true };
	}

	const existing = io.run("schtasks", ["/query", "/tn", WINDOWS_TASK_NAME]);
	if (existing.status === 0 && !force) {
		io.log(`Daemon service already installed (scheduled task "${WINDOWS_TASK_NAME}"). Use --force to overwrite.`);
		return { installed: false, platform: io.platform, alreadyInstalled: true };
	}

	io.run("schtasks", [
		"/create",
		"/tn",
		WINDOWS_TASK_NAME,
		"/tr",
		buildSchtasksCommand(command),
		"/sc",
		"ONLOGON",
		"/ru",
		io.username,
		"/f"
	]);
	io.log(`Daemon service installed (scheduled task "${WINDOWS_TASK_NAME}")`);
	return { installed: true, platform: io.platform };
}

function uninstallWindows(io: ServiceIo): UninstallDaemonResult {
	if (!commandExists(io, "schtasks")) {
		io.log("schtasks not found — remove the Startup-folder shortcut manually.");
		return { uninstalled: false, platform: io.platform, hint: true };
	}

	const existing = io.run("schtasks", ["/query", "/tn", WINDOWS_TASK_NAME]);
	if (existing.status !== 0) {
		io.log("Daemon service not installed");
		return { uninstalled: false, platform: io.platform };
	}

	io.run("schtasks", ["/delete", "/tn", WINDOWS_TASK_NAME, "/f"]);
	io.log("Daemon service uninstalled");
	return { uninstalled: true, platform: io.platform };
}

/**
 * Dispatch the `daemon` subcommand. Always exits the parent process:
 * `start` forks and returns to the shell, `stop`/`status` complete inline.
 *
 * @param argv - Arguments AFTER the `daemon` token (`process.argv.slice(3)`).
 */
export function runDaemonCli(argv: string[] = process.argv.slice(3)): void {
	const sub = argv[0];
	if (sub === "stop") {
		stopDaemon();
	} else if (sub === "status") {
		statusDaemon();
	} else if (sub === "install") {
		installDaemon({ force: argv.includes("--force") });
	} else if (sub === "uninstall") {
		uninstallDaemon();
	} else if (sub === undefined || sub === "start") {
		startDaemon();
	} else {
		process.stderr.write(`Unknown daemon subcommand: ${sub} (expected: start | stop | status | install | uninstall)\n`);
		process.exit(1);
	}
	process.exit(0);
}
