import * as vscode from "vscode";
import {
  ensureRemoteOdooDevConfig,
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

export const addBranch = createCommand(
  "odoo-dev-plugin.addBranch",
  screamOnError(async (utils) => {
    await ensureRemoteOdooDevConfig(utils.getOdooRepo());

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
      await utils.createDevBranch(base, input);
      utils.db.addDevBranch({ base, name: input });
    });
  })
);

export const removeBranch = createCommand(
  "odoo-dev-plugin.removeBranch",
  screamOnError(async (utils) => {
    const devBranches = utils
      .getBaseBranches()
      .map((base) => utils.db.getDevBranches(base).map((branch) => ({ ...branch, base })))
      .flat();

    const selected = await vscode.window.showQuickPick(
      devBranches.map((b) => ({ ...b, label: b.name })),
      { title: "Select the dev branch to remove" }
    );

    if (selected === undefined) {
      return;
    }

    return utils.refreshTreeOnSuccess(async () => {
      if (selected.base === selected.name) {
        // Not really possible at the moment. But better be sure.
        throw new Error(`Deleting base branch '${selected.base}' is not allowed.`);
      }
      if (utils.db.getActiveBranch() === selected.name) {
        await utils.selectBranch(selected.base);
      }
      await utils.deleteDevBranch(selected.name);
      utils.db.removeDevBranch(selected);
    });
  })
);

export const selectBranch = createCommand(
  "odoo-dev-plugin.selectBranch",
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

    return utils.refreshTreeOnSuccess(() => utils.selectBranch(selected.name));
  })
);

export const startServer = createCommand(
  "odoo-dev-plugin.startServer",
  screamOnError(async ({ getOdooDevTerminal }) => {
    const python = vscode.workspace.getConfiguration("python").defaultInterpreterPath;
    const odooBin = `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/odoo/odoo-bin`;
    const configFile = `${
      vscode.workspace.getConfiguration("odooDev").sourceFolder
    }/.odoo-dev-plugin/odoo.conf`;
    const terminal = getOdooDevTerminal();
    terminal.sendText(`${python} ${odooBin} -c ${configFile}`);
  })
);

export const debugServer = createCommand(
  "odoo-dev-plugin.debugServer",
  screamOnError(async () => {
    const debugOdooPythonLaunchConfig: vscode.DebugConfiguration = {
      name: "Debug Odoo Python",
      type: "python",
      request: "launch",
      stopOnEntry: false,
      python: "${command:python.interpreterPath}",
      console: "integratedTerminal",
      program: "${workspaceFolder:odoo}/odoo-bin",
      args: ["-c", "${workspaceFolder:.odoo-dev-plugin}/odoo.conf"],
    };
    await vscode.debug.startDebugging(undefined, debugOdooPythonLaunchConfig);
  })
);

export const startServerWithInstall = createCommand(
  "odoo-dev-plugin.startServerWithInstall",
  screamOnError(async ({ getOdooDevTerminal }) => {
    const selectedAddons = await multiSelectAddons();
    if (!selectedAddons) {
      return;
    }

    const python = vscode.workspace.getConfiguration("python").defaultInterpreterPath;
    const odooBin = `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/odoo/odoo-bin`;
    const configFile = `${
      vscode.workspace.getConfiguration("odooDev").sourceFolder
    }/.odoo-dev-plugin/odoo.conf`;
    const command = `${python} ${odooBin} -c ${configFile}${
      selectedAddons.length > 1 ? ` -i ${selectedAddons.join(",")}` : ""
    }`;
    getOdooDevTerminal().sendText(command);
  })
);

export const debugServerWithInstall = createCommand(
  "odoo-dev-plugin.debugServerWithInstall",
  screamOnError(async () => {
    const selectedAddons = await multiSelectAddons();
    if (!selectedAddons) {
      return;
    }

    const debugOdooPythonLaunchConfig: vscode.DebugConfiguration = {
      name: "Debug Odoo Python",
      type: "python",
      request: "launch",
      stopOnEntry: false,
      python: "${command:python.interpreterPath}",
      console: "integratedTerminal",
      program: "${workspaceFolder:odoo}/odoo-bin",
      args: ["-c", "${workspaceFolder:.odoo-dev-plugin}/odoo.conf", "-i", selectedAddons.join(",")],
    };
    await vscode.debug.startDebugging(undefined, debugOdooPythonLaunchConfig);
  })
);

export const startServerWithUpdate = createCommand(
  "odoo-dev-plugin.startServerWithUpdate",
  screamOnError(async ({ getOdooDevTerminal }) => {
    const selectedAddons = await multiSelectAddons();
    if (!selectedAddons) {
      return;
    }

    const python = vscode.workspace.getConfiguration("python").defaultInterpreterPath;
    const odooBin = `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/odoo/odoo-bin`;
    const configFile = `${
      vscode.workspace.getConfiguration("odooDev").sourceFolder
    }/.odoo-dev-plugin/odoo.conf`;
    const command = `${python} ${odooBin} -c ${configFile}${
      selectedAddons.length > 0 ? ` -u ${selectedAddons.join(",")}` : ""
    }`;
    getOdooDevTerminal().sendText(command);
  })
);

export const debugServerWithUpdate = createCommand(
  "odoo-dev-plugin.debugServerWithUpdate",
  screamOnError(async () => {
    const selectedAddons = await multiSelectAddons();
    if (!selectedAddons) {
      return;
    }

    const debugOdooPythonLaunchConfig: vscode.DebugConfiguration = {
      name: "Debug Odoo Python",
      type: "python",
      request: "launch",
      stopOnEntry: false,
      python: "${command:python.interpreterPath}",
      console: "integratedTerminal",
      program: "${workspaceFolder:odoo}/odoo-bin",
      args: ["-c", "${workspaceFolder:.odoo-dev-plugin}/odoo.conf", "-u", selectedAddons.join(",")],
    };
    await vscode.debug.startDebugging(undefined, debugOdooPythonLaunchConfig);
  })
);

export const startSelectedTest = createCommand(
  "odoo-dev-plugin.startSelectedTest",
  screamOnError(async ({ getOdooDevTerminal, getTestTag }) => {
    const terminal = getOdooDevTerminal();
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      throw new Error(
        "Open the test file and put the cursor in the test method you want to start."
      );
    }
    const testTag = await getTestTag(editor);
    const python = vscode.workspace.getConfiguration("python").defaultInterpreterPath;
    const odooBin = `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/odoo/odoo-bin`;
    const configFile = `${
      vscode.workspace.getConfiguration("odooDev").sourceFolder
    }/.odoo-dev-plugin/odoo.conf`;

    terminal.sendText(
      `${python} ${odooBin} -c ${configFile} --stop-after-init --test-enable --test-tags ${testTag}`
    );
  })
);

export const debugSelectedTest = createCommand(
  "odoo-dev-plugin.debugSelectedTest",
  screamOnError(async ({ getTestTag }) => {
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
      python: "${command:python.interpreterPath}",
      console: "integratedTerminal",
      program: "${workspaceFolder:odoo}/odoo-bin",
      args: [
        "-c",
        "${workspaceFolder:.odoo-dev-plugin}/odoo.conf",
        "--stop-after-init",
        "--test-enable",
        "--test-tags",
        testTag,
      ],
    };
    await vscode.debug.startDebugging(undefined, debugOdooPythonLaunchConfig);
  })
);

export const startCurrentTestFile = createCommand(
  "odoo-dev-plugin.startCurrentTestFile",
  screamOnError(async ({ getTestFilePath, getOdooDevTerminal }) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      throw new Error("Open a test file.");
    }

    const testFilePath = getTestFilePath(editor);
    const python = vscode.workspace.getConfiguration("python").defaultInterpreterPath;
    const odooBin = `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/odoo/odoo-bin`;
    const configFile = `${
      vscode.workspace.getConfiguration("odooDev").sourceFolder
    }/.odoo-dev-plugin/odoo.conf`;

    const terminal = getOdooDevTerminal();
    terminal.sendText(
      `${python} ${odooBin} -c ${configFile} --stop-after-init --test-file ${testFilePath}`
    );
  })
);

export const debugCurrentTestFile = createCommand(
  "odoo-dev-plugin.debugCurrentTestFile",
  screamOnError(async ({ getTestFilePath }) => {
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
      python: "${command:python.interpreterPath}",
      console: "integratedTerminal",
      program: "${workspaceFolder:odoo}/odoo-bin",
      args: [
        "-c",
        "${workspaceFolder:.odoo-dev-plugin}/odoo.conf",
        "--stop-after-init",
        "--test-file",
        testFilePath,
      ],
    };
    await vscode.debug.startDebugging(undefined, debugOdooPythonLaunchConfig);
  })
);

export const getTestTag = createCommand(
  "odoo-dev-plugin.getTestTag",
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
  "odoo-dev-plugin.getLocalServerUrl",
  screamOnError(async () => {
    const ip = await runShellCommand(
      `ifconfig en0 | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}'`
    );
    const url = `http://${ip.trim()}:8070`;
    await vscode.env.clipboard.writeText(url);
  })
);

export const openOdooConf = createCommand(
  "odoo-dev-plugin.openOdooConf",
  screamOnError(async () => {
    const odooDevPluginFolder = vscode.workspace.workspaceFolders?.find(
      (f) => f.name === ".odoo-dev-plugin"
    );
    if (!odooDevPluginFolder) {
      throw new Error(`'.odoo-dev-plugin' folder is missing from the source folder.`);
    }
    const confUri = vscode.Uri.joinPath(odooDevPluginFolder.uri, "odoo.conf");
    if (confUri) {
      vscode.window.showTextDocument(confUri);
    } else {
      throw new Error(`'odoo.conf' file is missing in the '.odoo-dev-plugin' folder.`);
    }
  })
);
