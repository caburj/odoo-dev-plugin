import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export function screamOnError<Args extends any[]>(cb: (...args: Args) => Promise<void>) {
  return async (...args: Args) => {
    try {
      await cb(...args);
    } catch (error) {
      await vscode.window.showErrorMessage((error as Error).message);
    }
  };
}

export function getFoldersInDirectory(directoryPath: string) {
  const filesAndDirs = fs.readdirSync(directoryPath);
  return filesAndDirs.filter((name) => {
    const fullPath = path.join(directoryPath, name);
    const stat = fs.statSync(fullPath);
    return stat.isDirectory();
  });
}
