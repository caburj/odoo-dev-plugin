import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as child_process from "child_process";
import { Repository } from "./git";

export function screamOnError<Args extends any[]>(cb: (...args: Args) => Promise<void>) {
  return async (...args: Args) => {
    try {
      await cb(...args);
    } catch (error) {
      await vscode.window.showErrorMessage((error as Error).message);
    }
  };
}

function getFoldersInDirectory(directoryPath: string) {
  const filesAndDirs = fs.readdirSync(directoryPath);
  return filesAndDirs.filter((name) => {
    const fullPath = path.join(directoryPath, name);
    const stat = fs.statSync(fullPath);
    return stat.isDirectory();
  });
}

export function getRemoteConfigStatus(
  repo: Repository,
  remoteName: string,
  remoteUrl: string
): "not-added" | "wrong" | "okay" {
  for (const remote of repo.state.remotes) {
    if (remote.name === remoteName) {
      if (remote.fetchUrl === remoteUrl) {
        return "okay";
      } else {
        return "wrong";
      }
    }
  }
  return "not-added";
}

export async function ensureRemoteOdooDevConfig(repo: Repository) {
  const remoteUrl = vscode.workspace.getConfiguration("odooDev").remoteOdooDevUrl as string;
  const remoteOdooDevConfigStatus = getRemoteConfigStatus(repo, "odoo-dev", remoteUrl);
  switch (remoteOdooDevConfigStatus) {
    case "wrong":
      await repo.removeRemote("odoo-dev");
      await repo.addRemote("odoo-dev", remoteUrl);
      break;
    case "not-added":
      await repo.addRemote("odoo-dev", remoteUrl);
      break;
  }
}

function splitWithDashFrom(str: string, start: number) {
  return [str.substring(0, str.indexOf("-", start)), str.substring(str.indexOf("-", start) + 1)];
}

export function inferBaseBranch(devBranchName: string) {
  const start = devBranchName.startsWith("saas") ? 5 : 0;
  return splitWithDashFrom(devBranchName, start)[0];
}

export async function multiSelectAddons() {
  const addons = getFoldersInDirectory(
    `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/odoo/addons`
  );
  return vscode.window.showQuickPick(addons, { canPickMany: true });
}

export function runShellCommand(command: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    child_process.exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout.toString());
      }
    });
  });
}

export function callWithSpinner(options: { message: string; cb: () => Thenable<void> }) {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: options.message });
      await options.cb();
    }
  );
}
