/* eslint-disable @typescript-eslint/naming-convention */

import * as vscode from "vscode";
import { createContextualUtils } from "./contextualUtils";
import * as commands from "./commands";
import { DEBUG_PYTHON_NAME } from "./constants";
import { getAddons } from "./helpers";
import { getDebugSessions, initActiveBranch, initBaseBranches, initDevBranches } from "./state";

const ALIASES: Record<string, string[]> = {
  "odooDev.checkoutBranch": ["odooDev.selectBranch"],
  "odooDev.deleteBranch": ["odooDev.removeBranch"],
};

let addonsPathMap: Record<string, string> = {};

let stopServerStatus: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {
  stopServerStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  stopServerStatus.command = "odooDev.stopActiveServer";
  stopServerStatus.text = "$(debug-stop) Stop Odoo Server";

  const odooAddonsPath = `${vscode.workspace.getConfiguration("odooDev").sourceFolder}/odoo/addons`;

  for (const addon of await getAddons(odooAddonsPath)) {
    addonsPathMap[addon] = `${odooAddonsPath}/${addon}`;
  }

  try {
    const enterpriseAddonsPath = `${
      vscode.workspace.getConfiguration("odooDev").sourceFolder
    }/enterprise`;
    for (const addon of await getAddons(enterpriseAddonsPath)) {
      addonsPathMap[addon] = `${enterpriseAddonsPath}/${addon}`;
    }
  } catch (error) {}

  addonsPathMap["base"] = `${
    vscode.workspace.getConfiguration("odooDev").sourceFolder
  }/odoo/odoo/addons/base`;

  const utils = createContextualUtils(context, { stopServerStatus, addonsPathMap });
  const debugSessions = getDebugSessions();

  vscode.debug.onDidTerminateDebugSession((session) => {
    if (session.name === DEBUG_PYTHON_NAME) {
      vscode.commands.executeCommand("setContext", "odooDev.hasActiveServer", false);
      stopServerStatus.hide();
    }
    debugSessions.splice(debugSessions.indexOf(session), 1);
  });

  vscode.debug.onDidStartDebugSession((session) => {
    debugSessions.push(session);
  });

  await initBaseBranches(utils);
  await initDevBranches(utils);
  await initActiveBranch(utils);

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
}

// This method is called when your extension is deactivated
export function deactivate() {
  stopServerStatus.dispose();
}
