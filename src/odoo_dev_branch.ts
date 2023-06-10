import * as vscode from "vscode";
import { getBaseBranches, getDevBranches } from "./state";
import { OdooDevRepositories } from "./helpers";
import { Repository } from "./dependencies/git";

export class OdooDevBranches implements vscode.TreeDataProvider<OdooDevBranch> {
  private _onDidChangeTreeData: vscode.EventEmitter<OdooDevBranch | undefined | void> =
    new vscode.EventEmitter<OdooDevBranch | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<OdooDevBranch | undefined | void> =
    this._onDidChangeTreeData.event;

  constructor(private odevRepos: OdooDevRepositories) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * Override icon and description of the tree item based on the active branches in the repos.
   * @param element
   */
  describe(element: OdooDevBranch): vscode.TreeItem {
    const repos: [name: string, repo: Repository][] = [
      ["odoo", this.odevRepos.odoo],
      ...Object.entries(this.odevRepos.custom),
    ];

    if (this.odevRepos.upgrade) {
      repos.push(["upgrade", this.odevRepos.upgrade]);
    }

    const descriptions: string[] = [];
    for (const [name, repo] of repos) {
      if (repo.state.HEAD?.name === element.name) {
        descriptions.push(name);
      }
    }

    if (descriptions.length === 1) {
      element.iconPath = new vscode.ThemeIcon("check");
    } else if (descriptions.length > 1) {
      element.iconPath = new vscode.ThemeIcon("check-all");
    }

    element.description = descriptions.join(" ");

    return element;
  }

  async getTreeItem(element: OdooDevBranch): Promise<vscode.TreeItem> {
    return this.describe(element);
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
        return new OdooDevBranch(
          name,
          name,
          "base-branch",
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
        return new OdooDevBranch(
          name,
          element.base,
          "dev-branch",
          vscode.TreeItemCollapsibleState.None
        );
      });
    }
  }
}

export class OdooDevBranch extends vscode.TreeItem {
  constructor(
    public readonly name: string,
    public readonly base: string,
    public readonly contextValue: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly command?: vscode.Command
  ) {
    super(name, collapsibleState);
    this.id = name;
    this.base = base;
    this.name = name;
    this.contextValue = contextValue;
    if (this.name === this.base) {
      this.iconPath = new vscode.ThemeIcon("repo");
    } else {
      this.iconPath = new vscode.ThemeIcon("git-branch");
    }
  }
}
