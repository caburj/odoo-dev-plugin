import * as vscode from "vscode";
import * as os from "os";
import * as fs from "fs";
import * as ini from "ini";
import * as Result from "./Result";
import { Branch, Repository } from "./dependencies/git";
import { OdooDevBranches } from "./odoo_dev_branch";
import {
  findRemote,
  getChildProcs,
  inferBaseBranch,
  isOdooServer,
  killOdooServer,
  removeComments,
  tryRunShellCommand,
  runShellCommand,
  getAddons,
} from "./helpers";
import { assert } from "console";
import { DEBUG_JS_NAME, ODOO_TERMINAL_NAME, requirementsRegex } from "./constants";
import { OdooAddonsTree } from "./odoo_addons";
import { getActiveBranch, getDebugSessions } from "./state";
import { withProgress } from "./decorators";
import { IExtensionApi } from "./dependencies/python/apiTypes";

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
  options: {
    stopServerStatus: vscode.StatusBarItem;
    addonsPathMap: Record<string, string>;
    getPythonPath: () => Promise<string>;
    getRepo: (repoName: string) => Repository | undefined;
    getRepoPath: (name: string) => string | undefined;
  }
) {
  const { stopServerStatus, addonsPathMap, getRepo, getPythonPath, getRepoPath } = options;

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
          cwd: getRepoPath("odoo"),
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
    let res = Result.call(() => {
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

    if (!Result.check(res)) {
      res = Result.call(() => {
        const homeOdooRc = `${os.homedir()}/.odoorc`;
        const homeOdooConfStat = fs.statSync(homeOdooRc);
        if (homeOdooConfStat.isFile()) {
          configFilePath = homeOdooRc;
        } else {
          throw new Error(".odoorc is not a file.");
        }
      });
    }

    if (!Result.check(res)) {
      throw new Error(
        `Unable to find an odoo config file. Generate a config file using '--save' option when executing 'odoo-bin' or if you already have a config file, specify it in the settings "Odoo Dev Config Path".`
      );
    }

    return configFilePath!;
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
      return Result.success();
    }
    const hasActiveServer = await isOdooServerRunning(terminalPID);
    if (hasActiveServer) {
      if (shouldConfirm) {
        const response = await vscode.window.showQuickPick(["Okay"], {
          title: "There is an active server, it will be stopped to continue.",
        });
        if (!response) {
          return Result.fail(
            new Error("There is an active server, it should be stopped before starting a new one.")
          );
        }
      }
      await killOdooServer(terminalPID);
    }
    return Result.success();
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
          return Result.fail(
            new Error(
              "There is an active debug session, it should be stopped before starting a new one."
            )
          );
        }
      }
      await vscode.debug.stopDebugging(debugSession);
    }
    return Result.success();
  }

  async function ensureNoRunningServer(shouldConfirm = true) {
    const noActiveServerResult = await ensureNoActiveServer(shouldConfirm);
    if (!Result.check(noActiveServerResult)) {
      return noActiveServerResult;
    }

    const noDebugSessionResult = await ensureNoDebugSession(shouldConfirm);
    if (!Result.check(noDebugSessionResult)) {
      return noDebugSessionResult;
    }

    return Result.success();
  }

  const rootPath =
    vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : undefined;

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
    const remote = (await findRemote(repo, branch)) || "origin";
    let branchToCheckout = branch;
    const fetchRes = await Result.call(() => repo.fetch(remote, branch));
    if (!Result.check(fetchRes)) {
      if (!base) {
        throw new Error("Unable to checkout the branch even its base.");
      }
      branchToCheckout = base;
    }

    if (isDirty && (vscode.workspace.getConfiguration("odooDev").autoStash as boolean)) {
      const stashRes = await tryRunShellCommand(`git stash -u`, {
        cwd: repo.rootUri.fsPath,
      });
      if (!Result.check(stashRes)) {
        return Result.fail(
          new Error(
            `Failed to stash changes in '${repo.rootUri.fsPath}' because of "${stashRes.error.message}".`
          )
        );
      }
    }

    const checkoutRes = await Result.call(() => repo.checkout(branchToCheckout));
    if (!Result.check(checkoutRes)) {
      if (branchToCheckout !== branch) {
        return Result.fail(
          new Error(
            `Failed to fetch '${branch}' (and checkout '${branchToCheckout}' as an alternative) in '${repoName}' because of "${checkoutRes.error.message}".`
          )
        );
      } else {
        return Result.fail(
          new Error(
            `Failed to checkout '${branch}' in '${repoName}' because of "${checkoutRes.error.message}".`
          )
        );
      }
    }
    return Result.success();
  };

  const fetchBranches = async (base: string, branch: string, dirtyRepos: string[]) => {
    const odoo = getOdooRepo();
    const enterprise = getRepo("enterprise");
    const upgrade = getRepo("upgrade");

    const fetchProms = [
      fetchBranch("odoo", odoo, base, branch, dirtyRepos.includes("odoo")),
      enterprise
        ? fetchBranch("enterprise", enterprise, base, branch, dirtyRepos.includes("enterprise"))
        : Promise.resolve(Result.success()),
      upgrade && base === "master"
        ? fetchBranch("upgrade", upgrade, base, branch, dirtyRepos.includes("upgrade"))
        : Promise.resolve(Result.success()),
    ];

    const fetchWithSpinner = withProgress({
      message: `Fetching '${branch}'...`,
      cb: () => Promise.all(fetchProms),
    });
    const fetchResults = await fetchWithSpinner();
    const [successes, errors] = Result.partition(fetchResults);
    if (successes.length === 0) {
      throw new Error("Failed to fetch the branch from any of the repositories.");
    } else if (errors.length > 0) {
      vscode.window.showErrorMessage(errors.map((f) => f.error.message).join("; "));
    }
  };

  const fetchOrCreateBranches = async (base: string, branch: string, dirtyRepos: string[]) => {
    const odoo = getOdooRepo();
    const enterprise = getRepo("enterprise");
    const upgrade = getRepo("upgrade");

    // Check if at least one from the repos, it is available remotely.
    // If so, we call fetchBranches, otherwise we call createBranches.
    const findRemotes = withProgress({
      message: `Checking remotes for '${branch}'...`,
      cb: () =>
        Promise.all([
          findRemote(odoo, branch),
          enterprise
            ? findRemote(enterprise, branch)
            : Promise.resolve(undefined as string | undefined),
          upgrade ? findRemote(upgrade, branch) : Promise.resolve(undefined as string | undefined),
        ]),
    });
    const remoteChecks = await findRemotes();

    const isFromRemote = remoteChecks.some((r) => r);
    if (isFromRemote) {
      return fetchBranches(base, branch, dirtyRepos);
    } else {
      return createBranches(base, branch, dirtyRepos);
    }
  };

  const fetchStableBranch = async (
    repoName: string,
    repo: Repository,
    name: string,
    isDirty: boolean
  ) => {
    const fetchRes = await Result.call(() => repo.fetch("origin", name));
    if (!Result.check(fetchRes)) {
      return Result.fail(
        new Error(
          `Failed to fetch '${name}' in '${repoName}' because of "${fetchRes.error.message}".`
        )
      );
    }

    if (isDirty && (vscode.workspace.getConfiguration("odooDev").autoStash as boolean)) {
      const stashRes = await tryRunShellCommand(`git stash -u`, { cwd: repo.rootUri.fsPath });
      if (!Result.check(stashRes)) {
        return Result.fail(
          new Error(
            `Failed to stash changes in '${repo.rootUri.fsPath}' because of "${stashRes.error.message}".`
          )
        );
      }
    }

    const checkoutRes = await tryRunShellCommand(`git checkout --track origin/${name}`, {
      cwd: repo.rootUri.fsPath,
    });
    if (!Result.check(checkoutRes)) {
      return Result.fail(
        new Error(
          `Failed to checkout '${name}' in '${repoName}' because of "${checkoutRes.error.message}".`
        )
      );
    }
    return Result.success();
  };

  const fetchStableBranches = async (name: string, dirtyRepos: string[]) => {
    const odoo = getOdooRepo();
    const enterprise = getRepo("enterprise");

    const fetchProms = [
      fetchStableBranch("odoo", odoo, name, dirtyRepos.includes("odoo")),
      enterprise
        ? fetchStableBranch("enterprise", enterprise, name, dirtyRepos.includes("enterprise"))
        : Promise.resolve(Result.success()),
    ];

    const fetchWithSpinner = withProgress({
      message: `Fetching '${name}'...`,
      cb: () => Promise.all(fetchProms),
    });
    const fetchResults = await fetchWithSpinner();

    const [successes, errors] = Result.partition(fetchResults);
    if (successes.length === 0) {
      throw new Error("Failed to fetch the branch from any of the repositories.");
    } else if (errors.length > 0) {
      vscode.window.showErrorMessage(errors.map((f) => f.error.message).join(" "));
    }
  };

  const simpleCheckout = async (repo: Repository, branch: string, isDirty: boolean) => {
    if (isDirty && (vscode.workspace.getConfiguration("odooDev").autoStash as boolean)) {
      const stashRes = await tryRunShellCommand(`git stash -u`, { cwd: repo.rootUri.fsPath });
      if (!Result.check(stashRes)) {
        return Result.fail(
          new Error(
            `Failed to stash changes in '${repo.rootUri.fsPath}' because of "${stashRes.error.message}".`
          )
        );
      }
    }
    let branchToUnstash: string | undefined;
    const checkoutBranchRes = await Result.call(() => repo.checkout(branch));
    if (!Result.check(checkoutBranchRes)) {
      const base = inferBaseBranch(branch);
      if (base) {
        const checkoutBaseRes = await Result.call(() => repo.checkout(base));
        if (!Result.check(checkoutBaseRes)) {
          return Result.fail(
            new Error(`${checkoutBranchRes.error.message} & ${checkoutBaseRes.error.message}`)
          );
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
    return Result.success();
  };

  const checkoutEnterprise = async (branch: string, isDirty: boolean) => {
    const enterprise = getRepo("enterprise");
    if (enterprise) {
      return simpleCheckout(enterprise, branch, isDirty);
    }
    return Result.success();
  };

  const checkoutUpgrade = async (branch: string, isDirty: boolean) => {
    const upgradeBranch = inferBaseBranch(branch) === "master" ? branch : "master";
    const repo = getRepo("upgrade");
    if (repo) {
      if (isDirty && (vscode.workspace.getConfiguration("odooDev").autoStash as boolean)) {
        const stashRes = await tryRunShellCommand(`git stash -u`, { cwd: repo.rootUri.fsPath });
        if (!Result.check(stashRes)) {
          return Result.fail(
            new Error(
              `Failed to stash changes in '${repo.rootUri.fsPath}' because of "${stashRes.error.message}".`
            )
          );
        }
      }
      let branchToUnstash: string | undefined;
      const checkoutBranchRes = await Result.call(() => repo.checkout(upgradeBranch));
      if (!Result.check(checkoutBranchRes) && upgradeBranch !== "master") {
        const checkoutMasterRes = await Result.call(() => repo.checkout("master"));
        if (!Result.check(checkoutMasterRes)) {
          return Result.fail(
            new Error(`${checkoutBranchRes.error.message} & ${checkoutMasterRes.error.message}`)
          );
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
    return Result.success();
  };

  const checkoutBranches = async (branch: string, dirtyRepos: string[]) => {
    const checkoutProms = [
      simpleCheckout(getOdooRepo(), branch, dirtyRepos.includes("odoo")),
      checkoutEnterprise(branch, dirtyRepos.includes("enterprise")),
      checkoutUpgrade(branch, dirtyRepos.includes("upgrade")),
    ];
    const checkWithSpinner = withProgress({
      message: `Checking out '${branch}'...`,
      cb: () => Promise.all(checkoutProms),
    });
    const checkoutResults = await checkWithSpinner();
    const [successes, errors] = Result.partition(checkoutResults);
    if (successes.length === 0) {
      throw new Error("Failed to checkout the branch from any of the repositories.");
    } else if (errors.length > 0) {
      vscode.window.showErrorMessage(errors.map((f) => f.error.message).join("; "));
    }
  };

  const createBranch = async (repo: Repository, base: string, branch: string, isDirty: boolean) => {
    if (isDirty && (vscode.workspace.getConfiguration("odooDev").autoStash as boolean)) {
      const stashRes = await tryRunShellCommand(`git stash -u`, { cwd: repo.rootUri.fsPath });
      if (!Result.check(stashRes)) {
        return Result.fail(
          new Error(
            `Failed to stash changes in '${repo.rootUri.fsPath}' because of "${stashRes.error.message}".`
          )
        );
      }
    }
    // Checkout base first as basis for creating the new branch.
    const checkoutBase = await Result.call(() => repo.checkout(base));
    if (!Result.check(checkoutBase)) {
      return Result.fail(
        new Error(
          `Failed at checking out the base branch '${base}' because of "${checkoutBase.error.message}"`
        )
      );
    }
    if (vscode.workspace.getConfiguration("odooDev").pullBaseOnCreate as boolean) {
      try {
        await repo.pull();
      } catch (error) {
        // Creation of branch should continue even if the pull failed so we ignore the error.
      }
    }
    const createAndCheckoutBranch = await Result.call(() => repo.createBranch(branch, true));
    if (!Result.check(createAndCheckoutBranch)) {
      return Result.fail(
        new Error(
          `Failed at creating the branch '${branch}' because of "${createAndCheckoutBranch.error.message}"`
        )
      );
    }
    return Result.success();
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
        const stashRes = await tryRunShellCommand(`git stash -u`, { cwd: repo.rootUri.fsPath });
        if (!Result.check(stashRes)) {
          return Result.fail(
            new Error(
              `Failed to stash changes in '${repo.rootUri.fsPath}' because of "${stashRes.error.message}".`
            )
          );
        }
      }
      return Result.call(() => repo.checkout("master"));
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
        : Promise.resolve(Result.success()),

      // branch in upgrade
      upgrade
        ? createUpgradeBranch(upgrade, base, branch, dirtyRepos.includes("upgrade"))
        : Promise.resolve(Result.success()),
    ];

    const createWithSpinner = withProgress({
      message: `Creating '${branch}'...`,
      cb: () => Promise.all(createBranchProms),
    });
    const createResults = await createWithSpinner();
    const [successes, errors] = Result.partition(createResults);
    if (successes.length === 0) {
      throw new Error("Failed to create the branch from any of the repositories.");
    } else if (errors.length > 0) {
      vscode.window.showErrorMessage(errors.map((f) => f.error.message).join("; "));
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
      if (!Result.check(checkoutBaseRes)) {
        return Result.fail(
          new Error(
            `Failed to delete '${branch}' because it is the active branch and unable to checkout to the '${base}' base branch.`
          )
        );
      }
      if (vscode.workspace.getConfiguration("odooDev").autoStash as boolean) {
        await unstash(repo, base);
      }
    }
    const repoBranch = await getBranch(repo, branch);
    if (!repoBranch) {
      return Result.success();
    }
    const deleteBranchRes = await Result.call(() => repo.deleteBranch(branch, true));
    if (!Result.check(deleteBranchRes)) {
      return Result.fail(
        new Error(`Failed to delete '${branch}' because of "${deleteBranchRes.error.message}"`)
      );
    }
    return Result.success();
  };

  const deleteBranches = async (base: string, branch: string, activeBranch: string | undefined) => {
    const enterprise = getRepo("enterprise");
    const upgrade = getRepo("upgrade");

    const deleteProms = [
      deleteBranch(getOdooRepo(), base, branch, activeBranch),
      enterprise
        ? deleteBranch(enterprise, base, branch, activeBranch)
        : Promise.resolve(Result.success()),
      upgrade && base === "master"
        ? deleteBranch(upgrade, base, branch, activeBranch)
        : Promise.resolve(Result.success()),
    ];

    const deleteWithSpinner = withProgress({
      message: `Deleting '${branch}'...`,
      cb: () => Promise.all(deleteProms),
    });
    const deleteResults = await deleteWithSpinner();
    const [successes, errors] = Result.partition(deleteResults);
    if (successes.length === 0) {
      throw new Error("Failed to delete the branch from any of the repositories.");
    } else if (errors.length > 0) {
      vscode.window.showErrorMessage(errors.map((f) => f.error.message).join("; "));
    }
  };

  const resetBranch = async (
    repoName: string,
    repo: Repository,
    branch: string,
    isDirty: boolean
  ) => {
    if (repo.state.HEAD?.name !== branch) {
      return Result.success(); // We don't care about resetting a repo that has different active branch.
    } else {
      const remote = repo.state.HEAD?.upstream?.remote;

      if (!remote) {
        return Result.fail(
          new Error(`Failed to reset the active branch of '${repoName}' repo. No remote found.`)
        );
      }

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
        return Result.fail(
          new Error(
            `Failed to reset the active branch of '${repoName}' repo. Error: ${
              (e as Error).message
            }`
          )
        );
      }
      return Result.success();
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
        : Promise.resolve(Result.success()),
      upgrade && (inferBaseBranch(branch) === "master" || branch === "master")
        ? resetBranch("upgrade", upgrade, branch, dirtyRepos.includes("upgrade"))
        : Promise.resolve(Result.success()),
    ];

    const resetWithSpinner = withProgress({
      message: `Resetting '${branch}'...`,
      cb: () => Promise.all(promises),
    });
    const results = await resetWithSpinner();
    const [successes, errors] = Result.partition(results);
    if (successes.length === 0) {
      throw new Error("Failed to reset the branch from any of the repositories.");
    } else if (errors.length > 0) {
      vscode.window.showErrorMessage(errors.map((f) => f.error.message).join("; "));
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

  const treeDataProvider = new OdooDevBranches(rootPath);
  const odooAddonsTreeProvider = new OdooAddonsTree(getRepoPath);

  function refreshTrees<A extends any[], R extends any>(
    cb: (...args: A) => Promise<R>
  ): (...args: A) => Promise<R>;
  function refreshTrees<A extends any[], R extends any>(cb: (...args: A) => R): (...args: A) => R;
  function refreshTrees<A extends any[], R extends any>(cb: (...args: A) => Promise<R> | R) {
    return (...args: A) => {
      const result = cb(...args);
      if (result instanceof Promise) {
        return result.then((val) => {
          treeDataProvider.refresh();
          odooAddonsTreeProvider.refresh();
          return val;
        });
      } else {
        treeDataProvider.refresh();
        odooAddonsTreeProvider.refresh();
        return result;
      }
    };
  }

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
    const python = await getPythonPath();
    const odooBin = `${getRepoPath("odoo")}/odoo-bin`;
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

  async function multiSelectAddons() {
    const odooPath = `${getRepoPath("odoo")}/addons`;
    const enterprisePath = getRepoPath("enterprise");

    const odooAddons = await getAddons(odooPath);
    let enterpriseAddons: string[] = [];
    try {
      if (enterprisePath) {
        enterpriseAddons = await getAddons(enterprisePath);
      }
    } catch (error) {}
    return vscode.window.showQuickPick([...odooAddons, ...enterpriseAddons], { canPickMany: true });
  }

  return {
    treeDataProvider,
    odooAddonsTreeProvider,
    getConfigFilePath,
    getOdooDevTerminal,
    getPythonPath,
    getStartServerArgs,
    startServer,
    startServerWithInstall,
    getActiveDBName,
    getRepo,
    fetchBranches: refreshTrees(fetchBranches),
    fetchStableBranches: refreshTrees(fetchStableBranches),
    createBranches: refreshTrees(createBranches),
    fetchOrCreateBranches: refreshTrees(fetchOrCreateBranches),
    checkoutBranches: refreshTrees(checkoutBranches),
    deleteBranches: refreshTrees(deleteBranches),
    resetBranches,
    getTestTag,
    ensureNoActiveServer,
    ensureNoDebugSession,
    ensureNoRunningServer,
    getDirtyRepos,
    stopServerStatus,
    getGithubAccessToken,
    isDependentOn,
    addonsPathMap,
    getServerUrl,
    getRepoPath,
    multiSelectAddons,
    refreshTrees,
  };
}
