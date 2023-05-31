import * as vscode from "vscode";
import * as os from "os";
import * as fs from "fs";
import * as ini from "ini";
import { Branch, GitExtension, Repository } from "./git";
import { OdooDevBranches } from "./odoo_dev_branch";
import {
  callWithSpinner,
  fileExists,
  getChildProcs,
  getRemote,
  inferBaseBranch,
  isBaseBranch,
  isOdooServer,
  isValidDirectory,
  killOdooServer,
  removeComments,
  runShellCommand,
} from "./helpers";
import { Result, error, isSuccess, run, runAsync, success } from "./Result";
import { assert } from "console";
import { DEBUG_JS_NAME, ODOO_TERMINAL_NAME, requirementsRegex } from "./constants";
import { OdooAddonsTree } from "./odoo_addons";
import { getActiveBranch, getDebugSessions } from "./state";

const gitExtension = vscode.extensions.getExtension<GitExtension>("vscode.git")!.exports;
const git = gitExtension.getAPI(1);

export type ContextualUtils = ReturnType<typeof createContextualUtils>;

async function taggedCall<T>(
  tag: string,
  cb: () => Promise<T>
): Promise<{ tag: string; result: T }> {
  const result = await cb();
  return { tag, result };
}

async function getBranch(repo: Repository, name: string): Promise<Branch | undefined> {
  try {
    return await repo.getBranch(name);
  } catch (error) {
    return undefined;
  }
}

export function createContextualUtils(
  context: vscode.ExtensionContext,
  options: { stopServerStatus: vscode.StatusBarItem; addonsPathMap: Record<string, string> }
) {
  const { stopServerStatus, addonsPathMap } = options;

  let odooDevTerminal: vscode.Terminal | undefined;

  const getOdooDevTerminal = () => {
    if (!odooDevTerminal) {
      const existingTerminals = vscode.window.terminals.filter(
        (t) => t.name === ODOO_TERMINAL_NAME
      );
      if (existingTerminals.length > 0) {
        odooDevTerminal = existingTerminals[0];
      } else {
        odooDevTerminal = vscode.window.createTerminal({
          name: ODOO_TERMINAL_NAME,
          cwd: `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/odoo`,
        });
        vscode.window.onDidCloseTerminal((t) => {
          if (t === odooDevTerminal) {
            odooDevTerminal = undefined;
          }
        });
      }
      odooDevTerminal.show();
    }
    return odooDevTerminal;
  };

  const getConfigFilePath = () => {
    let configFilePath: string | undefined;
    let res = run(() => {
      const odooConfigPath = vscode.workspace.getConfiguration("odooDev").odooConfigPath;
      if (odooConfigPath) {
        const stat = fs.statSync(odooConfigPath as string);
        if (stat.isFile()) {
          configFilePath = odooConfigPath;
        } else {
          throw new Error(`${odooConfigPath} is not a file`);
        }
      } else {
        throw new Error("No config file path specified.");
      }
    });

    if (!isSuccess(res)) {
      res = run(() => {
        const homeOdooRc = `${os.homedir()}/.odoorc`;
        const homeOdooConfStat = fs.statSync(homeOdooRc);
        if (homeOdooConfStat.isFile()) {
          configFilePath = homeOdooRc;
        } else {
          throw new Error(".odoorc is not a file.");
        }
      });
    }

    if (!isSuccess(res)) {
      throw new Error(
        `Unable to find an odoo config file. Generate a config file using '--save' option when executing 'odoo-bin' or if you already have a config file, specify it in the settings "Odoo Dev Config Path".`
      );
    }

    return configFilePath!;
  };

  const getPythonPath = () => {
    const pythonPath = vscode.workspace.getConfiguration("python").defaultInterpreterPath as
      | string
      | undefined;

    if (!pythonPath) {
      return "python";
    }

    return fileExists(pythonPath) ? pythonPath : "python";
  };

  const getNotesFolder = () => {
    const notesFolder = vscode.workspace.getConfiguration("odooDev").notesFolder as string;
    if (notesFolder === "") {
      return undefined;
    }
    return isValidDirectory(notesFolder) ? notesFolder : undefined;
  };

  const getAutoStashId = (branchName: string) => {
    return `odooDev-${branchName}`;
  };

  const unstash = async (repo: Repository, branch: string) => {
    try {
      const head = await runShellCommand(`git rev-parse HEAD`, { cwd: repo.rootUri.fsPath });
      const shortHash = head.trim().substring(0, 7);
      const stash = await runShellCommand(
        `git stash list --pretty='%gd %s' | grep "${branch}: ${shortHash}" | head -1 | awk '{print $1}'`,
        {
          cwd: repo.rootUri.fsPath,
        }
      ).then((res) => res.trim());
      if (stash) {
        await runShellCommand(`git stash pop ${stash}`, {
          cwd: repo.rootUri.fsPath,
        });
      }
    } catch (_e) {
      // Failing to pop the stash is not a big deal, so we don't need to throw an error.
    }
  };

  const getNormalStartServerArgs = () => {
    const configFilePath = getConfigFilePath();
    const args = ["-c", configFilePath];
    if (vscode.workspace.getConfiguration("odooDev").branchNameAsDB as boolean) {
      const branch = getActiveBranch();
      if (branch) {
        args.push("-d", branch);
      }
    }
    return args;
  };

  const getstartSelectedTestArgs = (testTag: string) => {
    const args = getNormalStartServerArgs();
    return [...args, "--stop-after-init", "--test-enable", "--test-tags", testTag];
  };

  const getStartCurrentTestFileArgs = (testFilePath: string) => {
    const args = getNormalStartServerArgs();
    return [...args, "--stop-after-init", "--test-file", testFilePath];
  };

  function getOdooConfigValue(key: string) {
    const configFilePath = getConfigFilePath();
    const configFileData = fs.readFileSync(configFilePath, "utf-8");
    const config = ini.parse(configFileData);
    return config?.options?.[key] as string | undefined;
  }

  function getActiveDBName() {
    let dbName: string | undefined;
    if (vscode.workspace.getConfiguration("odooDev").branchNameAsDB as boolean) {
      dbName = getActiveBranch();
    } else {
      dbName = getOdooConfigValue("db_name");
    }
    return dbName;
  }

  const isOdooServerRunning = async (terminalPID: number) => {
    const procs = await getChildProcs(terminalPID);
    const serverProcs = await Promise.all(procs.map((proc) => isOdooServer(parseInt(proc.PID))));
    return serverProcs.filter((x) => x).length > 0;
  };

  async function ensureNoActiveServer(shouldConfirm = true) {
    const terminalPID = await getOdooDevTerminal().processId;
    if (!terminalPID) {
      return success();
    }
    const hasActiveServer = await isOdooServerRunning(terminalPID);
    if (hasActiveServer) {
      if (shouldConfirm) {
        const response = await vscode.window.showQuickPick(["Okay"], {
          title: "There is an active server, it will be stopped to continue.",
        });
        if (!response) {
          return error(
            "There is an active server, it should be stopped before starting a new one."
          );
        }
      }
      await killOdooServer(terminalPID);
    }
    return success();
  }

  async function ensureNoDebugSession(shouldConfirm = true) {
    for (const debugSession of getDebugSessions()) {
      if (debugSession.name.includes(DEBUG_JS_NAME) && debugSession.type === "pwa-chrome") {
        // Ignore debug session if it is for debugging chrome, so return early.
        continue;
      }
      if (shouldConfirm) {
        const response = await vscode.window.showQuickPick(["Okay"], {
          title: "There is an active debug session, it will be stopped to continue.",
        });
        if (!response) {
          return error(
            "There is an active debug session, it should be stopped before starting a new one."
          );
        }
      }
      await vscode.debug.stopDebugging(debugSession);
    }
    return success();
  }

  async function ensureNoRunningServer(shouldConfirm = true) {
    const noActiveServerResult = await ensureNoActiveServer(shouldConfirm);
    if (!isSuccess(noActiveServerResult)) {
      return noActiveServerResult;
    }

    const noDebugSessionResult = await ensureNoDebugSession(shouldConfirm);
    if (!isSuccess(noDebugSessionResult)) {
      return noDebugSessionResult;
    }

    return success();
  }

  const rootPath =
    vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : undefined;

  const getRepo = (name: string) => {
    const sourceFolder = vscode.workspace.getConfiguration("odooDev").sourceFolder as string;
    const uri = vscode.Uri.joinPath(vscode.Uri.file(sourceFolder), name);
    const repo = git.getRepository(uri);
    return repo;
  };

  const getOdooRepo = () => {
    const repo = getRepo("odoo");
    if (!repo) {
      throw new Error("'odoo' repo not found.");
    }
    return repo;
  };

  const isRepoClean = async (repo: Repository) => {
    const status = await runShellCommand("git status --porcelain", {
      cwd: repo.rootUri.fsPath,
    });
    return status.trim().length === 0;
  };

  const ensureCleanRepos = async (currentCommand: string) => {
    const odoo = getOdooRepo();
    const enterprise = getRepo("enterprise");
    const upgrade = getRepo("upgrade");

    const results = await Promise.all([
      taggedCall("odoo", () => isRepoClean(odoo)),
      taggedCall("enterprise", async () => (enterprise ? isRepoClean(enterprise) : true)),
      taggedCall("upgrade", async () => (upgrade ? isRepoClean(upgrade) : true)),
    ]);

    const dirtyRepos = results.filter((r) => !r.result).map((r) => r.tag);
    if (dirtyRepos.length === 0) {
      return success();
    }

    if (vscode.workspace.getConfiguration("odooDev").autoStash as boolean) {
      await Promise.all(
        dirtyRepos.map(async (name) => {
          const repo = getRepo(name)!;
          try {
            const activeBranch = getActiveBranch() || "master";
            const stashId = getAutoStashId(activeBranch);
            await runShellCommand(`git stash -u -m "${stashId}"`, {
              cwd: repo.rootUri.fsPath,
            });
          } catch (_e) {}
        })
      );
    } else {
      return error(
        `Unable to execute '${currentCommand}' because of the following dirty repositories: ${dirtyRepos.join(
          ", "
        )}. Activate "Auto Stash" config to stash them automatically.`
      );
    }

    return success();
  };

  const getDirtyRepos = async () => {
    const odoo = getOdooRepo();
    const enterprise = getRepo("enterprise");
    const upgrade = getRepo("upgrade");

    const results = await Promise.all([
      taggedCall("odoo", () => isRepoClean(odoo)),
      taggedCall("enterprise", async () => (enterprise ? isRepoClean(enterprise) : true)),
      taggedCall("upgrade", async () => (upgrade ? isRepoClean(upgrade) : true)),
    ]);

    return results.filter((r) => !r.result).map((r) => r.tag);
  };

  const fetchBranch = async (
    repoName: string,
    repo: Repository,
    base: string,
    branch: string,
    isDirty: boolean
  ) => {
    let branchToCheckout = branch;
    const remoteName = getRemote(repoName);
    const fetchRes = await runAsync(() => repo.fetch(remoteName, branch));
    if (!isSuccess(fetchRes)) {
      if (!base) {
        throw new Error("Unable to checkout the branch even its base.");
      }
      branchToCheckout = base;
    }

    if (isDirty && (vscode.workspace.getConfiguration("odooDev").autoStash as boolean)) {
      const stashRes = await runAsync(() =>
        runShellCommand(`git stash -u`, { cwd: repo.rootUri.fsPath })
      );
      if (!isSuccess(stashRes)) {
        return error(
          `Failed to stash changes in '${repo.rootUri.fsPath}' because of "${stashRes}".`
        );
      }
    }

    const checkoutRes = await runAsync(() => repo.checkout(branchToCheckout));
    if (!isSuccess(checkoutRes)) {
      if (branchToCheckout !== branch) {
        return error(
          `Failed to fetch '${branch}' (and checkout '${branchToCheckout}' as an alternative) in '${repoName}' because of "${checkoutRes}".`
        );
      } else {
        return error(
          `Failed to checkout '${branch}' in '${repoName}' because of "${checkoutRes}".`
        );
      }
    }
    return success();
  };

  const fetchBranches = async (base: string, branch: string, dirtyRepos: string[]) => {
    const odoo = getOdooRepo();
    const enterprise = getRepo("enterprise");
    const upgrade = getRepo("upgrade");

    const fetchProms = [
      fetchBranch("odoo", odoo, base, branch, dirtyRepos.includes("odoo")),
      enterprise
        ? fetchBranch("enterprise", enterprise, base, branch, dirtyRepos.includes("enterprise"))
        : Promise.resolve(success()),
      upgrade && base === "master"
        ? fetchBranch("upgrade", upgrade, base, branch, dirtyRepos.includes("upgrade"))
        : Promise.resolve(success()),
    ];

    let fetchResults: Result[] = [];
    await callWithSpinner({
      message: `Fetching '${branch}'...`,
      cb: async () => {
        fetchResults = await Promise.all(fetchProms);
      },
    });
    const errors = fetchResults.filter((res) => !isSuccess(res));
    const successes = fetchResults.filter((res) => isSuccess(res));
    if (successes.length === 0) {
      throw new Error("Failed to fetch the branch from any of the repositories.");
    } else if (errors.length > 0) {
      vscode.window.showErrorMessage(errors.join("; "));
    }
  };

  const fetchStableBranch = async (
    repoName: string,
    repo: Repository,
    name: string,
    isDirty: boolean
  ) => {
    const fetchRes = await runAsync(() => repo.fetch("origin", name));
    if (!isSuccess(fetchRes)) {
      return error(`Failed to fetch '${name}' in '${repoName}' because of "${fetchRes}".`);
    }

    if (isDirty && (vscode.workspace.getConfiguration("odooDev").autoStash as boolean)) {
      const stashRes = await runAsync(() =>
        runShellCommand(`git stash -u`, { cwd: repo.rootUri.fsPath })
      );
      if (!isSuccess(stashRes)) {
        return error(
          `Failed to stash changes in '${repo.rootUri.fsPath}' because of "${stashRes}".`
        );
      }
    }

    const checkoutRes = await runAsync(() =>
      runShellCommand(`git checkout --track origin/${name}`, { cwd: repo.rootUri.fsPath })
    );
    if (!isSuccess(checkoutRes)) {
      return error(`Failed to checkout '${name}' in '${repoName}' because of "${checkoutRes}".`);
    }
    return success();
  };

  const fetchStableBranches = async (name: string, dirtyRepos: string[]) => {
    const odoo = getOdooRepo();
    const enterprise = getRepo("enterprise");

    const fetchProms = [
      fetchStableBranch("odoo", odoo, name, dirtyRepos.includes("odoo")),
      enterprise
        ? fetchStableBranch("enterprise", enterprise, name, dirtyRepos.includes("enterprise"))
        : Promise.resolve(success()),
    ];

    let fetchResults: Result[] = [];
    await callWithSpinner({
      message: `Fetching '${name}'...`,
      cb: async () => {
        fetchResults = await Promise.all(fetchProms);
      },
    });

    const errors = fetchResults.filter((res) => !isSuccess(res));
    const successes = fetchResults.filter((res) => isSuccess(res));
    if (successes.length === 0) {
      throw new Error("Failed to fetch the branch from any of the repositories.");
    } else if (errors.length > 0) {
      vscode.window.showErrorMessage(errors.join(" "));
    }
  };

  const simpleCheckout = async (repo: Repository, branch: string, isDirty: boolean) => {
    if (isDirty && (vscode.workspace.getConfiguration("odooDev").autoStash as boolean)) {
      const stashRes = await runAsync(() =>
        runShellCommand(`git stash -u`, { cwd: repo.rootUri.fsPath })
      );
      if (!isSuccess(stashRes)) {
        return error(
          `Failed to stash changes in '${repo.rootUri.fsPath}' because of "${stashRes}".`
        );
      }
    }
    let branchToUnstash: string | undefined;
    const checkoutBranchRes = await runAsync(() => repo.checkout(branch));
    if (!isSuccess(checkoutBranchRes)) {
      const base = inferBaseBranch(branch);
      if (base) {
        const checkoutBaseRes = await runAsync(() => repo.checkout(base));
        if (!isSuccess(checkoutBaseRes)) {
          return error(`${checkoutBranchRes} & ${checkoutBaseRes}`);
        } else {
          branchToUnstash = base;
        }
      }
    } else {
      branchToUnstash = branch;
    }
    if ((vscode.workspace.getConfiguration("odooDev").autoStash as boolean) && branchToUnstash) {
      await unstash(repo, branchToUnstash);
    }
    return success();
  };

  const checkoutEnterprise = async (branch: string, isDirty: boolean) => {
    const enterprise = getRepo("enterprise");
    if (enterprise) {
      return simpleCheckout(enterprise, branch, isDirty);
    }
    return success();
  };

  const checkoutUpgrade = async (branch: string, isDirty: boolean) => {
    const upgradeBranch = inferBaseBranch(branch) === "master" ? branch : "master";
    const repo = getRepo("upgrade");
    if (repo) {
      if (isDirty && (vscode.workspace.getConfiguration("odooDev").autoStash as boolean)) {
        const stashRes = await runAsync(() =>
          runShellCommand(`git stash -u`, { cwd: repo.rootUri.fsPath })
        );
        if (!isSuccess(stashRes)) {
          return error(
            `Failed to stash changes in '${repo.rootUri.fsPath}' because of "${stashRes}".`
          );
        }
      }
      let branchToUnstash: string | undefined;
      const checkoutBranchRes = await runAsync(() => repo.checkout(upgradeBranch));
      if (!isSuccess(checkoutBranchRes) && upgradeBranch !== "master") {
        const checkoutMasterRes = await runAsync(() => repo.checkout("master"));
        if (!isSuccess(checkoutMasterRes)) {
          return error(`${checkoutBranchRes} & ${checkoutMasterRes}`);
        } else {
          branchToUnstash = "master";
        }
      } else {
        branchToUnstash = upgradeBranch;
      }
      if ((vscode.workspace.getConfiguration("odooDev").autoStash as boolean) && branchToUnstash) {
        await unstash(repo, branchToUnstash);
      }
    }
    return success();
  };

  const checkoutBranches = async (branch: string, dirtyRepos: string[]) => {
    const checkoutProms = [
      simpleCheckout(getOdooRepo(), branch, dirtyRepos.includes("odoo")),
      checkoutEnterprise(branch, dirtyRepos.includes("enterprise")),
      checkoutUpgrade(branch, dirtyRepos.includes("upgrade")),
    ];
    let checkoutResults: Result[] = [];
    await callWithSpinner({
      message: `Checking out '${branch}'...`,
      cb: async () => {
        checkoutResults = await Promise.all(checkoutProms);
      },
    });
    const errors = checkoutResults.filter((res) => !isSuccess(res));
    const successes = checkoutResults.filter((res) => isSuccess(res));
    if (successes.length === 0) {
      throw new Error("Failed to checkout the branch from any of the repositories.");
    } else if (errors.length > 0) {
      vscode.window.showErrorMessage(errors.join("; "));
    }
  };

  const createBranch = async (repo: Repository, base: string, branch: string, isDirty: boolean) => {
    if (isDirty && (vscode.workspace.getConfiguration("odooDev").autoStash as boolean)) {
      const stashRes = await runAsync(() =>
        runShellCommand(`git stash -u`, { cwd: repo.rootUri.fsPath })
      );
      if (!isSuccess(stashRes)) {
        return error(
          `Failed to stash changes in '${repo.rootUri.fsPath}' because of "${stashRes}".`
        );
      }
    }
    // Checkout base first as basis for creating the new branch.
    const checkoutBase = await runAsync(() => repo.checkout(base));
    if (!isSuccess(checkoutBase)) {
      return error(`Failed at checking out the base branch '${base}' because of "${checkoutBase}"`);
    }
    if (vscode.workspace.getConfiguration("odooDev").pullBaseOnCreate as boolean) {
      try {
        await repo.pull();
      } catch (error) {
        // Creation of branch should continue even if the pull failed so we ignore the error.
      }
    }
    const createAndCheckoutBranch = await runAsync(() => repo.createBranch(branch, true));
    if (!isSuccess(createAndCheckoutBranch)) {
      return error(
        `Failed at creating the branch '${branch}' because of "${createAndCheckoutBranch}"`
      );
    }
    return success();
  };

  const createUpgradeBranch = async (
    repo: Repository,
    base: string,
    branch: string,
    isDirty: boolean
  ) => {
    if (base === "master") {
      return createBranch(repo, base, branch, isDirty);
    } else {
      if (isDirty && (vscode.workspace.getConfiguration("odooDev").autoStash as boolean)) {
        const stashRes = await runAsync(() =>
          runShellCommand(`git stash -u`, { cwd: repo.rootUri.fsPath })
        );
        if (!isSuccess(stashRes)) {
          return error(
            `Failed to stash changes in '${repo.rootUri.fsPath}' because of "${stashRes}".`
          );
        }
      }
      return runAsync(() => repo.checkout("master"));
    }
  };

  /**
   * - Checks out to the base.
   * - Create and checkout the branch.
   * @param base
   * @param branch
   */
  const createBranches = async (base: string, branch: string, dirtyRepos: string[]) => {
    const enterprise = getRepo("enterprise");
    const upgrade = getRepo("upgrade");

    const createBranchProms = [
      // branch in odoo
      createBranch(getOdooRepo(), base, branch, dirtyRepos.includes("odoo")),

      // branch in enterprise
      enterprise
        ? createBranch(enterprise, base, branch, dirtyRepos.includes("enterprise"))
        : Promise.resolve(success()),

      // branch in upgrade
      upgrade
        ? createUpgradeBranch(upgrade, base, branch, dirtyRepos.includes("upgrade"))
        : Promise.resolve(success()),
    ];

    let createResults: Result[] = [];
    await callWithSpinner({
      message: `Creating '${branch}'...`,
      cb: async () => {
        createResults = await Promise.all(createBranchProms);
      },
    });
    const errors = createResults.filter((res) => !isSuccess(res));
    const successes = createResults.filter((res) => isSuccess(res));
    if (successes.length === 0) {
      throw new Error("Failed to create the branch from any of the repositories.");
    } else if (errors.length > 0) {
      vscode.window.showErrorMessage(errors.join("; "));
    }
  };

  const deleteBranch = async (
    repo: Repository,
    base: string,
    branch: string,
    activeBranch: string | undefined
  ) => {
    assert(base !== branch, "Value of the base can't be the same as branch.");
    if (activeBranch === branch) {
      // If the branch to delete is the active branch, we need to checkout to the base branch first.
      const checkoutBaseRes = await simpleCheckout(repo, base, false);
      if (!isSuccess(checkoutBaseRes)) {
        return error(
          `Failed to delete '${branch}' because it is the active branch and unable to checkout to the '${base}' base branch.`
        );
      }
      if (vscode.workspace.getConfiguration("odooDev").autoStash as boolean) {
        await unstash(repo, base);
      }
    }
    const repoBranch = await getBranch(repo, branch);
    if (!repoBranch) {
      return success();
    }
    const deleteBranchRes = await runAsync(() => repo.deleteBranch(branch, true));
    if (!isSuccess(deleteBranchRes)) {
      return error(`Failed to delete '${branch}' because of "${deleteBranchRes}"`);
    }
    return success();
  };

  const deleteBranches = async (base: string, branch: string, activeBranch: string | undefined) => {
    const enterprise = getRepo("enterprise");
    const upgrade = getRepo("upgrade");

    const deleteProms = [
      deleteBranch(getOdooRepo(), base, branch, activeBranch),
      enterprise
        ? deleteBranch(enterprise, base, branch, activeBranch)
        : Promise.resolve(success()),
      upgrade && base === "master"
        ? deleteBranch(upgrade, base, branch, activeBranch)
        : Promise.resolve(success()),
    ];

    let deleteResults: Result[] = [];
    await callWithSpinner({
      message: `Deleting '${branch}'...`,
      cb: async () => {
        deleteResults = await Promise.all(deleteProms);
      },
    });
    const errors = deleteResults.filter((res) => !isSuccess(res));
    const successes = deleteResults.filter((res) => isSuccess(res));
    if (successes.length === 0) {
      throw new Error("Failed to delete the branch from any of the repositories.");
    } else if (errors.length > 0) {
      vscode.window.showErrorMessage(errors.join("; "));
    }
  };

  const resetBranch = async (
    repoName: string,
    repo: Repository,
    branch: string,
    isDirty: boolean
  ) => {
    if (repo.state.HEAD?.name !== branch) {
      return success(); // We don't care about resetting a repo that has different active branch.
    } else {
      const remote = isBaseBranch(branch) ? "origin" : getRemote(repoName);
      try {
        if (isDirty) {
          await runShellCommand("git stash", { cwd: repo.rootUri.fsPath });
        }
        await repo.fetch({ remote, ref: branch });
        await runShellCommand(`git reset --hard ${remote}/${branch}`, { cwd: repo.rootUri.fsPath });
        if (isDirty) {
          await runShellCommand("git stash pop", { cwd: repo.rootUri.fsPath });
        }
      } catch (e) {
        return error(
          `Failed to reset the active branch from ${repoName}. Error: ${(e as Error).message}`
        );
      }
      return success();
    }
  };

  const resetBranches = async (branch: string, dirtyRepos: string[]) => {
    const odoo = getOdooRepo();
    const enterprise = getRepo("enterprise");
    const upgrade = getRepo("upgrade");

    const promises = [
      resetBranch("odoo", odoo, branch, dirtyRepos.includes("odoo")),
      enterprise
        ? resetBranch("enterprise", enterprise, branch, dirtyRepos.includes("enterprise"))
        : Promise.resolve(success()),
      upgrade && (inferBaseBranch(branch) === "master" || branch === "master")
        ? resetBranch("upgrade", upgrade, branch, dirtyRepos.includes("upgrade"))
        : Promise.resolve(success()),
    ];

    let results: Result[] = [];
    await callWithSpinner({
      message: `Resetting '${branch}'...`,
      cb: async () => {
        results = await Promise.all(promises);
      },
    });
    const errors = results.filter((res) => !isSuccess(res));
    const successes = results.filter((res) => isSuccess(res));
    if (successes.length === 0) {
      throw new Error("Failed to reset the branch from any of the repositories.");
    } else if (errors.length > 0) {
      vscode.window.showErrorMessage(errors.join("; "));
    }
  };

  const getClassAndMethod = async (symbols: vscode.DocumentSymbol[], position: vscode.Position) => {
    // Find the class it belongs, followed by the method.
    const classSymbol = symbols.find(
      (s) => s.kind === vscode.SymbolKind.Class && s.range.contains(position)
    );
    const methodSymbol = classSymbol
      ? classSymbol.children.find(
          (s) =>
            /^test.*/.test(s.name) &&
            s.kind === vscode.SymbolKind.Method &&
            s.range.contains(position)
        )
      : undefined;
    return { classSymbol, methodSymbol };
  };

  const getTestTag = async (editor: vscode.TextEditor) => {
    const match = editor.document.uri.path.match(/.*\/addons\/(.*)\/tests\/test_.*\.py/);
    const [, addon] = match || [undefined, undefined];
    if (!addon) {
      throw new Error("Current file is not a test file.");
    }

    const position = editor.selection.active;
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      "vscode.executeDocumentSymbolProvider",
      editor.document.uri
    );

    const { classSymbol, methodSymbol } = await getClassAndMethod(symbols, position);

    return `${addon}${classSymbol ? `:${classSymbol.name}` : ""}${
      methodSymbol ? `.${methodSymbol.name}` : ""
    }`;
  };

  const getTestFilePath = (editor: vscode.TextEditor) => {
    const isTestFile = /.*\/addons\/(.*)\/tests\/test_.*\.py/.test(editor.document.uri.path);
    if (!isTestFile) {
      throw new Error("Current file is not a test file.");
    }
    return editor.document.uri.path;
  };

  const treeDataProvider = new OdooDevBranches(rootPath);

  const odooPath = `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/odoo`;
  const enterprisePath = `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/enterprise`;
  const enterpriseExists = fs.existsSync(enterprisePath);
  const odooAddonsTreeProvider = new OdooAddonsTree(
    odooPath,
    enterpriseExists ? enterprisePath : undefined
  );

  const refreshTreeOnSuccess = async (cb: () => void | Promise<void>) => {
    await cb();
    treeDataProvider.refresh();
  };

  const getStartServerArgs = async () => {
    const testFileRegex = /.*\/(addons|enterprise)\/(.*)\/tests\/test_.*\.py/;
    const autoTest = vscode.workspace.getConfiguration("odooDev")["autoTest"] as boolean;
    let commandArgs: string[] = [];

    const editor = vscode.window.activeTextEditor;
    if (autoTest && editor) {
      const match = editor.document.uri.path.match(testFileRegex);
      const [, , addon] = match || [undefined, undefined, undefined];
      if (addon) {
        const position = editor.selection.active;
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
          "vscode.executeDocumentSymbolProvider",
          editor.document.uri
        );

        const { classSymbol, methodSymbol } = await getClassAndMethod(symbols, position);

        if (!classSymbol && !methodSymbol) {
          commandArgs = getStartCurrentTestFileArgs(editor.document.uri.path);
        } else {
          const testTag = `${addon}${classSymbol ? `:${classSymbol.name}` : ""}${
            methodSymbol ? `.${methodSymbol.name}` : ""
          }`;
          commandArgs = getstartSelectedTestArgs(testTag);
        }
      } else {
        commandArgs = getNormalStartServerArgs();
      }
    } else {
      commandArgs = getNormalStartServerArgs();
    }
    return commandArgs;
  };

  const startServer = async (command: string) => {
    const terminal = getOdooDevTerminal();
    terminal.show();
    terminal.sendText(command);

    // when the server stops, set the context to false
    let timeout = setTimeout(async function poll() {
      const pid = await terminal.processId;
      if (!pid) {
        vscode.commands.executeCommand("setContext", "odooDev.hasActiveServer", false);
        stopServerStatus.hide();
      } else {
        const isRunning = await isOdooServerRunning(pid);
        if (isRunning) {
          vscode.commands.executeCommand("setContext", "odooDev.hasActiveServer", true);
          stopServerStatus.show();
          timeout = setTimeout(poll, 500);
        } else {
          vscode.commands.executeCommand("setContext", "odooDev.hasActiveServer", false);
          stopServerStatus.hide();
          clearTimeout(timeout);
        }
      }
    }, 2000);
  };

  const startServerWithInstall = async (selectedAddons: string[]) => {
    const startServerArgs = await getStartServerArgs();
    const args = [...startServerArgs, "-i", selectedAddons.join(",")];
    const python = getPythonPath();
    const odooBin = `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/odoo/odoo-bin`;
    startServer(`${python} ${odooBin} ${args.join(" ")}`);
  };

  let githubSession: vscode.AuthenticationSession | undefined;

  const getGithubAccessToken = async () => {
    try {
      if (!githubSession) {
        githubSession = await vscode.authentication.getSession("github", ["repo"], {
          createIfNone: true,
        });
      }
    } catch (_e) {}
    if (!githubSession) {
      throw new Error("Fetching info from private repo requires github login.");
    }
    return githubSession.accessToken;
  };

  function isDependentOn(addon: string, dependency: string): boolean {
    const addonPath = `${addonsPathMap[addon]}`;
    const manifestPath = `${addonPath}/__manifest__.py`;

    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Manifest file not found for '${addon}' addon at path ${addonPath}`);
    }

    const manifestContent = removeComments(fs.readFileSync(manifestPath, "utf8"));
    const requirementsMatch = manifestContent.match(requirementsRegex);
    const requirementsStr = requirementsMatch ? requirementsMatch[1] : "";

    const requirements = eval(`${requirementsStr}`);
    if (!requirements) {
      return false;
    }

    if (requirements.includes(dependency)) {
      return true;
    }

    for (const req of requirements) {
      if (isDependentOn(req, dependency)) {
        return true;
      }
    }

    return false;
  }

  function toQueryString(params: Record<string, string>): string {
    const parts = [];
    for (const [key, value] of Object.entries(params)) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
    return `?${parts.join("&")}`;
  }

  const getServerUrl = async (queryParams?: Record<string, string>) => {
    const ip = await runShellCommand(
      `ifconfig en0 | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}'`
    );
    const ipTrimmed = ip.trim();
    const host = ipTrimmed === "" ? "localhost" : ipTrimmed;
    const port = getOdooConfigValue("http_port") || "8069";
    return `http://${host}:${port}` + `${queryParams ? toQueryString(queryParams) : ""}`;
  };

  return {
    treeDataProvider,
    odooAddonsTreeProvider,
    getConfigFilePath,
    getOdooDevTerminal,
    getPythonPath,
    getStartServerArgs,
    startServer,
    startServerWithInstall,
    getOdooConfigValue,
    getActiveDBName,
    getRepo,
    getOdooRepo,
    fetchBranches,
    fetchStableBranches,
    createBranches,
    checkoutBranches,
    deleteBranches,
    resetBranches,
    getTestTag,
    getTestFilePath,
    getNotesFolder,
    refreshTreeOnSuccess,
    ensureCleanRepos,
    ensureNoActiveServer,
    ensureNoDebugSession,
    ensureNoRunningServer,
    getDirtyRepos,
    stopServerStatus,
    getGithubAccessToken,
    isDependentOn,
    addonsPathMap,
    getServerUrl,
  };
}
