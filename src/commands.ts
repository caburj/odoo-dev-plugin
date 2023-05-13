import * as vscode from "vscode";
import {
  createTemplateNote,
  ensureRemote,
  fileExists,
  getBaseBranches,
  inferBaseBranch,
  multiSelectAddons,
  runShellCommand,
  screamOnError,
} from "./helpers";
import { type ContextualUtils } from "./contextualUtils";
import { isSuccess } from "./Result";
import { OdooDevBranch } from "./odoo_dev_branch";

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

    const ensureResult = await utils.ensureCleanRepos("Odoo Dev: Create");
    if (!isSuccess(ensureResult)) {
      throw new Error(ensureResult);
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
    await ensureRemote("odoo", utils.getOdooRepo());

    const enterprise = utils.getRepo("enterprise");
    if (enterprise) {
      await ensureRemote("enterprise", enterprise);
    }

    const upgrade = utils.getRepo("upgrade");
    if (upgrade) {
      await ensureRemote("upgrade", upgrade);
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

    const ensureResult = await utils.ensureCleanRepos("Odoo Dev: Fetch");
    if (!isSuccess(ensureResult)) {
      throw new Error(ensureResult);
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

export const fetchStableBranch = createCommand(
  "odooDev.fetchStableBranch",
  screamOnError(async (utils) => {
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

    const ensureResult = await utils.ensureCleanRepos("Odoo Dev: Fetch Stable");
    if (!isSuccess(ensureResult)) {
      throw new Error(ensureResult);
    }

    return utils.refreshTreeOnSuccess(async () => {
      const odooDevConfig = vscode.workspace.getConfiguration("odooDev");
      const baseBrances = odooDevConfig.baseBranches as Record<string, number>;

      if (!(branch in baseBrances)) {
        await odooDevConfig.update("baseBranches", { ...baseBrances, [branch]: 100 }, true);
      }
      await utils.fetchStableBranches(branch);
      utils.db.setActiveBranch(branch);
    });
  })
);

export const deleteBranch = createCommand(
  "odooDev.deleteBranch",
  screamOnError(async (utils, item) => {
    const devBranches = getBaseBranches()
      .map((base) => utils.db.getDevBranches(base).map((branch) => ({ ...branch, base })))
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

    const ensureResult = await utils.ensureCleanRepos("Odoo Dev: Delete");
    if (!isSuccess(ensureResult)) {
      throw new Error(ensureResult);
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
  screamOnError(async (utils, item) => {
    const devBranches = getBaseBranches()
      .map((base) => [
        { base, name: base },
        ...utils.db.getDevBranches(base).map((branch) => ({ ...branch, base })),
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

    const ensureResult = await utils.ensureCleanRepos("Odoo Dev: Checkout");
    if (!isSuccess(ensureResult)) {
      throw new Error(ensureResult);
    }

    return utils.refreshTreeOnSuccess(async () => {
      await utils.checkoutBranches(selected.name);
      utils.db.setActiveBranch(selected.name);
    });
  })
);

export const resetActiveBranch = createCommand(
  "odooDev.resetActiveBranch",
  screamOnError(async (utils) => {
    const ensureResult = await utils.ensureCleanRepos("Odoo Dev: Reset Active Branch");
    if (!isSuccess(ensureResult)) {
      throw new Error(ensureResult);
    }

    const activeBranch = utils.db.getActiveBranch();
    if (activeBranch) {
      await utils.resetBranches(activeBranch);
    }
  })
);

export const startServer = createCommand(
  "odooDev.startServer",
  screamOnError(async (utils) => {
    if (!isSuccess(await utils.ensureNoActiveServer())) {
      return;
    }

    if (!isSuccess(await utils.ensureNoDebugSession())) {
      return;
    }

    const python = vscode.workspace.getConfiguration("python").defaultInterpreterPath;
    const odooBin = `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/odoo/odoo-bin`;
    utils
      .getOdooDevTerminal()
      .sendText(`${python} ${odooBin} ${utils.getStartServerArgs().join(" ")}`);
  })
);

export const debugServer = createCommand(
  "odooDev.debugServer",
  screamOnError(async (utils) => {
    if (!isSuccess(await utils.ensureNoActiveServer())) {
      return;
    }

    if (!isSuccess(await utils.ensureNoDebugSession())) {
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
      args: utils.getStartServerArgs(),
    };
    await vscode.debug.startDebugging(undefined, debugOdooPythonLaunchConfig);
  })
);

export const startServerWithInstall = createCommand(
  "odooDev.startServerWithInstall",
  screamOnError(async (utils) => {
    if (!isSuccess(await utils.ensureNoActiveServer())) {
      return;
    }

    if (!isSuccess(await utils.ensureNoDebugSession())) {
      return;
    }

    const selectedAddons = await multiSelectAddons();
    if (!selectedAddons) {
      return;
    }
    const python = vscode.workspace.getConfiguration("python").defaultInterpreterPath;
    const odooBin = `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/odoo/odoo-bin`;
    const args = utils.getStartServerWithInstallArgs(selectedAddons);
    const command = `${python} ${odooBin} ${args.join(" ")}`;
    utils.getOdooDevTerminal().sendText(command);
  })
);

export const startFreshServer = createCommand(
  "odooDev.startFreshServer",
  screamOnError(async (utils) => {
    if (!isSuccess(await utils.ensureNoActiveServer())) {
      return;
    }

    if (!isSuccess(await utils.ensureNoDebugSession())) {
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
    return vscode.commands.executeCommand("odooDev.startServerWithInstall");
  })
);

export const debugServerWithInstall = createCommand(
  "odooDev.debugServerWithInstall",
  screamOnError(async (utils) => {
    if (!isSuccess(await utils.ensureNoActiveServer())) {
      return;
    }

    if (!isSuccess(await utils.ensureNoDebugSession())) {
      return;
    }

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
      args: utils.getStartServerWithInstallArgs(selectedAddons),
    };
    await vscode.debug.startDebugging(undefined, debugOdooPythonLaunchConfig);
  })
);

export const startServerWithUpdate = createCommand(
  "odooDev.startServerWithUpdate",
  screamOnError(async (utils) => {
    if (!isSuccess(await utils.ensureNoActiveServer())) {
      return;
    }

    if (!isSuccess(await utils.ensureNoDebugSession())) {
      return;
    }

    const selectedAddons = await multiSelectAddons();
    if (!selectedAddons) {
      return;
    }
    const python = vscode.workspace.getConfiguration("python").defaultInterpreterPath;
    const odooBin = `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/odoo/odoo-bin`;
    const args = utils.getStartServerWithUpdateArgs(selectedAddons);
    const command = `${python} ${odooBin} ${args.join(" ")}`;
    utils.getOdooDevTerminal().sendText(command);
  })
);

export const debugServerWithUpdate = createCommand(
  "odooDev.debugServerWithUpdate",
  screamOnError(async (utils) => {
    if (!isSuccess(await utils.ensureNoActiveServer())) {
      return;
    }

    if (!isSuccess(await utils.ensureNoDebugSession())) {
      return;
    }

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
      args: utils.getStartServerWithUpdateArgs(selectedAddons),
    };
    await vscode.debug.startDebugging(undefined, debugOdooPythonLaunchConfig);
  })
);

export const startSelectedTest = createCommand(
  "odooDev.startSelectedTest",
  screamOnError(async (utils) => {
    if (!isSuccess(await utils.ensureNoActiveServer())) {
      return;
    }

    if (!isSuccess(await utils.ensureNoDebugSession())) {
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      throw new Error(
        "Open the test file and put the cursor in the test method you want to start."
      );
    }
    const testTag = await utils.getTestTag(editor);
    const python = vscode.workspace.getConfiguration("python").defaultInterpreterPath;
    const odooBin = `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/odoo/odoo-bin`;
    const args = utils.getstartSelectedTestArgs(testTag);
    const command = `${python} ${odooBin} ${args.join(" ")}`;
    utils.getOdooDevTerminal().sendText(command);
  })
);

export const debugSelectedTest = createCommand(
  "odooDev.debugSelectedTest",
  screamOnError(async (utils) => {
    if (!isSuccess(await utils.ensureNoActiveServer())) {
      return;
    }

    if (!isSuccess(await utils.ensureNoDebugSession())) {
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      throw new Error("Open a test file.");
    }
    const testTag = await utils.getTestTag(editor);
    const debugOdooPythonLaunchConfig: vscode.DebugConfiguration = {
      name: "Debug Odoo Python",
      type: "python",
      request: "launch",
      stopOnEntry: false,
      console: "integratedTerminal",
      python: "${command:python.interpreterPath}",
      program: "${workspaceFolder:odoo}/odoo-bin",
      args: utils.getstartSelectedTestArgs(testTag),
    };
    await vscode.debug.startDebugging(undefined, debugOdooPythonLaunchConfig);
  })
);

export const startCurrentTestFile = createCommand(
  "odooDev.startCurrentTestFile",
  screamOnError(async (utils) => {
    if (!isSuccess(await utils.ensureNoActiveServer())) {
      return;
    }

    if (!isSuccess(await utils.ensureNoDebugSession())) {
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      throw new Error("Open a test file.");
    }
    const testFilePath = utils.getTestFilePath(editor);
    const python = vscode.workspace.getConfiguration("python").defaultInterpreterPath;
    const odooBin = `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/odoo/odoo-bin`;
    const args = utils.getStartCurrentTestFileArgs(testFilePath);
    const command = `${python} ${odooBin} ${args.join(" ")}`;
    utils.getOdooDevTerminal().sendText(command);
  })
);

export const debugCurrentTestFile = createCommand(
  "odooDev.debugCurrentTestFile",
  screamOnError(async (utils) => {
    if (!isSuccess(await utils.ensureNoActiveServer())) {
      return;
    }

    if (!isSuccess(await utils.ensureNoDebugSession())) {
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      throw new Error("Open a test file.");
    }
    const testFilePath = utils.getTestFilePath(editor);
    const debugOdooPythonLaunchConfig: vscode.DebugConfiguration = {
      name: "Debug Odoo Python",
      type: "python",
      request: "launch",
      stopOnEntry: false,
      console: "integratedTerminal",
      python: "${command:python.interpreterPath}",
      program: "${workspaceFolder:odoo}/odoo-bin",
      args: utils.getStartCurrentTestFileArgs(testFilePath),
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

export const openLinkedNote = createCommand(
  "odooDev.openLinkedNote",
  screamOnError(async ({ getNotesFolder, db }, item) => {
    const branch = item ? item.name : db.getActiveBranch();
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
