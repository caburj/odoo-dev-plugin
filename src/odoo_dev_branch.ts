import * as vscode from "vscode";
import { OdooPluginDB } from "./odoo_plugin_db";
import { getBaseBranches } from "./helpers";

export class OdooDevBranches implements vscode.TreeDataProvider<OdooDevBranch> {
  private _onDidChangeTreeData: vscode.EventEmitter<OdooDevBranch | undefined | void> =
    new vscode.EventEmitter<OdooDevBranch | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<OdooDevBranch | undefined | void> =
    this._onDidChangeTreeData.event;

  constructor(private workspaceRoot: string | undefined, private db: OdooPluginDB) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: OdooDevBranch): vscode.TreeItem {
    return element;
  }

  private computeLabel(name: string): string {
    const activeBranch = this.db.getActiveBranch();
    if (activeBranch === name) {
      return `[${name}]`;
    } else {
      return name;
    }
  }

  async getChildren(element?: OdooDevBranch): Promise<OdooDevBranch[]> {
    if (!element) {
      const baseBranches = getBaseBranches();
      return baseBranches.map((name) => {
        const devBranches = this.db.getDevBranches(name);
        const isActive = name === this.db.getActiveBranch();
        return new OdooDevBranch(
          name,
          this.computeLabel(name),
          name,
          isActive ? "active-base-branch" : "base-branch",
          devBranches.length > 0
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None
        );
      });
    } else {
      const branchName = element.name;
      return this.db.getDevBranches(branchName).map(({ name }) => {
        const isActive = name === this.db.getActiveBranch();
        return new OdooDevBranch(
          name,
          this.computeLabel(name),
          element.base,
          isActive ? "active-dev-branch" : "dev-branch",
          vscode.TreeItemCollapsibleState.None
        );
      });
    }
  }
}

export class OdooDevBranch extends vscode.TreeItem {
  constructor(
    public readonly name: string,
    public readonly label: string,
    public readonly base: string,
    public readonly contextValue: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly command?: vscode.Command
  ) {
    super(label, collapsibleState);
    this.id = name;
    this.base = base;
    this.name = name;
    this.contextValue = contextValue;
  }
}
