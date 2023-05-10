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

export async function ensureRemote(name: "odoo" | "enterprise" | "upgrade", repo: Repository) {
  const remoteConfig = vscode.workspace.getConfiguration("odooDev.remote");
  const currentRemote = remoteConfig[name] as string;
  let selectedRemote: string | undefined;
  const createError = () => {
    return new Error(`'${name}' remote not set.`);
  };
  if (currentRemote === "") {
    const addNew = "Add new remote...";
    const userResponse = await vscode.window.showQuickPick(
      [...repo.state.remotes.map((remote) => remote.name), addNew],
      { title: `Select the remote to use for fetching branches in ${name} repository.` }
    );
    if (!userResponse) {
      throw createError();
    }
    if (userResponse === addNew) {
      const newRemoteName = await vscode.window.showInputBox({
        title: "Remote Name",
        prompt: "What is the remote name?",
        placeHolder: `e.g. ${name}-dev`,
      });
      if (!newRemoteName) {
        throw createError();
      }
      const remoteUrl = await vscode.window.showInputBox({
        title: "Remote URL",
        prompt: "What is the remote url?",
        placeHolder: `e.g. git@github.com:odoo-dev/${name}`,
      });
      if (!remoteUrl) {
        throw createError();
      }
      await repo.addRemote(newRemoteName, remoteUrl);
      selectedRemote = newRemoteName;
    } else {
      selectedRemote = userResponse;
    }
    remoteConfig.update(name, selectedRemote, true);
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

export function runShellCommand(
  command: string,
  options: child_process.ExecOptions = {}
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    child_process.exec(command, options, (error, stdout, stderr) => {
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
