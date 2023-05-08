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

export async function ensureRemoteUrl(repo: Repository, remoteUrl: string) {
  const remoteOdooDevConfigStatus = getRemoteConfigStatus(repo, "dev", remoteUrl);
  switch (remoteOdooDevConfigStatus) {
    case "wrong":
      await repo.removeRemote("dev");
      await repo.addRemote("dev", remoteUrl);
      break;
    case "not-added":
      await repo.addRemote("dev", remoteUrl);
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
  let enterprise: string[] = [];
  try {
    enterprise = getFoldersInDirectory(
      `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/enterprise`
    );
  } catch (error) {}
  return vscode.window.showQuickPick([...addons, ...enterprise], { canPickMany: true });
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

export const getBaseBranches = () => {
  const odooConfig = vscode.workspace.getConfiguration("odooDev");
  const baseBranches = Object.entries(odooConfig.baseBranches as Record<string, number>);
  baseBranches.sort((a, b) => a[1] - b[1]);
  return baseBranches.map((b) => b[0]);
};
