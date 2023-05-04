import * as vscode from "vscode";
import * as child_process from "child_process";
import { OdooDevBranches } from "./odoo_dev_branch";
import { OdooPluginDB } from "./odoo_plugin_db";
import { GitExtension, Repository } from "./git";
import { SymbolKind } from "vscode";

const gitExtension = vscode.extensions.getExtension<GitExtension>("vscode.git")!.exports;
const git = gitExtension.getAPI(1);

function splitWithDashFrom(str: string, start: number) {
  return [str.substring(0, str.indexOf("-", start)), str.substring(str.indexOf("-", start) + 1)];
}

function inferBaseBranch(devBranchName: string) {
  const start = devBranchName.startsWith("saas") ? 5 : 0;
  return splitWithDashFrom(devBranchName, start)[0];
}

function getRemoteConfigStatus(
  repo: Repository,
  remoteName: string,
  remoteUrl: string
): "not-added" | "wrong" | "okay" {
  for (const remote of repo.state.remotes) {
    if (remote.name === remoteName) {
      if (remote.fetchUrl === remoteUrl) {
        return "okay";
      } else {
        return "wrong";
      }
    }
  }
  return "not-added";
}

function runShellCommand(command: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    child_process.exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout.toString());
      }
    });
  });
}

async function ensureRemoteOdooDevConfig(repo: Repository) {
  const remoteUrl = vscode.workspace.getConfiguration("odooDev").remoteOdooDevUrl as string;
  const remoteOdooDevConfigStatus = getRemoteConfigStatus(repo, "odoo-dev", remoteUrl);
  switch (remoteOdooDevConfigStatus) {
    case "wrong":
      await repo.removeRemote("odoo-dev");
      await repo.addRemote("odoo-dev", remoteUrl);
      break;
    case "not-added":
      await repo.addRemote("odoo-dev", remoteUrl);
      break;
  }
}

function callWithSpinner(options: { message: string; cb: () => Thenable<void> }) {
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

export async function activate(context: vscode.ExtensionContext) {
  const db = new OdooPluginDB(context.globalState);

  let odooDevTerminal: vscode.Terminal | undefined;

  const getOdooDevTerminal = () => {
    if (!odooDevTerminal) {
      odooDevTerminal = vscode.window.createTerminal({
        name: "Odoo Dev Terminal",
        cwd: `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/odoo`,
      });
      vscode.window.onDidCloseTerminal((t) => {
        if (t === odooDevTerminal) {
          odooDevTerminal = undefined;
        }
      });
      odooDevTerminal.show();
    }
    return odooDevTerminal;
  };

  const rootPath =
    vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : undefined;

  const getOdooRepo = () => {
    const sourceFolder = vscode.workspace.getConfiguration("odooDev").sourceFolder as string;
    const odooUri = vscode.Uri.joinPath(vscode.Uri.file(sourceFolder), "odoo");
    const odooRepo = git.getRepository(odooUri);
    if (odooRepo === null) {
      throw new Error(`Unable to checkout. 'odoo' repo is not found in '${sourceFolder}'.`);
    }
    return odooRepo;
  };

  const createDevBranch = async (base: string, branch: string) => {
    const odooRepo = getOdooRepo();
    try {
      await callWithSpinner({
        message: "Fetching branch from odoo-dev...",
        cb: () => odooRepo.fetch("odoo-dev", branch),
      });
      await odooRepo.checkout(branch);
      db.setActiveBranch(branch);
    } catch (error) {
      await callWithSpinner({
        message: "Remote branch not found, creating new branch locally...",
        cb: async () => {
          // Checkout base first as basis for creating the new branch.
          await odooRepo.checkout(base);
          await odooRepo.createBranch(branch, true);
          db.setActiveBranch(branch);
        },
      });
    }
  };

  const checkoutDevBranch = async (branch: string) => {
    const odooRepo = getOdooRepo();
    if (odooRepo.state.HEAD?.name === branch) {
      throw new Error(`The current branch is already '${branch}`);
    }
    try {
      await callWithSpinner({
        message: `Checking out '${branch}' in odoo...`,
        cb: () => odooRepo.checkout(branch),
      });
    } catch (error) {
      throw new Error((error as Error & { stderr: string }).stderr);
    }
  };

  const selectBranch = async (name: string) => {
    await checkoutDevBranch(name);
    db.setActiveBranch(name);
  };

  const deleteDevBranch = async (name: string) => {
    const odooRepo = getOdooRepo();
    try {
      await callWithSpinner({
        message: `Deleting '${name}' branch in odoo...`,
        cb: async () => {
          await odooRepo.deleteBranch(name, true);
        },
      });
    } catch (error) {
      throw new Error((error as { stderr: string }).stderr);
    }
  };

  const getBaseBranches = () => {
    const odooConfig = vscode.workspace.getConfiguration("odooDev");
    const baseBranches = Object.entries(odooConfig.baseBranches as Record<string, number>);
    baseBranches.sort((a, b) => a[1] - b[1]);
    return baseBranches.map((b) => b[0]);
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
    // Find the class it belongs, followed by the method.
    const classSymbol = symbols.find(
      (s) => s.kind === SymbolKind.Class && s.range.contains(position)
    );
    const methodSymbol = classSymbol
      ? classSymbol.children.find(
          (s) =>
            /^test.*/.test(s.name) && s.kind === SymbolKind.Method && s.range.contains(position)
        )
      : undefined;
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

  const treeDataProvider = new OdooDevBranches(rootPath, db, getBaseBranches);

  const refreshTreeOnSuccessOrShowError = async (cb: () => void | Promise<void>) => {
    try {
      await cb();
      treeDataProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage((error as Error).message);
    }
  };

  vscode.window.registerTreeDataProvider("odoo-dev-branches", treeDataProvider);

  const disposables = [
    vscode.commands.registerCommand("odoo-dev-plugin.addBranch", async () => {
      await ensureRemoteOdooDevConfig(getOdooRepo());

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

      return refreshTreeOnSuccessOrShowError(async () => {
        const odooDevConfig = vscode.workspace.getConfiguration("odooDev");
        const baseBrances = odooDevConfig.baseBranches as Record<string, number>;

        if (!(base in baseBrances)) {
          await odooDevConfig.update("baseBranches", { ...baseBrances, [base]: 100 }, true);
        } else if (db.devBranchExists({ base, name: input })) {
          throw new Error(`'${input}' already exists!`);
        }
        await createDevBranch(base, input);
        db.addDevBranch({ base, name: input });
      });
    }),
    vscode.commands.registerCommand("odoo-dev-plugin.removeBranch", async () => {
      const devBranches = getBaseBranches()
        .map((base) => db.getDevBranches(base).map((db) => ({ ...db, base })))
        .flat();

      const selected = await vscode.window.showQuickPick(
        devBranches.map((b) => ({ ...b, label: b.name })),
        { title: "Select the dev branch to remove" }
      );

      if (selected === undefined) {
        return;
      }

      return refreshTreeOnSuccessOrShowError(async () => {
        if (selected.base === selected.name) {
          // Not really possible at the moment. But better be sure.
          throw new Error(`Deleting base branch '${selected.base}' is not allowed.`);
        }
        if (db.getActiveBranch() === selected.name) {
          await selectBranch(selected.base);
        }
        await deleteDevBranch(selected.name);
        db.removeDevBranch(selected);
      });
    }),
    vscode.commands.registerCommand("odoo-dev-plugin.selectBranch", async () => {
      const devBranches = getBaseBranches()
        .map((base) => [
          { base, name: base },
          ...db.getDevBranches(base).map((db) => ({ ...db, base })),
        ])
        .flat();

      const selected = await vscode.window.showQuickPick(
        devBranches.map((b) => ({ ...b, label: b.name })),
        { title: "Choose from the list" }
      );

      if (selected === undefined) {
        return;
      }

      return refreshTreeOnSuccessOrShowError(() => selectBranch(selected.name));
    }),
    vscode.commands.registerCommand("odoo-dev-plugin.startServer", async () => {
      const terminal = getOdooDevTerminal();
      const python = vscode.workspace.getConfiguration("python").defaultInterpreterPath;
      const odooBin = `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/odoo/odoo-bin`;
      const configFile = `${
        vscode.workspace.getConfiguration("odooDev").sourceFolder
      }/.odoo-dev-plugin/odoo.conf`;
      terminal.sendText(`${python} ${odooBin} -c ${configFile}`);
    }),
    vscode.commands.registerCommand("odoo-dev-plugin.debugServer", async () => {
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
    }),
    vscode.commands.registerCommand("odoo-dev-plugin.startSelectedTest", async () => {
      try {
        const terminal = getOdooDevTerminal();
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          throw new Error(
            "Open the test file and put the cursor in the test method you want to start."
          );
        }
        const testTag = await getTestTag(editor);
        const python = vscode.workspace.getConfiguration("python").defaultInterpreterPath;
        const odooBin = `${
          vscode.workspace.getConfiguration("odooDev").sourceFolder
        }/odoo/odoo-bin`;
        const configFile = `${
          vscode.workspace.getConfiguration("odooDev").sourceFolder
        }/.odoo-dev-plugin/odoo.conf`;

        terminal.sendText(
          `${python} ${odooBin} -c ${configFile} --stop-after-init --test-enable --test-tags ${testTag}`
        );
      } catch (error) {
        vscode.window.showErrorMessage((error as Error).message);
      }
    }),
    vscode.commands.registerCommand("odoo-dev-plugin.debugSelectedTest", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("There is no selected test.");
        return;
      }

      try {
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
      } catch (error) {
        vscode.window.showErrorMessage((error as Error).message);
      }
    }),
    vscode.commands.registerCommand("odoo-dev-plugin.startCurrentTestFile", async () => {
      try {
        const terminal = getOdooDevTerminal();
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          throw new Error("Open a test file.");
        }
        const testFilePath = getTestFilePath(editor);
        const python = vscode.workspace.getConfiguration("python").defaultInterpreterPath;
        const odooBin = `${
          vscode.workspace.getConfiguration("odooDev").sourceFolder
        }/odoo/odoo-bin`;
        const configFile = `${
          vscode.workspace.getConfiguration("odooDev").sourceFolder
        }/.odoo-dev-plugin/odoo.conf`;

        terminal.sendText(
          `${python} ${odooBin} -c ${configFile} --stop-after-init --test-file ${testFilePath}`
        );
      } catch (error) {
        vscode.window.showErrorMessage((error as Error).message);
      }
    }),
    vscode.commands.registerCommand("odoo-dev-plugin.debugCurrentTestFile", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("There is no selected test.");
        return;
      }
      try {
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
      } catch (error) {
        vscode.window.showErrorMessage((error as Error).message);
      }
    }),
    vscode.commands.registerCommand("odoo-dev-plugin.getTestTag", async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const testTag = await getTestTag(editor);
        await vscode.env.clipboard.writeText(testTag);
      }
    }),
    vscode.commands.registerCommand("odoo-dev-plugin.getLocalServerUrl", async () => {
      try {
        const ip = await runShellCommand(
          `ifconfig en0 | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}'`
        );
        const url = `http://${ip.trim()}:8070`;
        await vscode.env.clipboard.writeText(url);
      } catch (error) {
        vscode.window.showErrorMessage((error as Error).message);
      }
    }),
    vscode.commands.registerCommand("odoo-dev-plugin.openOdooConf", () => {
      const odooDevPluginFolder = vscode.workspace.workspaceFolders?.find(
        (f) => f.name === ".odoo-dev-plugin"
      );
      if (!odooDevPluginFolder) {
        vscode.window.showErrorMessage(
          `'.odoo-dev-plugin' folder is missing from the source folder.`
        );
        return;
      }
      const confUri = vscode.Uri.joinPath(odooDevPluginFolder.uri, "odoo.conf");
      if (confUri) {
        vscode.window.showTextDocument(confUri);
      } else {
        vscode.window.showErrorMessage(
          `'odoo.conf' file is missing in the '.odoo-dev-plugin' folder.`
        );
      }
    }),
  ];

  for (const disposable of disposables) {
    context.subscriptions.push(disposable);
  }
}

// This method is called when your extension is deactivated
export function deactivate() {}
