import * as vscode from "vscode";
import { getActiveBranch, getBaseBranches, getDevBranches } from "./state";

export class OdooDevBranches implements vscode.TreeDataProvider<OdooDevBranch> {
  private _onDidChangeTreeData: vscode.EventEmitter<OdooDevBranch | undefined | void> =
    new vscode.EventEmitter<OdooDevBranch | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<OdooDevBranch | undefined | void> =
    this._onDidChangeTreeData.event;

  constructor(private workspaceRoot: string | undefined) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: OdooDevBranch): vscode.TreeItem {
    return element;
  }

  private computeLabel(name: string): string {
    const activeBranch = getActiveBranch();
    if (activeBranch === name) {
      return `[${name}]`;
    } else {
      return name;
    }
  }

  async getChildren(element?: OdooDevBranch): Promise<OdooDevBranch[]> {
    if (!element) {
      const baseBranches = [...getBaseBranches()];
      baseBranches.sort((a, b) => {
        if (a === "master") {
          return -1;
        } else if (b === "master") {
          return 1;
        } else {
          a = a.replace("saas-", "");
          b = b.replace("saas-", "");
          return b.localeCompare(a);
        }
      });
      return baseBranches.map((name) => {
        const devBranches = getDevBranches(name);
        const isActive = name === getActiveBranch();
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
      const devBranches = [...getDevBranches(branchName)];
      devBranches.sort();
      return devBranches.map(({ name }) => {
        const isActive = name === getActiveBranch();
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
