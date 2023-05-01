import * as vscode from "vscode";
import { OdooDevBranches } from "./odoo_dev_branch";
import { OdooPluginDB } from "./odoo_plugin_db";
import { GitExtension, Repository } from "./git";

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
    } catch (error) {
      await callWithSpinner({
        message: "Remote branch not found, creating new branch locally...",
        cb: async () => {
          // Checkout base first as basis for creating the new branch.
          await odooRepo.checkout(base);
          await odooRepo.createBranch(branch, true);
        },
      });
    }
    vscode.window.showInformationMessage(`Successful checkout: ${branch}`);
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
    vscode.window.showInformationMessage(`Successful checkout: ${branch}`);
  };

  const getBaseBranches = () => {
    const odooConfig = vscode.workspace.getConfiguration("odooDev");
    const baseBranches = Object.entries(odooConfig.baseBranches as Record<string, number>);
    baseBranches.sort((a, b) => a[1] - b[1]);
    return baseBranches.map((b) => b[0]);
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
    vscode.commands.registerCommand("odoo-dev-plugin.addDevBranch", async () => {
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
          vscode.window.showInformationMessage(
            `'${base}' base branch is added in the User config.`
          );
        } else if (db.devBranchExists({ base, name: input })) {
          vscode.window.showErrorMessage(`'${input}' already exists!`);
          return;
        }
        await createDevBranch(base, input);
        db.addDevBranch({ base, name: input });
      });
    }),
    vscode.commands.registerCommand("odoo-dev-plugin.removeDevBranch", async () => {
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

      return refreshTreeOnSuccessOrShowError(() => {
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

      return refreshTreeOnSuccessOrShowError(async () => {
        const branch = selected.name;
        await checkoutDevBranch(branch);
        db.setActiveBranch(branch);
      });
    }),
  ];

  for (const disposable of disposables) {
    context.subscriptions.push(disposable);
  }
}

// This method is called when your extension is deactivated
export function deactivate() {}
