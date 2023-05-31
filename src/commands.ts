import * as vscode from "vscode";
import fetch from "node-fetch";
import {
  createTemplateNote,
  fileExists,
  getAddons,
  inferBaseBranch,
  isBaseBranch,
  multiSelectAddons,
  runShellCommand,
  screamOnError,
} from "./helpers";
import { type ContextualUtils } from "./contextualUtils";
import { isSuccess } from "./Result";
import { OdooDevBranch } from "./odoo_dev_branch";
import { DEBUG_JS_NAME, DEBUG_PYTHON_NAME } from "./constants";
import {
  addBaseBranch,
  addDevBranch,
  devBranchExists,
  getActiveBranch,
  getBaseBranches,
  getDevBranches,
  removeDevBranch,
  setActiveBranch,
} from "./state";

function createCommand<T>(
  name: string,
  cb: (utils: ContextualUtils, item?: OdooDevBranch) => Promise<T>
) {
  return (utils: ContextualUtils) => {
    return { name, method: (item?: OdooDevBranch) => cb(utils, item) };
  };
}

export const createBranch = createCommand(
  "odooDev.createBranch",
  screamOnError(async (utils) => {
    if (!isSuccess(await utils.ensureNoRunningServer())) {
      return;
    }

    const input = await vscode.window.showInputBox({
      placeHolder: "e.g. master-ref-barcode-parser-jcb",
      prompt: "Add new dev branch",
    });

    if (input === undefined) {
      return;
    }

    if (input === "") {
      vscode.window.showErrorMessage("Empty input is invalid.");
      return;
    }

    const dirtyRepos = await utils.getDirtyRepos();
    if (
      dirtyRepos.length !== 0 &&
      !(vscode.workspace.getConfiguration("odooDev").autoStash as boolean)
    ) {
      throw new Error(
        `There are uncommitted changes in: ${dirtyRepos.join(
          ", "
        )}. Activate "Auto Stash" config to stash them automatically.`
      );
    }

    const base = inferBaseBranch(input);

    return utils.refreshTreeOnSuccess(async () => {
      const baseBranches = getBaseBranches();
      if (!baseBranches.includes(base)) {
        throw new Error(
          `Fetch the stable branch '${base}' before creating a dev branch out of it.`
        );
      } else if (devBranchExists({ base, name: input })) {
        throw new Error(`'${input}' already exists!`);
      }
      await utils.createBranches(base, input, dirtyRepos);
      setActiveBranch(input);
      addDevBranch(base, input);
    });
  })
);

export const fetchBranch = createCommand(
  "odooDev.fetchBranch",
  screamOnError(async (utils) => {
    if (!isSuccess(await utils.ensureNoRunningServer())) {
      return;
    }

    const input = await vscode.window.showInputBox({
      title: "Branch Name",
      placeHolder: "e.g. master-ref-barcode-parser-jcb",
      prompt: "What is the name of the branch to fetch?",
    });

    if (input === undefined) {
      return;
    }

    if (input === "") {
      vscode.window.showErrorMessage("Empty input is invalid.");
      return;
    }

    const dirtyRepos = await utils.getDirtyRepos();
    if (
      dirtyRepos.length !== 0 &&
      !(vscode.workspace.getConfiguration("odooDev").autoStash as boolean)
    ) {
      throw new Error(
        `There are uncommitted changes in: ${dirtyRepos.join(
          ", "
        )}. Activate "Auto Stash" config to stash them automatically.`
      );
    }

    const base = inferBaseBranch(input);

    return utils.refreshTreeOnSuccess(async () => {
      const baseBranches = getBaseBranches();
      if (!baseBranches.includes(base)) {
        addBaseBranch(base);
      } else if (devBranchExists({ base, name: input })) {
        throw new Error(`'${input}' already exists!`);
      }
      await utils.fetchBranches(base, input, dirtyRepos);
      setActiveBranch(input);
      addDevBranch(base, input);
    });
  })
);

export const fetchOrCreate = createCommand(
  "odooDev.fetchOrCreate",
  screamOnError(async (utils) => {
    if (!isSuccess(await utils.ensureNoRunningServer())) {
      return;
    }
    const input = await vscode.window.showInputBox({
      placeHolder: "e.g. 16.0-foo-bar",
      prompt: "Specify the name of the branch to fetch/create.",
    });

    if (input === undefined) {
      return;
    }

    if (input === "") {
      vscode.window.showErrorMessage("Empty input is invalid.");
      return;
    }

    const dirtyRepos = await utils.getDirtyRepos();
    if (
      dirtyRepos.length !== 0 &&
      !(vscode.workspace.getConfiguration("odooDev").autoStash as boolean)
    ) {
      throw new Error(
        `There are uncommitted changes in: ${dirtyRepos.join(
          ", "
        )}. Activate "Auto Stash" config to stash them automatically.`
      );
    }

    const base = inferBaseBranch(input);

    return utils.refreshTreeOnSuccess(async () => {
      if (devBranchExists({ base, name: input })) {
        throw new Error(`'${input}' already exists!`);
      }
      await utils.fetchOrCreateBranches(base, input, dirtyRepos);
      setActiveBranch(input);
      addDevBranch(base, input);
    });
  })
);

export const fetchStableBranch = createCommand(
  "odooDev.fetchStableBranch",
  screamOnError(async (utils) => {
    if (!isSuccess(await utils.ensureNoRunningServer())) {
      return;
    }

    const branch = await vscode.window.showInputBox({
      placeHolder: "e.g. saas-16.3",
      prompt: "What is the name of the stable branch to fetch?",
    });

    if (branch === undefined) {
      return;
    }

    if (branch === "") {
      vscode.window.showErrorMessage("Empty input is invalid.");
      return;
    }

    const dirtyRepos = await utils.getDirtyRepos();
    if (
      dirtyRepos.length !== 0 &&
      !(vscode.workspace.getConfiguration("odooDev").autoStash as boolean)
    ) {
      throw new Error(
        `There are uncommitted changes in: ${dirtyRepos.join(
          ", "
        )}. Activate "Auto Stash" config to stash them automatically.`
      );
    }

    return utils.refreshTreeOnSuccess(async () => {
      const baseBranches = getBaseBranches();
      if (!baseBranches.includes(branch)) {
        addBaseBranch(branch);
      }
      await utils.fetchStableBranches(branch, dirtyRepos);
      setActiveBranch(branch);
    });
  })
);

export const deleteBranch = createCommand(
  "odooDev.deleteBranch",
  screamOnError(async (utils, item) => {
    if (!isSuccess(await utils.ensureNoRunningServer())) {
      return;
    }

    const devBranches = getBaseBranches()
      .map((base) => getDevBranches(base).map((branch) => ({ ...branch, base })))
      .flat();

    const selected = item
      ? {
          label: item.label,
          base: item.base,
          name: item.name,
        }
      : await vscode.window.showQuickPick(
          devBranches.map((b) => ({ ...b, label: b.name })),
          { title: "Select the dev branch to delete" }
        );

    if (selected === undefined) {
      return;
    }

    const dirtyRepos = await utils.getDirtyRepos();
    if (dirtyRepos.length !== 0) {
      const answer = await vscode.window.showQuickPick(["Yes", "No"], {
        title: `Uncommitted changes in: ${dirtyRepos.join(
          ", "
        )}. The changes will be lost. Continue?`,
      });
      if (answer !== "Yes") {
        return;
      }
      await Promise.all(
        dirtyRepos.map(async (repoName) => {
          const repo = utils.getRepo(repoName);
          if (repo) {
            return runShellCommand(`git reset --hard`, { cwd: repo.rootUri.fsPath });
          }
        })
      );
    }

    return utils.refreshTreeOnSuccess(async () => {
      const { base, name: branch } = selected;
      if (base === branch) {
        // Not really possible at the moment. But better be sure.
        throw new Error(`Deleting base branch '${base}' is not allowed.`);
      }
      const activeBranch = getActiveBranch();
      await utils.deleteBranches(base, branch, activeBranch);
      if (activeBranch === branch) {
        setActiveBranch(base);
      }
      removeDevBranch(base, branch);
    });
  })
);

export const checkoutBranch = createCommand(
  "odooDev.checkoutBranch",
  screamOnError(async (utils, item) => {
    if (!isSuccess(await utils.ensureNoRunningServer())) {
      return;
    }

    const devBranches = getBaseBranches()
      .map((base) => [
        { base, name: base },
        ...getDevBranches(base).map((branch) => ({ ...branch, base })),
      ])
      .flat();

    const selected = item
      ? {
          label: item.label,
          base: item.base,
          name: item.name,
        }
      : await vscode.window.showQuickPick(
          devBranches.map((b) => ({ ...b, label: b.name })),
          { title: "Choose from the list" }
        );

    if (selected === undefined) {
      return;
    }

    const dirtyRepos = await utils.getDirtyRepos();
    if (
      dirtyRepos.length !== 0 &&
      !(vscode.workspace.getConfiguration("odooDev").autoStash as boolean)
    ) {
      throw new Error(
        `There are uncommitted changes in: ${dirtyRepos.join(
          ", "
        )}. Activate "Auto Stash" config to stash them automatically.`
      );
    }

    return utils.refreshTreeOnSuccess(async () => {
      await utils.checkoutBranches(selected.name, dirtyRepos);
      setActiveBranch(selected.name);
    });
  })
);

export const resetActiveBranch = createCommand(
  "odooDev.resetActiveBranch",
  screamOnError(async (utils) => {
    if (!isSuccess(await utils.ensureNoRunningServer())) {
      return;
    }

    const dirtyRepos = await utils.getDirtyRepos();
    if (
      dirtyRepos.length !== 0 &&
      !(vscode.workspace.getConfiguration("odooDev").autoStash as boolean)
    ) {
      throw new Error(
        `There are uncommitted changes in: ${dirtyRepos.join(
          ", "
        )}. Activate "Auto Stash" config to stash them automatically.`
      );
    }

    const activeBranch = getActiveBranch();
    if (activeBranch) {
      await utils.resetBranches(activeBranch, dirtyRepos);
    }
  })
);

export const startFreshServer = createCommand(
  "odooDev.startFreshServer",
  screamOnError(async (utils) => {
    if (!isSuccess(await utils.ensureNoRunningServer())) {
      return;
    }

    const selectedAddons = await multiSelectAddons();
    if (!selectedAddons) {
      return;
    }

    const dbName = utils.getActiveDBName();
    if (dbName) {
      try {
        await runShellCommand(`dropdb ${dbName}`);
      } catch (error) {
        if (error instanceof Error) {
          const rx = new RegExp(`database .${dbName}. does not exist`);
          if (!rx.test(error.message)) {
            throw error;
          }
        }
      }
    }

    utils.startServerWithInstall(selectedAddons);
  })
);

export const startServer = createCommand(
  "odooDev.startServer",
  screamOnError(async (utils) => {
    if (!isSuccess(await utils.ensureNoRunningServer())) {
      return;
    }

    const commandArgs = await utils.getStartServerArgs();
    const python = utils.getPythonPath();
    const odooBin = `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/odoo/odoo-bin`;
    utils.startServer(`${python} ${odooBin} ${commandArgs.join(" ")}`);
  })
);

export const debugServer = createCommand(
  "odooDev.debugServer",
  screamOnError(async (utils) => {
    if (!isSuccess(await utils.ensureNoRunningServer())) {
      return;
    }

    const odooBin = `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/odoo/odoo-bin`;
    const commandArgs = await utils.getStartServerArgs();
    const debugOdooPythonLaunchConfig: vscode.DebugConfiguration = {
      name: DEBUG_PYTHON_NAME,
      type: "python",
      request: "launch",
      stopOnEntry: false,
      console: "integratedTerminal",
      python: "${command:python.interpreterPath}",
      program: odooBin,
      args: commandArgs,
    };
    await vscode.debug.startDebugging(undefined, debugOdooPythonLaunchConfig);
    vscode.commands.executeCommand("setContext", "odooDev.hasActiveServer", true);
    utils.stopServerStatus.show();
  })
);

export const startServerWithInstall = createCommand(
  "odooDev.startServerWithInstall",
  screamOnError(async (utils) => {
    if (!isSuccess(await utils.ensureNoRunningServer())) {
      return;
    }

    const selectedAddons = await multiSelectAddons();
    if (!selectedAddons) {
      return;
    }

    utils.startServerWithInstall(selectedAddons);
  })
);

export const debugServerWithInstall = createCommand(
  "odooDev.debugServerWithInstall",
  screamOnError(async (utils) => {
    if (!isSuccess(await utils.ensureNoRunningServer())) {
      return;
    }

    const selectedAddons = await multiSelectAddons();
    if (!selectedAddons) {
      return;
    }

    const odooBin = `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/odoo/odoo-bin`;
    const startServerArgs = await utils.getStartServerArgs();
    const args = [...startServerArgs, "-i", selectedAddons.join(",")];

    const debugOdooPythonLaunchConfig: vscode.DebugConfiguration = {
      name: DEBUG_PYTHON_NAME,
      type: "python",
      request: "launch",
      stopOnEntry: false,
      console: "integratedTerminal",
      python: "${command:python.interpreterPath}",
      program: odooBin,
      args,
    };
    await vscode.debug.startDebugging(undefined, debugOdooPythonLaunchConfig);
    vscode.commands.executeCommand("setContext", "odooDev.hasActiveServer", true);
    utils.stopServerStatus.show();
  })
);

export const startServerWithUpdate = createCommand(
  "odooDev.startServerWithUpdate",
  screamOnError(async (utils) => {
    if (!isSuccess(await utils.ensureNoRunningServer())) {
      return;
    }

    const selectedAddons = await multiSelectAddons();
    if (!selectedAddons) {
      return;
    }

    const startServerArgs = await utils.getStartServerArgs();
    const args = [...startServerArgs, "-u", selectedAddons.join(",")];

    const python = utils.getPythonPath();
    const odooBin = `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/odoo/odoo-bin`;
    utils.startServer(`${python} ${odooBin} ${args.join(" ")}`);
  })
);

export const debugServerWithUpdate = createCommand(
  "odooDev.debugServerWithUpdate",
  screamOnError(async (utils) => {
    if (!isSuccess(await utils.ensureNoRunningServer())) {
      return;
    }

    const selectedAddons = await multiSelectAddons();
    if (!selectedAddons) {
      return;
    }

    const odooBin = `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/odoo/odoo-bin`;
    const startServerArgs = await utils.getStartServerArgs();
    const args = [...startServerArgs, "-u", selectedAddons.join(",")];

    const debugOdooPythonLaunchConfig: vscode.DebugConfiguration = {
      name: DEBUG_PYTHON_NAME,
      type: "python",
      request: "launch",
      stopOnEntry: false,
      console: "integratedTerminal",
      python: "${command:python.interpreterPath}",
      program: odooBin,
      args,
    };
    await vscode.debug.startDebugging(undefined, debugOdooPythonLaunchConfig);
    vscode.commands.executeCommand("setContext", "odooDev.hasActiveServer", true);
    utils.stopServerStatus.show();
  })
);

export const debugJS = createCommand(
  "odooDev.debugJS",
  screamOnError(async (utils) => {
    const odooAddonsPath = `${
      vscode.workspace.getConfiguration("odooDev").sourceFolder
    }/odoo/addons`;

    const enterpriseAddonsPath = `${
      vscode.workspace.getConfiguration("odooDev").sourceFolder
    }/enterprise`;

    const url = await utils.getServerUrl({ debug: "assets" });

    const odooAddons = await getAddons(odooAddonsPath);
    const addons: [path: string, name: string][] = odooAddons.map((name) => [odooAddonsPath, name]);

    try {
      const enterpriseAddons = await getAddons(enterpriseAddonsPath);
      addons.push(
        ...enterpriseAddons.map((a) => [enterpriseAddonsPath, a] as [path: string, name: string])
      );
    } catch (_e) {}

    const sourceMapPathOverrides = Object.fromEntries(
      addons.map(([path, name]) => [`../../..//${name}/*`, `${path}/${name}/*`])
    );

    const debugOdooPythonLaunchConfig: vscode.DebugConfiguration = {
      name: DEBUG_JS_NAME,
      type: "chrome",
      request: "launch",
      url,
      sourceMaps: true,
      sourceMapPathOverrides,
    };
    await vscode.debug.startDebugging(undefined, debugOdooPythonLaunchConfig);
  })
);

export const dropActiveDB = createCommand(
  "odooDev.dropActiveDB",
  screamOnError(async (utils) => {
    if (!isSuccess(await utils.ensureNoRunningServer())) {
      return;
    }
    const dbName = utils.getActiveDBName();
    if (dbName) {
      utils.getOdooDevTerminal().show();
      utils.getOdooDevTerminal().sendText(`dropdb ${dbName}`);
    }
  })
);

export const getTestTag = createCommand(
  "odooDev.getTestTag",
  screamOnError(async ({ getTestTag }) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      throw new Error("Open a test file.");
    }
    const testTag = await getTestTag(editor);
    await vscode.env.clipboard.writeText(testTag);
  })
);

export const openChromeLocalServer = createCommand(
  "odooDev.openChromeLocalServer",
  screamOnError(async ({ getServerUrl }) => {
    // TODO: check if there is an active server
    const url = await getServerUrl();
    switch (process.platform) {
      case "darwin": {
        const chromePath = await runShellCommand(
          `mdfind 'kMDItemCFBundleIdentifier == "com.google.Chrome"'`
        );
        const chrome = chromePath.trim();
        if (chrome === "") {
          vscode.window.showErrorMessage(
            "Chrome is not installed, opened in the default browser instead."
          );
          vscode.env.openExternal(vscode.Uri.parse(url));
        } else {
          await runShellCommand(`open -a "${chrome}" ${url}`);
        }
        break;
      }
      case "linux": {
        try {
          await runShellCommand(`which google-chrome`);
          await runShellCommand(`google-chrome ${url}`);
        } catch (error) {
          vscode.window.showErrorMessage(
            "Chrome is not installed, opened in the default browser instead."
          );
          vscode.env.openExternal(vscode.Uri.parse(url));
        }
        break;
      }
      default: {
        throw new Error(`Unsupported platform: ${process.platform}`);
      }
    }
  })
);

export const openOdooConf = createCommand(
  "odooDev.openOdooConf",
  screamOnError(async ({ getConfigFilePath }) => {
    const filePath = getConfigFilePath();
    const confUri = vscode.Uri.file(filePath);
    if (confUri) {
      vscode.window.showTextDocument(confUri);
    }
  })
);

export const openLinkedNote = createCommand(
  "odooDev.openLinkedNote",
  screamOnError(async ({ getNotesFolder }, item) => {
    const branch = item ? item.name : getActiveBranch();
    if (!branch) {
      throw new Error(`There is no selected branch.`);
    }

    let notesFolder = getNotesFolder();
    if (!notesFolder) {
      const willSelectFolder = await vscode.window.showQuickPick(["Yes", "No"], {
        title: "Odoo Dev Notes Folder isn't properly set, do you want to set it?",
      });
      if (!willSelectFolder || willSelectFolder === "No") {
        return;
      }
      const dialogSelection = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Select Folder",
      });
      if (!dialogSelection) {
        return;
      }
      const [selectedFolder] = dialogSelection;
      notesFolder = selectedFolder.fsPath;
      await vscode.workspace.getConfiguration("odooDev").update("notesFolder", notesFolder, true);
    }

    const notePath = `${notesFolder}/${branch}.md`;
    if (!fileExists(notePath)) {
      createTemplateNote(notePath);
    }
    const noteUri = vscode.Uri.file(notePath);
    await vscode.window.showTextDocument(noteUri);
  })
);

export const stopActiveServer = createCommand(
  "odooDev.stopActiveServer",
  screamOnError(async (utils) => {
    await utils.ensureNoActiveServer(false);
    await utils.ensureNoDebugSession(false);
    vscode.commands.executeCommand("setContext", "odooDev.hasActiveServer", false);
    utils.stopServerStatus.hide();
  })
);

export const openPullRequestLink = createCommand(
  "odooDev.openPullRequestLinkOdoo",
  screamOnError(async (utils, item) => {
    const branchName = item ? item.name : getActiveBranch();

    if (!branchName || isBaseBranch(branchName)) {
      throw new Error(`Please select a dev branch.`);
    }

    const response = await fetch(
      `https://api.github.com/repos/odoo/odoo/pulls?head=odoo-dev:${branchName}&state=all`
    );
    const pullRequests = await response.json();
    const [pr] = pullRequests;
    if (!pr) {
      throw new Error(`There is no pull request (odoo) from the branch '${branchName}'.`);
    }
    vscode.env.openExternal(vscode.Uri.parse(pr.html_url));
  })
);

export const openPullRequestLinkEnterprise = createCommand(
  "odooDev.openPullRequestLinkEnterprise",
  screamOnError(async (utils, item) => {
    const githubAccessToken = await utils.getGithubAccessToken();

    const branchName = item ? item.name : getActiveBranch();

    if (!branchName || isBaseBranch(branchName)) {
      throw new Error(`Please select a dev branch.`);
    }

    const response = await fetch(
      `https://api.github.com/repos/odoo/enterprise/pulls?head=odoo-dev:${branchName}&state=all`,
      {
        headers: {
          Authorization: `Bearer ${githubAccessToken}`,
        },
      }
    );
    const pullRequests = await response.json();
    const [pr] = pullRequests;
    if (!pr) {
      throw new Error(`There is no pull request (enterprise) from the branch '${branchName}'.`);
    }
    vscode.env.openExternal(vscode.Uri.parse(pr.html_url));
  })
);

export const openPullRequestLinkUpgrade = createCommand(
  "odooDev.openPullRequestLinkUpgrade",
  screamOnError(async (utils, item) => {
    const githubAccessToken = await utils.getGithubAccessToken();

    const branchName = item ? item.name : getActiveBranch();

    if (!branchName || isBaseBranch(branchName)) {
      throw new Error(`Please select a dev branch.`);
    }

    const response = await fetch(
      `https://api.github.com/repos/odoo/upgrade/pulls?head=odoo:${branchName}&state=all`,
      {
        headers: {
          Authorization: `Bearer ${githubAccessToken}`,
        },
      }
    );
    const pullRequests = await response.json();
    const [pr] = pullRequests;
    if (!pr) {
      throw new Error(`There is no pull request (upgrade) from the branch '${branchName}'.`);
    }
    vscode.env.openExternal(vscode.Uri.parse(pr.html_url));
  })
);

export const openRunbotLink = createCommand(
  "odooDev.openRunbotLink",
  screamOnError(async (utils, item) => {
    const branchName = item ? item.name : getActiveBranch();

    if (!branchName || isBaseBranch(branchName)) {
      throw new Error(`Please select a dev branch.`);
    }

    const url = `https://runbot.odoo.com/runbot/r-d-1?search=${branchName}`;
    vscode.env.openExternal(vscode.Uri.parse(url));
  })
);

export const isDependentOn = createCommand(
  "odooDev.isDependentOn",
  screamOnError(async (utils) => {
    const addon = await vscode.window.showQuickPick(Object.keys(utils.addonsPathMap), {
      title: "Select dependent addon",
      placeHolder: "e.g. point_of_sale",
    });

    if (!addon) {
      return;
    }

    const requirement = await vscode.window.showQuickPick(Object.keys(utils.addonsPathMap), {
      title: "Select requirement",
      placeHolder: "e.g. account",
    });

    if (!requirement) {
      return;
    }

    const isDependent = utils.isDependentOn(addon, requirement);
    if (isDependent) {
      vscode.window.showInformationMessage(`${addon} is dependent on ${requirement}`);
    } else {
      vscode.window.showErrorMessage(`${addon} is not dependent on ${requirement}`);
    }
  })
);

export const copyBranchName = createCommand(
  "odooDev.copyBranchName",
  screamOnError(async (utils, item) => {
    const branchName = item ? item.name : getActiveBranch();
    if (!branchName) {
      throw new Error(`Please select a dev branch.`);
    }
    await vscode.env.clipboard.writeText(branchName);
  })
);
