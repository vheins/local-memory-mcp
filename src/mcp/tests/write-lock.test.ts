import { describe, it, expect, vi, beforeEach } from "vitest";
import { WriteLock } from "../storage/write-lock";
import lockfile from "proper-lockfile";
import fs from "fs";

vi.mock("proper-lockfile", () => ({
	default: {
		lock: vi.fn(),
		unlock: vi.fn(),
		checkSync: vi.fn(),
	},
}));

vi.mock("fs", () => ({
	default: {
		existsSync: vi.fn(),
		mkdirSync: vi.fn(),
		writeFileSync: vi.fn(),
	},
}));


describe("WriteLock", () => {
	const dbPath = "/test/db/path/memory.db";
	const dirPath = "/test/db/path";

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("constructor", () => {
		it("should create directory and file if they do not exist", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false);

			new WriteLock(dbPath);

			expect(fs.existsSync).toHaveBeenCalledWith(dbPath);
			expect(fs.mkdirSync).toHaveBeenCalledWith(dirPath, { recursive: true });
			expect(fs.writeFileSync).toHaveBeenCalledWith(dbPath, "");
		});

		it("should not create directory or file if they already exist", () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);

			new WriteLock(dbPath);

			expect(fs.existsSync).toHaveBeenCalledWith(dbPath);
			expect(fs.mkdirSync).not.toHaveBeenCalled();
			expect(fs.writeFileSync).not.toHaveBeenCalled();
		});
	});

	describe("acquire", () => {
		it("should acquire the lock with correct parameters", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			const lock = new WriteLock(dbPath);

			await lock.acquire();

			expect(lockfile.lock).toHaveBeenCalledWith(dbPath, {
				stale: 30000,
				retries: {
					retries: 250,
					minTimeout: 200,
					maxTimeout: 200,
				},
				realpath: false,
			});
			// Can't directly access private 'locked', but we can infer it works if release tries to unlock
		});
	});

	describe("release", () => {
		it("should do nothing if not locked", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			const lock = new WriteLock(dbPath);

			await lock.release();

			expect(lockfile.unlock).not.toHaveBeenCalled();
		});

		it("should unlock if locked", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			const lock = new WriteLock(dbPath);

			await lock.acquire();
			await lock.release();

			expect(lockfile.unlock).toHaveBeenCalledWith(dbPath, { realpath: false });
		});

		it("should ignore unlock errors and set locked to false", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(lockfile.unlock).mockRejectedValue(new Error("Unlock failed"));
			const lock = new WriteLock(dbPath);

			await lock.acquire();
			await lock.release(); // Should not throw

			expect(lockfile.unlock).toHaveBeenCalled();

			// To verify locked was set to false, a subsequent release should do nothing
			vi.mocked(lockfile.unlock).mockClear();
			await lock.release();
			expect(lockfile.unlock).not.toHaveBeenCalled();
		});
	});

	describe("withLock", () => {
		it("should acquire, run function, and release", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			const lock = new WriteLock(dbPath);
			const fn = vi.fn().mockResolvedValue("result");

			const result = await lock.withLock(fn);

			expect(result).toBe("result");
			expect(lockfile.lock).toHaveBeenCalled();
			expect(fn).toHaveBeenCalled();
			expect(lockfile.unlock).toHaveBeenCalled();
		});

		it("should release lock even if function throws", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			const lock = new WriteLock(dbPath);
			const error = new Error("Function failed");
			const fn = vi.fn().mockRejectedValue(error);

			await expect(lock.withLock(fn)).rejects.toThrow("Function failed");

			expect(lockfile.lock).toHaveBeenCalled();
			expect(fn).toHaveBeenCalled();
			expect(lockfile.unlock).toHaveBeenCalled();
		});
	});

	describe("isLocked", () => {
		it("should return true if lockfile.checkSync returns true", () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(lockfile.checkSync).mockReturnValue(true);
			const lock = new WriteLock(dbPath);

			const result = lock.isLocked();

			expect(result).toBe(true);
			expect(lockfile.checkSync).toHaveBeenCalledWith(dbPath, { realpath: false });
		});

		it("should return false if lockfile.checkSync returns false", () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(lockfile.checkSync).mockReturnValue(false);
			const lock = new WriteLock(dbPath);

			const result = lock.isLocked();

			expect(result).toBe(false);
			expect(lockfile.checkSync).toHaveBeenCalledWith(dbPath, { realpath: false });
		});
	});
});
