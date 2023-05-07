import * as vscode from "vscode";
import {
  ensureRemoteUrl,
  inferBaseBranch,
  multiSelectAddons,
  runShellCommand,
  screamOnError,
} from "./helpers";
import { type ContextualUtils } from "./contextualUtils";

function createCommand<T>(name: string, cb: (utils: ContextualUtils) => Promise<T>) {
  return (utils: ContextualUtils) => {
    return { name, method: () => cb(utils) };
  };
}

export const createBranch = createCommand(
  "odooDev.createBranch",
  screamOnError(async (utils) => {
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

    const base = inferBaseBranch(input);

    return utils.refreshTreeOnSuccess(async () => {
      const odooDevConfig = vscode.workspace.getConfiguration("odooDev");
      const baseBrances = odooDevConfig.baseBranches as Record<string, number>;

      if (!(base in baseBrances)) {
        await odooDevConfig.update("baseBranches", { ...baseBrances, [base]: 100 }, true);
      } else if (utils.db.devBranchExists({ base, name: input })) {
        throw new Error(`'${input}' already exists!`);
      }
      await utils.createBranches(base, input);
      utils.db.setActiveBranch(input);
      utils.db.addDevBranch({ base, name: input });
    });
  })
);

export const fetchBranch = createCommand(
  "odooDev.fetchBranch",
  screamOnError(async (utils) => {
    await ensureRemoteUrl(utils.getOdooRepo(), utils.getRemoteOdooDevUrl());

    const enterprise = utils.getRepo("enterprise");
    const enterpriseDevUrl = utils.getRemoteEnterpriseDevUrl();
    if (enterprise && enterpriseDevUrl !== "") {
      await ensureRemoteUrl(enterprise, enterpriseDevUrl);
    }

    const upgrade = utils.getRepo("upgrade");
    const upgradeUrl = utils.getRemoteUpgradeUrl();
    if (upgrade && upgradeUrl !== "") {
      await ensureRemoteUrl(upgrade, upgradeUrl);
    }

    const input = await vscode.window.showInputBox({
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

    const base = inferBaseBranch(input);

    return utils.refreshTreeOnSuccess(async () => {
      const odooDevConfig = vscode.workspace.getConfiguration("odooDev");
      const baseBrances = odooDevConfig.baseBranches as Record<string, number>;

      if (!(base in baseBrances)) {
        await odooDevConfig.update("baseBranches", { ...baseBrances, [base]: 100 }, true);
      } else if (utils.db.devBranchExists({ base, name: input })) {
        throw new Error(`'${input}' already exists!`);
      }
      await utils.fetchBranches(base, input);
      utils.db.setActiveBranch(input);
      utils.db.addDevBranch({ base, name: input });
    });
  })
);

export const deleteBranch = createCommand(
  "odooDev.deleteBranch",
  screamOnError(async (utils) => {
    const devBranches = utils
      .getBaseBranches()
      .map((base) => utils.db.getDevBranches(base).map((branch) => ({ ...branch, base })))
      .flat();

    const selected = await vscode.window.showQuickPick(
      devBranches.map((b) => ({ ...b, label: b.name })),
      { title: "Select the dev branch to delete" }
    );

    if (selected === undefined) {
      return;
    }

    return utils.refreshTreeOnSuccess(async () => {
      const { base, name: branch } = selected;
      if (base === branch) {
        // Not really possible at the moment. But better be sure.
        throw new Error(`Deleting base branch '${base}' is not allowed.`);
      }
      const activeBranch = utils.db.getActiveBranch();
      await utils.deleteBranches(base, branch, activeBranch);
      if (activeBranch === branch) {
        utils.db.setActiveBranch(base);
      }
      utils.db.removeDevBranch(selected);
    });
  })
);

export const checkoutBranch = createCommand(
  "odooDev.checkoutBranch",
  screamOnError(async (utils) => {
    const devBranches = utils
      .getBaseBranches()
      .map((base) => [
        { base, name: base },
        ...utils.db.getDevBranches(base).map((branch) => ({ ...branch, base })),
      ])
      .flat();

    const selected = await vscode.window.showQuickPick(
      devBranches.map((b) => ({ ...b, label: b.name })),
      { title: "Choose from the list" }
    );

    if (selected === undefined) {
      return;
    }

    return utils.refreshTreeOnSuccess(async () => {
      await utils.checkoutBranches(selected.name);
      utils.db.setActiveBranch(selected.name);
    });
  })
);

export const startServer = createCommand(
  "odooDev.startServer",
  screamOnError(async ({ getOdooDevTerminal, getStartServerArgs }) => {
    const python = vscode.workspace.getConfiguration("python").defaultInterpreterPath;
    const odooBin = `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/odoo/odoo-bin`;
    getOdooDevTerminal().sendText(`${python} ${odooBin} ${getStartServerArgs().join(" ")}`);
  })
);

export const debugServer = createCommand(
  "odooDev.debugServer",
  screamOnError(async ({ getStartServerArgs }) => {
    const debugOdooPythonLaunchConfig: vscode.DebugConfiguration = {
      name: "Debug Odoo Python",
      type: "python",
      request: "launch",
      stopOnEntry: false,
      console: "integratedTerminal",
      python: "${command:python.interpreterPath}",
      program: "${workspaceFolder:odoo}/odoo-bin",
      args: getStartServerArgs(),
    };
    await vscode.debug.startDebugging(undefined, debugOdooPythonLaunchConfig);
  })
);

export const startServerWithInstall = createCommand(
  "odooDev.startServerWithInstall",
  screamOnError(async ({ getOdooDevTerminal, getStartServerWithInstallArgs }) => {
    const selectedAddons = await multiSelectAddons();
    if (!selectedAddons) {
      return;
    }
    const python = vscode.workspace.getConfiguration("python").defaultInterpreterPath;
    const odooBin = `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/odoo/odoo-bin`;
    const args = getStartServerWithInstallArgs(selectedAddons);
    const command = `${python} ${odooBin} ${args.join(" ")}`;
    getOdooDevTerminal().sendText(command);
  })
);

export const startFreshServer = createCommand(
  "odooDev.startFreshServer",
  screamOnError(async ({ getActiveDBName }) => {
    const dbName = getActiveDBName();
    if (dbName) {
      await runShellCommand(`dropdb ${dbName}`);
    }
    return vscode.commands.executeCommand("odooDev.startServerWithInstall");
  })
);

export const debugServerWithInstall = createCommand(
  "odooDev.debugServerWithInstall",
  screamOnError(async ({ getStartServerWithInstallArgs }) => {
    const selectedAddons = await multiSelectAddons();
    if (!selectedAddons) {
      return;
    }
    const debugOdooPythonLaunchConfig: vscode.DebugConfiguration = {
      name: "Debug Odoo Python",
      type: "python",
      request: "launch",
      stopOnEntry: false,
      console: "integratedTerminal",
      python: "${command:python.interpreterPath}",
      program: "${workspaceFolder:odoo}/odoo-bin",
      args: getStartServerWithInstallArgs(selectedAddons),
    };
    await vscode.debug.startDebugging(undefined, debugOdooPythonLaunchConfig);
  })
);

export const startServerWithUpdate = createCommand(
  "odooDev.startServerWithUpdate",
  screamOnError(async ({ getOdooDevTerminal, getStartServerWithUpdateArgs }) => {
    const selectedAddons = await multiSelectAddons();
    if (!selectedAddons) {
      return;
    }
    const python = vscode.workspace.getConfiguration("python").defaultInterpreterPath;
    const odooBin = `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/odoo/odoo-bin`;
    const args = getStartServerWithUpdateArgs(selectedAddons);
    const command = `${python} ${odooBin} ${args.join(" ")}`;
    getOdooDevTerminal().sendText(command);
  })
);

export const debugServerWithUpdate = createCommand(
  "odooDev.debugServerWithUpdate",
  screamOnError(async ({ getStartServerWithUpdateArgs }) => {
    const selectedAddons = await multiSelectAddons();
    if (!selectedAddons) {
      return;
    }
    const debugOdooPythonLaunchConfig: vscode.DebugConfiguration = {
      name: "Debug Odoo Python",
      type: "python",
      request: "launch",
      stopOnEntry: false,
      console: "integratedTerminal",
      python: "${command:python.interpreterPath}",
      program: "${workspaceFolder:odoo}/odoo-bin",
      args: getStartServerWithUpdateArgs(selectedAddons),
    };
    await vscode.debug.startDebugging(undefined, debugOdooPythonLaunchConfig);
  })
);

export const startSelectedTest = createCommand(
  "odooDev.startSelectedTest",
  screamOnError(async ({ getOdooDevTerminal, getTestTag, getstartSelectedTestArgs }) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      throw new Error(
        "Open the test file and put the cursor in the test method you want to start."
      );
    }
    const testTag = await getTestTag(editor);
    const python = vscode.workspace.getConfiguration("python").defaultInterpreterPath;
    const odooBin = `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/odoo/odoo-bin`;
    const args = getstartSelectedTestArgs(testTag);
    const command = `${python} ${odooBin} ${args.join(" ")}`;
    getOdooDevTerminal().sendText(command);
  })
);

export const debugSelectedTest = createCommand(
  "odooDev.debugSelectedTest",
  screamOnError(async ({ getTestTag, getstartSelectedTestArgs }) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      throw new Error("Open a test file.");
    }
    const testTag = await getTestTag(editor);
    const debugOdooPythonLaunchConfig: vscode.DebugConfiguration = {
      name: "Debug Odoo Python",
      type: "python",
      request: "launch",
      stopOnEntry: false,
      console: "integratedTerminal",
      python: "${command:python.interpreterPath}",
      program: "${workspaceFolder:odoo}/odoo-bin",
      args: getstartSelectedTestArgs(testTag),
    };
    await vscode.debug.startDebugging(undefined, debugOdooPythonLaunchConfig);
  })
);

export const startCurrentTestFile = createCommand(
  "odooDev.startCurrentTestFile",
  screamOnError(async ({ getTestFilePath, getOdooDevTerminal, getStartCurrentTestFileArgs }) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      throw new Error("Open a test file.");
    }
    const testFilePath = getTestFilePath(editor);
    const python = vscode.workspace.getConfiguration("python").defaultInterpreterPath;
    const odooBin = `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/odoo/odoo-bin`;
    const args = getStartCurrentTestFileArgs(testFilePath);
    const command = `${python} ${odooBin} ${args.join(" ")}`;
    getOdooDevTerminal().sendText(command);
  })
);

export const debugCurrentTestFile = createCommand(
  "odooDev.debugCurrentTestFile",
  screamOnError(async ({ getTestFilePath, getStartCurrentTestFileArgs }) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      throw new Error("Open a test file.");
    }
    const testFilePath = getTestFilePath(editor);
    const debugOdooPythonLaunchConfig: vscode.DebugConfiguration = {
      name: "Debug Odoo Python",
      type: "python",
      request: "launch",
      stopOnEntry: false,
      console: "integratedTerminal",
      python: "${command:python.interpreterPath}",
      program: "${workspaceFolder:odoo}/odoo-bin",
      args: getStartCurrentTestFileArgs(testFilePath),
    };
    await vscode.debug.startDebugging(undefined, debugOdooPythonLaunchConfig);
  })
);

export const dropActiveDB = createCommand(
  "odooDev.dropActiveDB",
  screamOnError(async ({ getOdooDevTerminal, getActiveDBName }) => {
    const dbName = getActiveDBName();
    if (dbName) {
      getOdooDevTerminal().sendText(`dropdb ${dbName}`);
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

export const getLocalServerUrl = createCommand(
  "odooDev.getLocalServerUrl",
  screamOnError(async () => {
    const ip = await runShellCommand(
      `ifconfig en0 | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}'`
    );
    const url = `http://${ip.trim()}:8070`;
    await vscode.env.clipboard.writeText(url);
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
