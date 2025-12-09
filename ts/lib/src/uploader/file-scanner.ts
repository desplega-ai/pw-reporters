import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface FileInfo {
  /** Absolute path to the file */
  path: string;
  /** File size in bytes */
  size: number;
  /** File name */
  name: string;
  /** Relative path from scan root */
  relativePath: string;
}

export interface FileScannerConfig {
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Recursively scan a directory for files to upload.
 */
export class FileScanner {
  private debug: boolean;

  constructor(config: FileScannerConfig = {}) {
    this.debug = config.debug ?? false;
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log("[file-scanner]", ...args);
    }
  }

  /**
   * Scan a directory recursively and return file information
   */
  async scan(rootPath: string): Promise<FileInfo[]> {
    const files: FileInfo[] = [];

    try {
      await this.scanDirectory(rootPath, rootPath, files);
    } catch (error) {
      // Directory might not exist (no test artifacts)
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.log("Directory does not exist:", rootPath);
        return [];
      }
      throw error;
    }

    this.log("Found", files.length, "files in", rootPath);
    return files;
  }

  /**
   * Recursively scan a directory
   */
  private async scanDirectory(
    rootPath: string,
    currentPath: string,
    files: FileInfo[],
  ): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await this.scanDirectory(rootPath, fullPath, files);
      } else if (entry.isFile()) {
        const stats = await stat(fullPath);
        const relativePath = fullPath.slice(rootPath.length + 1); // +1 for the separator

        files.push({
          path: fullPath,
          size: stats.size,
          name: entry.name,
          relativePath,
        });

        this.log("Found file:", relativePath, `(${stats.size} bytes)`);
      }
    }
  }

  /**
   * Get total size of files
   */
  static getTotalSize(files: FileInfo[]): number {
    return files.reduce((sum, file) => sum + file.size, 0);
  }

  /**
   * Format bytes to human readable string
   */
  static formatSize(bytes: number): string {
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }
}
