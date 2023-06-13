/* eslint-disable @typescript-eslint/naming-convention */

import * as vscode from "vscode";
import * as Result from "./Result";
import { ContextualUtils, createContextualUtils } from "./contextualUtils";
import * as commands from "./commands";
import { DEBUG_PYTHON_NAME } from "./constants";
import {
  constructOdooDevRepositories,
  getAddons,
  getRepoName,
  updateOdooDevRepositories,
} from "./helpers";
import { getDebugSessions, initBaseBranches, initDevBranches } from "./state";
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

const currentBranches: Record<string, string | undefined> = {};
const repoSubscriptions: Record<string, vscode.Disposable> = {};
const refreshTreesOnRepoChange = (repo: Repository, utils: ContextualUtils) => {
  const refresh = utils.refreshTrees(() => {});
  const repoName = getRepoName(repo);
  currentBranches[repoName] = repo.state.HEAD?.name;
  const disposable = repo.state.onDidChange(() => {
    const newBranch = repo.state.HEAD?.name;
    if (currentBranches[repoName] !== newBranch) {
      currentBranches[repoName] = newBranch;
      refresh();
    }
  });
  repoSubscriptions[repoName] = disposable;
};
const stopRefreshTreesOnRepoChange = (repo: Repository) => {
  const repoName = getRepoName(repo);
  const disposable = repoSubscriptions[repoName];
  if (disposable) {
    disposable.dispose();
  }
  delete repoSubscriptions[repoName];
};

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
      const repoName = getRepoName(repo);
      return [repoName, repo];
    })
  );

  const getRepoPath = (repo: Repository) => {
    return repo.rootUri.fsPath;
  };

  const odevReposRes = Result.try_(constructOdooDevRepositories, git.repositories);

  if (!Result.check(odevReposRes)) {
    vscode.commands.executeCommand("setContext", "odooDev.state", "failed");
    return;
  }

  const odevRepos = odevReposRes.value;
  if (odevRepos.odoo) {
    const odooAddonsPath = `${getRepoPath(odevRepos.odoo)}/addons`;
    for (const addon of await getAddons(odooAddonsPath)) {
      addonsPathMap[addon] = `${odooAddonsPath}/${addon}`;
    }
    try {
      for (const repo of Object.values(odevRepos.custom)) {
        const customAddonsPath = getRepoPath(repo);
        for (const addon of await getAddons(customAddonsPath)) {
          addonsPathMap[addon] = `${customAddonsPath}/${addon}`;
        }
      }
    } catch (error) {}
    addonsPathMap["base"] = `${getRepoPath(odevRepos.odoo)}/odoo/addons/base`;
  } else {
    vscode.commands.executeCommand("setContext", "odooDev.state", "failed");
    return;
  }

  const utils = createContextualUtils(context, {
    odooServerStatus,
    addonsPathMap,
    getPythonPath,
    getRepoPath,
    odevRepos,
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
        const repoName = getRepoName(repo);
        repositories[repoName] = repo;
        updateOdooDevRepositories(odevRepos, [repo]);
        refreshTreesOnRepoChange(repo, utils);
      })
    )
  );

  context.subscriptions.push(
    // When a repository is removed, we need to update the repositories list.
    git.onDidCloseRepository(
      utils.refreshTrees((repo) => {
        const repoName = getRepoName(repo);
        delete repositories[repoName];
        updateOdooDevRepositories(odevRepos, [repo], true);
        stopRefreshTreesOnRepoChange(repo);
      })
    )
  );

  for (const repo of git.repositories) {
    refreshTreesOnRepoChange(repo, utils);
  }

  vscode.commands.executeCommand("setContext", "odooDev.state", "activated");
}

// This method is called when your extension is deactivated
export function deactivate() {
  for (const disposable of Object.values(repoSubscriptions)) {
    disposable.dispose();
  }
}
