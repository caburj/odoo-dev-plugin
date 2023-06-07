/* eslint-disable @typescript-eslint/naming-convention */

import * as vscode from "vscode";
import { createContextualUtils } from "./contextualUtils";
import * as commands from "./commands";
import { DEBUG_PYTHON_NAME } from "./constants";
import { getAddons } from "./helpers";
import { getDebugSessions, initActiveBranch, initBaseBranches, initDevBranches } from "./state";
import { IExtensionApi } from "./dependencies/python/apiTypes";
import { GitExtension, Repository } from "./dependencies/git";

const gitExtension = vscode.extensions.getExtension<GitExtension>("vscode.git")!.exports;
const git = gitExtension.getAPI(1);
const pythonExt = vscode.extensions.getExtension<IExtensionApi>("ms-python.python");

const getPythonPath = async () => {
  if (!pythonExt) {
    return "python";
  } else if (!pythonExt.isActive) {
    // TODO: This might not be necessary anymore since we speficied ms-python.python as an extension dependency.
    await pythonExt.activate();
  }
  const api = pythonExt.exports;
  const activeInterpreter = api.environments.getActiveEnvironmentPath();
  return activeInterpreter.path;
};

const ALIASES: Record<string, string[]> = {
  "odooDev.checkoutBranch": ["odooDev.selectBranch"],
  "odooDev.deleteBranch": ["odooDev.removeBranch"],
};

let addonsPathMap: Record<string, string> = {};

let odooServerStatus: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {
  vscode.commands.executeCommand("setContext", "odooDev.state", "activating");

  odooServerStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  odooServerStatus.command = "odooDev.startServer";
  odooServerStatus.text = "$(debug-start) Start Odoo Server";
  odooServerStatus.show();

  if (git.state === "uninitialized") {
    // Wait for git to initialize.
    // Only when the state is "initialized" we can get the repositories.
    await new Promise<void>((resolve) => {
      const disposable = git.onDidChangeState(() => {
        disposable.dispose();
        resolve();
      });
    });
  }

  const repositories: Record<string, Repository | undefined> = Object.fromEntries(
    git.repositories.map((repo) => {
      const repoPath = repo.rootUri.path;
      const repoName = repoPath.split("/").pop()!;
      return [repoName, repo];
    })
  );

  const getRepo = (name: string) => {
    return repositories[name];
  };

  const getRepoPath = (repoName: string) => {
    const repo = getRepo(repoName);
    return repo?.rootUri.fsPath;
  };

  if (getRepo("odoo")) {
    const odooAddonsPath = `${getRepoPath("odoo")}/addons`;
    for (const addon of await getAddons(odooAddonsPath)) {
      addonsPathMap[addon] = `${odooAddonsPath}/${addon}`;
    }
    try {
      const enterpriseAddonsPath = getRepoPath("enterprise");
      if (enterpriseAddonsPath) {
        for (const addon of await getAddons(enterpriseAddonsPath)) {
          addonsPathMap[addon] = `${enterpriseAddonsPath}/${addon}`;
        }
      }
    } catch (error) {}
    addonsPathMap["base"] = `${getRepoPath("odoo")}/odoo/addons/base`;
  } else {
    vscode.commands.executeCommand("setContext", "odooDev.state", "failed");
    return;
  }

  const utils = createContextualUtils(context, {
    odooServerStatus,
    addonsPathMap,
    getPythonPath,
    getRepo,
    getRepoPath,
  });
  const debugSessions = getDebugSessions();

  vscode.debug.onDidTerminateDebugSession((session) => {
    if (session.name === DEBUG_PYTHON_NAME) {
      vscode.commands.executeCommand("setContext", "odooDev.hasActiveServer", false);
      odooServerStatus.command = "odooDev.startServer";
      odooServerStatus.text = "$(debug-start) Start Odoo Server";
    }
    debugSessions.splice(debugSessions.indexOf(session), 1);
  });

  vscode.debug.onDidStartDebugSession((session) => {
    debugSessions.push(session);
  });

  await initBaseBranches(utils);
  await initDevBranches(utils);
  await initActiveBranch(utils);

  vscode.window.registerTreeDataProvider("odoo-dev-branches", utils.treeDataProvider);
  vscode.window.registerTreeDataProvider("odoo-addons-tree", utils.odooAddonsTreeProvider);

  const disposables = Object.values(commands).map((command) => {
    const { name, method } = command(utils);
    const registrations = [vscode.commands.registerCommand(name, method)];
    if (name in ALIASES) {
      for (const alias of ALIASES[name]) {
        registrations.push(vscode.commands.registerCommand(alias, method));
      }
    }
    return registrations;
  });

  for (const disposable of disposables.flat()) {
    context.subscriptions.push(disposable);
  }

  context.subscriptions.push(odooServerStatus);
  context.subscriptions.push(
    // When a new repository is added, we need to update the repositories list.
    git.onDidOpenRepository(
      utils.refreshTrees((repo) => {
        const repoPath = repo.rootUri.path;
        const repoName = repoPath.split("/").pop()!;
        repositories[repoName] = repo;
      })
    )
  );

  context.subscriptions.push(
    // When a repository is removed, we need to update the repositories list.
    git.onDidCloseRepository(
      utils.refreshTrees((repo) => {
        const repoPath = repo.rootUri.path;
        const repoName = repoPath.split("/").pop()!;
        delete repositories[repoName];
      })
    )
  );

  vscode.commands.executeCommand("setContext", "odooDev.state", "activated");
}

// This method is called when your extension is deactivated
export function deactivate() {}
