/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from "vscode";
import * as Result from "./Result";
import * as fs from "fs";
import fetch from "node-fetch";
import {
  createTemplateNote,
  fileExists,
  getAddons,
  getBase,
  getPositionFromIndex,
  inferBaseBranch,
  isBaseBranch,
  isValidDirectory,
  runShellCommand,
  zip,
  startDebugging,
} from "./helpers";
import { type ContextualUtils } from "./contextualUtils";
import { OdooDevBranch } from "./odoo_dev_branch";
import { DEBUG_JS_NAME, DEBUG_ODOO_SHELL, DEBUG_PYTHON_NAME, DEV_BRANCH_REGEX } from "./constants";
import { withProgress } from "./decorators";
import {
  addBaseBranch,
  addDevBranch,
  devBranchExists,
  getBaseBranches,
  getDevBranches,
  removeDevBranch,
} from "./state";
import { Repository } from "./dependencies/git";

const odooDevOutput = vscode.window.createOutputChannel("Odoo Dev");

function createCommand<T>(
  name: string,
  cb: (utils: ContextualUtils, item?: OdooDevBranch) => Promise<T>
) {
  return (utils: ContextualUtils) => {
    return {
      name,
      method: async (item?: OdooDevBranch) => {
        const result = await Result.try_(cb, utils, item);
        if (!Result.check(result)) {
          const message = result.error.message;
          odooDevOutput.appendLine(message);
          vscode.window.showErrorMessage(message);
        } else {
          return result.value;
        }
      },
    };
  };
}

export const createBranch = createCommand("odooDev.createBranch", async (utils) => {
  if (!Result.check(await utils.ensureNoRunningServer())) {
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
    throw new Error("Empty input is invalid.");
  }

  const dirtyRepos = await utils.getDirtyRepoNames();
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

  const baseBranches = getBaseBranches();
  if (!baseBranches.includes(base)) {
    throw new Error(`Fetch the stable branch '${base}' before creating a dev branch out of it.`);
  } else if (devBranchExists({ base, name: input })) {
    throw new Error(`'${input}' already exists!`);
  }
  await utils.createBranches(base, input, dirtyRepos);
  addDevBranch(base, input);
  utils.pushBranchHistory(input);
});

/**
 * This is a quick picker that allows custom value from the user.
 */
function showQuickInput(options: { label: string }[], title: string): Promise<{ label: string }> {
  return new Promise((resolve) => {
    const quickPick = vscode.window.createQuickPick();
    quickPick.canSelectMany = false;
    quickPick.items = options;
    quickPick.title = title;
    quickPick.onDidAccept(() => {
      if (quickPick.activeItems.length === 0) {
        resolve({ label: quickPick.value });
      } else {
        resolve(quickPick.activeItems[0]);
      }
      quickPick.hide();
    });
    quickPick.onDidHide(() => quickPick.dispose());
    quickPick.show();
  });
}

export const findBranch = createCommand("odooDev.findBranch", async (utils) => {
  if (!Result.check(await utils.ensureNoRunningServer())) {
    return;
  }

  const devBranches = getBaseBranches()
    .map((base) => [
      { base, name: base },
      ...getDevBranches(base).map((branch) => ({ ...branch, base })),
    ])
    .flat();

  const { label: input } = await showQuickInput(
    utils.sortBranchSelections(devBranches).map((b) => ({ label: b.name })),
    "Branch Name"
  );

  if (input === "") {
    throw new Error("Empty input is invalid.");
  }

  const dirtyRepos = await utils.getDirtyRepoNames();
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

  let forkName: string | undefined;
  let branch: string;
  if (input.includes(":")) {
    [forkName, branch] = input.split(":").map((s) => s.trim());
  } else {
    branch = input.trim();
  }

  const base = inferBaseBranch(branch);
  const baseBranches = getBaseBranches();
  if (base && !baseBranches.includes(base)) {
    addBaseBranch(base);
  } else if (devBranchExists({ base, name: branch }) || baseBranches.includes(branch)) {
    await utils.checkoutBranches(branch, dirtyRepos);
    return utils.pushBranchHistory(branch);
  }
  await utils.fetchOrCreateBranches(base, branch, dirtyRepos, forkName, true);
  addDevBranch(base, branch);
  utils.pushBranchHistory(branch);
});

export const fetchBranch = createCommand("odooDev.fetchBranch", async (utils) => {
  if (!Result.check(await utils.ensureNoRunningServer())) {
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
    throw new Error("Empty input is invalid.");
  }

  const dirtyRepos = await utils.getDirtyRepoNames();
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

  let forkName: string | undefined;
  let branch: string;
  if (input.includes(":")) {
    [forkName, branch] = input.split(":").map((s) => s.trim());
  } else {
    branch = input.trim();
  }

  const base = inferBaseBranch(branch);
  const baseBranches = getBaseBranches();
  if (!baseBranches.includes(base)) {
    addBaseBranch(base);
  } else if (devBranchExists({ base, name: branch })) {
    const response = await vscode.window.showInformationMessage(
      "Branch already exists, checkout?",
      { modal: true },
      "Okay"
    );
    if (response === "Okay") {
      await utils.checkoutBranches(branch, dirtyRepos);
    }
    return utils.pushBranchHistory(branch);
  }
  await utils.fetchBranches(base, branch, dirtyRepos, forkName);
  addDevBranch(base, branch);
  utils.pushBranchHistory(branch);
});

export const fetchOrCreate = createCommand("odooDev.fetchOrCreate", async (utils) => {
  if (!Result.check(await utils.ensureNoRunningServer())) {
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
    throw new Error("Empty input is invalid.");
  }

  const dirtyRepos = await utils.getDirtyRepoNames();
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

  let forkName: string | undefined;
  let branch: string;
  if (input.includes(":")) {
    [forkName, branch] = input.split(":").map((s) => s.trim());
  } else {
    branch = input.trim();
  }

  const base = inferBaseBranch(branch);

  if (devBranchExists({ base, name: branch })) {
    throw new Error(`'${branch}' already exists!`);
  }
  await utils.fetchOrCreateBranches(base, branch, dirtyRepos, forkName);
  addDevBranch(base, branch);
  utils.pushBranchHistory(branch);
});

export const fetchStableBranch = createCommand("odooDev.fetchStableBranch", async (utils) => {
  if (!Result.check(await utils.ensureNoRunningServer())) {
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
    throw new Error("Empty input is invalid.");
  }

  const dirtyRepos = await utils.getDirtyRepoNames();
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

  const baseBranches = getBaseBranches();
  if (!baseBranches.includes(branch)) {
    addBaseBranch(branch);
  }
  await utils.fetchStableBranches(branch, dirtyRepos);
  utils.pushBranchHistory(branch);
});

export const deleteBranch = createCommand("odooDev.deleteBranch", async (utils, item) => {
  if (!Result.check(await utils.ensureNoRunningServer())) {
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
        utils.sortBranchSelections(devBranches).map((b) => ({ ...b, label: b.name })),
        { title: "Select the dev branch to delete" }
      );

  if (selected === undefined) {
    return;
  }

  const dirtyRepos = await utils.getDirtyRepos();
  if (dirtyRepos.length !== 0) {
    const names = dirtyRepos.map((repo) => repo.state.HEAD?.name).filter(Boolean);
    const answer = await vscode.window.showInformationMessage(
      `Uncommitted changes in: ${names.join(", ")}. The changes will be lost. Continue?`,
      {
        modal: true,
      },
      "Yes"
    );
    if (answer !== "Yes") {
      return;
    }
    await Promise.all(
      dirtyRepos.map(async (repo) => {
        if (repo) {
          return runShellCommand(`git reset --hard`, { cwd: repo.rootUri.fsPath });
        }
      })
    );
  }

  const { base, name: branch } = selected;
  if (base === branch) {
    // Not really possible at the moment. But better be sure.
    throw new Error(`Deleting base branch '${base}' is not allowed.`);
  }
  await utils.deleteBranches(base, branch);
  removeDevBranch(base, branch);
  utils.removeAndPushBranchHistory(branch, base);
});

export const checkoutBranch = createCommand("odooDev.checkoutBranch", async (utils, item) => {
  if (!Result.check(await utils.ensureNoRunningServer())) {
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
        utils.sortBranchSelections(devBranches).map((b) => ({ ...b, label: b.name })),
        { title: "Choose from the list" }
      );

  if (selected === undefined) {
    return;
  }

  const dirtyRepos = await utils.getDirtyRepoNames();
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

  await utils.checkoutBranches(selected.name, dirtyRepos);
  utils.pushBranchHistory(selected.name);
});

export const rebaseBranch = createCommand("odooDev.rebaseActive", async (utils, item) => {
  if (!Result.check(await utils.ensureNoRunningServer())) {
    return;
  }

  const dirtyRepos = await utils.getDirtyRepoNames();
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

  await utils.rebaseBranches(dirtyRepos);
});

export const resetActiveBranch = createCommand("odooDev.resetActive", async (utils) => {
  if (!Result.check(await utils.ensureNoRunningServer())) {
    return;
  }

  const dirtyRepos = await utils.getDirtyRepoNames();
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

  await utils.resetBranches(dirtyRepos);
});

export const startFreshServer = createCommand("odooDev.startFreshServer", async (utils) => {
  if (!Result.check(await utils.ensureNoRunningServer())) {
    return;
  }

  const dbName = await utils.getDBName();

  if (dbName) {
    const selectedAddons = await utils.multiSelectAddons();
    if (!selectedAddons) {
      return;
    }
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
    utils.startServerWithInstall(selectedAddons);
  }
});

export const debugFreshServer = createCommand("odooDev.debugFreshServer", async (utils) => {
  if (!Result.check(await utils.ensureNoRunningServer({ waitForKill: true }))) {
    return;
  }

  const dbName = await utils.getDBName();

  if (dbName) {
    const selectedAddons = await utils.multiSelectAddons();
    if (!selectedAddons) {
      return;
    }
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
    utils.debugServerWithInstall(selectedAddons, odooDevOutput);
  }
});

export const startServer = createCommand("odooDev.startServer", async (utils) => {
  if (!Result.check(await utils.ensureNoRunningServer({ waitForKill: true }))) {
    return;
  }

  const commandArgs = await utils.getStartServerArgs();
  const python = await utils.getPythonPath();
  const odooBin = `${utils.getRepoPath(utils.odevRepos.odoo)}/odoo-bin`;
  utils.sendStartServerCommand(
    `${python} ${odooBin} ${commandArgs.join(" ")}`,
    utils.getOdooServerTerminal()
  );
});

export const toggleWithDemoData = createCommand("odooDev.toggleWithDemoData", async (utils) => {
  return utils.toggleWithDemoData();
});

export const debugServer = createCommand("odooDev.debugServer", async (utils) => {
  if (!Result.check(await utils.ensureNoRunningServer({ waitForKill: true }))) {
    return;
  }

  const odooBin = `${utils.getRepoPath(utils.odevRepos.odoo)}/odoo-bin`;
  const commandArgs = await utils.getStartServerArgs();
  const debugOdooPythonLaunchConfig: vscode.DebugConfiguration = {
    name: DEBUG_PYTHON_NAME,
    type: "python",
    request: "launch",
    stopOnEntry: false,
    console: "integratedTerminal",
    cwd: `${utils.getRepoPath(utils.odevRepos.odoo)}`,
    python: await utils.getPythonPath(),
    program: odooBin,
    variablePresentation: {
      all: "hide",
    },
    args: commandArgs,
  };
  await startDebugging(debugOdooPythonLaunchConfig, odooDevOutput);
  vscode.commands.executeCommand("setContext", "odooDev.hasActiveServer", true);
  utils.odooServerStatus.command = "odooDev.stopActiveServer";
  utils.odooServerStatus.text = "$(debug-stop) Stop Odoo Server";
});

export const startOdooShell = createCommand("odooDev.startOdooShell", async (utils) => {
  const commandArgs = await utils.getOdooShellCommandArgs();
  const python = await utils.getPythonPath();
  const odooBin = `${utils.getRepoPath(utils.odevRepos.odoo)}/odoo-bin`;
  utils.sendStartServerCommand(
    `${python} ${odooBin} ${commandArgs.join(" ")}`,
    utils.getOdooShellTerminal()
  );
});

export const debugOdooShell = createCommand("odooDev.debugOdooShell", async (utils) => {
  const odooBin = `${utils.getRepoPath(utils.odevRepos.odoo)}/odoo-bin`;
  const commandArgs = await utils.getOdooShellCommandArgs();
  const debugOdooPythonLaunchConfig: vscode.DebugConfiguration = {
    name: DEBUG_ODOO_SHELL,
    type: "python",
    request: "launch",
    stopOnEntry: false,
    console: "integratedTerminal",
    cwd: `${utils.getRepoPath(utils.odevRepos.odoo)}`,
    python: await utils.getPythonPath(),
    program: odooBin,
    variablePresentation: {
      all: "hide",
    },
    args: commandArgs,
  };
  await startDebugging(debugOdooPythonLaunchConfig, odooDevOutput);
});

export const startServerWithInstall = createCommand(
  "odooDev.startServerWithInstall",
  async (utils) => {
    if (!Result.check(await utils.ensureNoRunningServer({ waitForKill: true }))) {
      return;
    }

    const selectedAddons = await utils.multiSelectAddons();
    if (!selectedAddons) {
      return;
    }

    utils.startServerWithInstall(selectedAddons);
  }
);

export const debugServerWithInstall = createCommand(
  "odooDev.debugServerWithInstall",
  async (utils) => {
    if (!Result.check(await utils.ensureNoRunningServer({ waitForKill: true }))) {
      return;
    }

    const selectedAddons = await utils.multiSelectAddons();
    if (!selectedAddons) {
      return;
    }

    utils.debugServerWithInstall(selectedAddons, odooDevOutput);
  }
);

export const startServerWithUpdate = createCommand(
  "odooDev.startServerWithUpdate",
  async (utils) => {
    if (!Result.check(await utils.ensureNoRunningServer({ waitForKill: true }))) {
      return;
    }

    const selectedAddons = await utils.multiSelectAddons();
    if (!selectedAddons) {
      return;
    }

    const startServerArgs = await utils.getStartServerArgs();
    const args = [...startServerArgs, "-u", selectedAddons.join(",")];

    const python = await utils.getPythonPath();
    const odooBin = `${utils.getRepoPath(utils.odevRepos.odoo)}/odoo-bin`;
    utils.sendStartServerCommand(
      `${python} ${odooBin} ${args.join(" ")}`,
      utils.getOdooServerTerminal()
    );
  }
);

export const debugServerWithUpdate = createCommand(
  "odooDev.debugServerWithUpdate",
  async (utils) => {
    if (!Result.check(await utils.ensureNoRunningServer({ waitForKill: true }))) {
      return;
    }

    const selectedAddons = await utils.multiSelectAddons();
    if (!selectedAddons) {
      return;
    }

    const odooBin = `${utils.getRepoPath(utils.odevRepos.odoo)}/odoo-bin`;
    const startServerArgs = await utils.getStartServerArgs();
    const args = [...startServerArgs, "-u", selectedAddons.join(",")];

    const debugOdooPythonLaunchConfig: vscode.DebugConfiguration = {
      name: DEBUG_PYTHON_NAME,
      type: "python",
      request: "launch",
      stopOnEntry: false,
      console: "integratedTerminal",
      cwd: `${utils.getRepoPath(utils.odevRepos.odoo)}`,
      python: await utils.getPythonPath(),
      program: odooBin,
      variablePresentation: {
        all: "hide",
      },
      args,
    };
    await startDebugging(debugOdooPythonLaunchConfig, odooDevOutput);
    vscode.commands.executeCommand("setContext", "odooDev.hasActiveServer", true);
    utils.odooServerStatus.command = "odooDev.stopActiveServer";
    utils.odooServerStatus.text = "$(debug-stop) Stop Odoo Server";
  }
);

export const debugJS = createCommand("odooDev.debugJS", async (utils) => {
  const odooAddonsPath = `${utils.getRepoPath(utils.odevRepos.odoo)}/addons`;
  const customAddonsPaths = Object.entries(utils.odevRepos.custom).map(([, repo]) => {
    return utils.getRepoPath(repo);
  });

  const url = await utils.getServerUrl({ debug: "assets" });

  const getAddonPairs = async (path: string) => {
    const addons = await getAddons(path);
    return addons.map((name) => [name, path]);
  };

  const odooAddonPairs = await getAddonPairs(odooAddonsPath);
  const addonPairs = [
    ...odooAddonPairs,
    ...(await Promise.all(customAddonsPaths.map(getAddonPairs))).flat(),
  ];

  const sourceMapPathOverrides = Object.fromEntries(
    addonPairs.map(([name, path]) => [`../../..//${name}/*`, `${path}/${name}/*`])
  );

  const debugOdooPythonLaunchConfig: vscode.DebugConfiguration = {
    name: DEBUG_JS_NAME,
    type: "chrome",
    request: "launch",
    url,
    sourceMaps: true,
    sourceMapPathOverrides,
  };
  await startDebugging(debugOdooPythonLaunchConfig, odooDevOutput);
});

export const dropActiveDB = createCommand("odooDev.dropActiveDB", async (utils) => {
  if (!Result.check(await utils.ensureNoRunningServer({ waitForKill: true }))) {
    return;
  }
  const dbName = await utils.getDBName();
  if (dbName) {
    utils.getOdooServerTerminal().show();
    utils.getOdooServerTerminal().sendText(`dropdb ${dbName}`);
  }
});

export const getTestTag = createCommand("odooDev.getTestTag", async ({ getTestTag }) => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    throw new Error("Open a test file.");
  }
  const testTag = await getTestTag(editor);
  await vscode.env.clipboard.writeText(testTag);
});

export const openChromeLocalServer = createCommand(
  "odooDev.openChromeLocalServer",
  async ({ getServerUrl }) => {
    // TODO: check if there is an active server
    const url = await getServerUrl();
    switch (process.platform) {
      case "darwin": {
        const chromePath = await runShellCommand(
          `mdfind 'kMDItemCFBundleIdentifier == "com.google.Chrome"'`
        );
        const chrome = chromePath.trim();
        if (chrome === "") {
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
          vscode.env.openExternal(vscode.Uri.parse(url));
        }
        break;
      }
      default: {
        throw new Error(`Unsupported platform: ${process.platform}`);
      }
    }
  }
);

export const openOdooConf = createCommand("odooDev.openOdooConf", async ({ getConfigFilePath }) => {
  const filePath = await getConfigFilePath();
  const confUri = vscode.Uri.file(filePath);
  if (confUri) {
    vscode.window.showTextDocument(confUri);
  }
});

export const openLinkedNote = createCommand("odooDev.openLinkedNote", async (utils, item) => {
  const branch = item ? item.name : await utils.getActiveBranch();
  if (!branch) {
    throw new Error(`There is no selected branch.`);
  }

  let notesFolder = (vscode.workspace.getConfiguration("odooDev").notesFolder || "") as string;
  if (!isValidDirectory(notesFolder)) {
    const willSelectFolder = await vscode.window.showInformationMessage(
      "Odoo Dev Notes Folder isn't properly set, do you want to set it?",
      {
        modal: true,
      },
      "Yes"
    );
    if (!willSelectFolder) {
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
});

export const stopActiveServer = createCommand("odooDev.stopActiveServer", async (utils) => {
  await utils.ensureNoActiveServer({ shouldConfirm: false });
  await utils.ensureNoDebugSession(false);
  vscode.commands.executeCommand("setContext", "odooDev.hasActiveServer", false);
  utils.odooServerStatus.command = "odooDev.startServer";
  utils.odooServerStatus.text = "$(debug-start) Start Odoo Server";
});

export const openPullRequestLink = createCommand(
  "odooDev.openPullRequestLinkOdoo",
  async (utils, item) => {
    const odoo = utils.odevRepos.odoo;
    let branch = item ? item.name : odoo.state.HEAD?.name;

    if (!branch || isBaseBranch(branch)) {
      branch = await utils.selectDevBranch();
      if (!branch) {
        throw new Error(`Please select a dev branch.`);
      }
    }

    const response = await fetch(
      `https://api.github.com/repos/odoo/odoo/pulls?head=odoo-dev:${branch}&state=all`
    );
    const pullRequests = await response.json();
    const [pr] = pullRequests;
    if (!pr) {
      throw new Error(`There is no pull request (odoo) from the branch '${branch}'.`);
    }
    vscode.env.openExternal(vscode.Uri.parse(pr.html_url));
  }
);

export const openPullRequestLinkEnterprise = createCommand(
  "odooDev.openPullRequestLinkEnterprise",
  async (utils, item) => {
    const githubAccessToken = await utils.getGithubAccessToken();
    const enterprise: Repository | undefined = utils.odevRepos.custom.enterprise;
    let branch = item ? item.name : enterprise.state.HEAD?.name;

    if (!branch || isBaseBranch(branch)) {
      branch = await utils.selectDevBranch();
      if (!branch) {
        throw new Error(`Please select a dev branch.`);
      }
    }

    const response = await fetch(
      `https://api.github.com/repos/odoo/enterprise/pulls?head=odoo-dev:${branch}&state=all`,
      {
        headers: {
          Authorization: `Bearer ${githubAccessToken}`,
        },
      }
    );
    const pullRequests = await response.json();
    const [pr] = pullRequests;
    if (!pr) {
      throw new Error(`There is no pull request (enterprise) from the branch '${branch}'.`);
    }
    vscode.env.openExternal(vscode.Uri.parse(pr.html_url));
  }
);

export const openPullRequestLinkUpgrade = createCommand(
  "odooDev.openPullRequestLinkUpgrade",
  async (utils, item) => {
    const githubAccessToken = await utils.getGithubAccessToken();
    const upgrade = utils.odevRepos.upgrade;
    let branch = item ? item.name : upgrade?.state.HEAD?.name;

    if (!branch || isBaseBranch(branch)) {
      branch = await utils.selectDevBranch();
      if (!branch) {
        throw new Error(`Please select a dev branch.`);
      }
    }

    const response = await fetch(
      `https://api.github.com/repos/odoo/upgrade/pulls?head=odoo:${branch}&state=all`,
      {
        headers: {
          Authorization: `Bearer ${githubAccessToken}`,
        },
      }
    );
    const pullRequests = await response.json();
    const [pr] = pullRequests;
    if (!pr) {
      throw new Error(`There is no pull request (upgrade) from the branch '${branch}'.`);
    }
    vscode.env.openExternal(vscode.Uri.parse(pr.html_url));
  }
);

export const openRunbotLink = createCommand("odooDev.openRunbotLink", async (utils, item) => {
  const branch = item ? item.name : await utils.getActiveBranch();
  if (!branch || isBaseBranch(branch)) {
    throw new Error(`Please select a dev branch.`);
  }
  const url = `https://runbot.odoo.com/runbot/r-d-1?search=${branch}`;
  vscode.env.openExternal(vscode.Uri.parse(url));
});

export const isDependentOn = createCommand("odooDev.isDependentOn", async (utils) => {
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
});

export const copyBranchName = createCommand("odooDev.copyBranchName", async (utils, item) => {
  const branch = item ? item.name : await utils.getActiveBranch();
  if (!branch) {
    throw new Error(`Please select a dev branch.`);
  }
  await vscode.env.clipboard.writeText(branch);
});

export const gotoTestMethod = createCommand("odooDev.gotoTestMethod", async (utils) => {
  const input = await vscode.window.showInputBox({
    placeHolder: "e.g. TestUi.test_01_pos_basic_order or test_01_pos_basic_order",
    prompt: "Test method to navigate to",
  });

  if (!input) {
    return;
  }

  const repositories: Record<string, Repository> = {
    odoo: utils.odevRepos.odoo,
    ...utils.odevRepos.custom,
  };
  if (utils.odevRepos.upgrade) {
    repositories.upgrade = utils.odevRepos.upgrade;
  }

  let classToFind: string | undefined;
  let methodToFind: string;

  const splitInput = input.split(".");
  if (splitInput.length === 1) {
    methodToFind = splitInput[0];
  } else {
    [classToFind, methodToFind] = splitInput;
  }

  classToFind = classToFind === "" ? undefined : classToFind?.trim();
  methodToFind = methodToFind.trim();

  const potentialResults: { path: string; index: number; name: string; repoName: string }[] = [];

  for (const [repoName, repo] of Object.entries(repositories)) {
    const pattern = new vscode.RelativePattern(repo.rootUri, "**/tests/**/*.py");
    const testFileUris = await vscode.workspace.findFiles(pattern, "**/node_modules/**");
    for (const uri of testFileUris) {
      const filePath = uri.fsPath;
      const fileContent = fs.readFileSync(filePath, "utf-8");
      const testClassRegex = /class\s+(\w+)\(.*\):/g;
      const testMethodRegex = /\s+def\s+(test_\w+)\(\w+\):\n/g;
      const testClassMatches = [...fileContent.matchAll(testClassRegex)];
      if (testClassMatches.length > 0) {
        const matchPairs = zip(testClassMatches, testClassMatches.slice(1));
        for (const [classMatch1, classMatch2] of matchPairs) {
          const [matchedString, className] = classMatch1;
          if (classToFind && className !== classToFind) {
            continue;
          }
          const classBodyStart = classMatch1.index! + matchedString.length;
          const classBodyEnd = classMatch2 ? classMatch2.index! : fileContent.length;
          const classBody = fileContent.slice(classBodyStart, classBodyEnd);
          const testMethods = classBody.matchAll(testMethodRegex);
          for (const testMethodMatch of testMethods) {
            const [matchedString, testMethodName] = testMethodMatch;
            const methodNameIndex = matchedString.indexOf(testMethodName);
            if (testMethodName === methodToFind) {
              const methodIndex = classBodyStart + testMethodMatch.index! + methodNameIndex;
              potentialResults.push({
                path: filePath,
                index: methodIndex,
                name: `${className}.${testMethodName}`,
                repoName,
              });
            }
          }
        }
      }
    }
  }

  let selectedResult: { path: string; index: number; name: string } | undefined;
  if (potentialResults.length === 0) {
    throw new Error(`Unable to find test method '${input}'.`);
  } else if (potentialResults.length === 1) {
    selectedResult = potentialResults[0];
  } else {
    const result = await vscode.window.showQuickPick(
      potentialResults.map((r) => {
        const description = `${r.repoName}`;
        return {
          ...r,
          label: r.name,
          description,
          detail: r.path,
        };
      }),
      {
        title: "Multiple methods found, please select one",
      }
    );
    if (!result) {
      return;
    }
    selectedResult = potentialResults.find((r) => r.path === result.path);
  }

  if (selectedResult) {
    const { path, index } = selectedResult;
    const document = await vscode.workspace.openTextDocument(path);
    const start = getPositionFromIndex(document, index);
    const end = getPositionFromIndex(document, index + methodToFind.length);
    await vscode.window.showTextDocument(document, {
      selection: new vscode.Range(start, end),
    });
  }
});

export const push = createCommand("odooDev.push", async (utils) => {
  return utils.push(false);
});

export const pushForce = createCommand("odooDev.pushForce", async (utils) => {
  return utils.push(true);
});

export const deleteMerged = createCommand("odooDev.deleteMerged", async (utils) => {
  const githubAccessToken = await utils.getGithubAccessToken();

  // Limitation: For now, we only support the repositories in odoo.
  const repos = [
    ["odoo", utils.odevRepos.odoo],
    ...Object.entries(utils.odevRepos.custom).map(([name, repo]) => [name, repo]),
    ["upgrade", utils.odevRepos.upgrade],
  ] as [string, Repository][];

  const getUrl = (repoName: string, branch: string) => {
    const fork = repoName === "upgrade" ? "origin" : "odoo-dev";
    return `https://api.github.com/repos/odoo/${repoName}/pulls?head=${fork}:${branch}&state=closed`;
  };

  /**
   * Branch is closed if there is a closed PR linked to it.
   */
  const isBranchClosed = async (repoName: string, branch: string) => {
    const url = getUrl(repoName, branch);
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${githubAccessToken}`,
      },
    });
    const pullRequests = await response.json();
    const [pr] = pullRequests;
    return Boolean(pr);
  };

  const findMerged = withProgress({
    message: `Finding merged branches...`,
    cb: () =>
      Promise.all(
        repos
          .filter(([name]) => ["odoo", "upgrade", "enterprise"].includes(name))
          .map(async ([repoName, repo]) => {
            const activeBranch = repo.state.HEAD?.name;
            if (!activeBranch) {
              return [];
            }
            const branches = await repo.getBranches({
              remote: false,
            });
            const toDelete = [];
            for (const { name: branch } of branches) {
              if (!branch || branch === activeBranch || !DEV_BRANCH_REGEX.test(branch)) {
                continue;
              }
              const isClosed = await isBranchClosed(repoName, branch);
              if (isClosed) {
                toDelete.push(branch);
              }
            }
            return toDelete;
          })
      ),
  });

  const branchesToDelete = new Set((await findMerged()).flat());

  if (branchesToDelete.size === 0) {
    vscode.window.showInformationMessage("No branches to delete.");
    return;
  }

  const branchToDelete = await vscode.window.showQuickPick([...branchesToDelete], {
    title: "Select branches to delete",
    canPickMany: true,
  });

  if (!branchToDelete || branchToDelete.length === 0) {
    return;
  }

  const deleteAll = withProgress({
    message: `Deleting selected branches...`,
    cb: async () => {
      for (const branch of branchToDelete) {
        const base = getBase(branch);
        if (base) {
          await utils.deleteBranches(base, branch, false);
          removeDevBranch(base, branch);
        }
      }
    },
  });

  await deleteAll();
});
