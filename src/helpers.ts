import * as fs from "fs";
import * as path from "path";
import * as child_process from "child_process";
import * as psTree from "ps-tree";
import * as Result from "./Result";
import { Repository } from "./dependencies/git";
import { BASE_BRANCH_REGEX, DEV_BRANCH_REGEX } from "./constants";

export function getFoldersInDirectory(directoryPath: string) {
  const filesAndDirs = fs.readdirSync(directoryPath);
  return filesAndDirs.filter((name) => {
    const fullPath = path.join(directoryPath, name);
    const stat = fs.statSync(fullPath);
    return stat.isDirectory();
  });
}

function splitWithDashFrom(str: string, start: number) {
  return [str.substring(0, str.indexOf("-", start)), str.substring(str.indexOf("-", start) + 1)];
}

export function inferBaseBranch(devBranchName: string) {
  const start = devBranchName.startsWith("saas") ? 5 : 0;
  return splitWithDashFrom(devBranchName, start)[0];
}

export function isBaseBranch(branchName: string) {
  return inferBaseBranch(branchName) === "";
}

export function runShellCommand(
  command: string,
  options: child_process.ExecOptions = {}
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    child_process.exec(command, options, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr));
      } else {
        resolve(stdout.toString());
      }
    });
  });
}

export const tryRunShellCommand = Result.resultify(runShellCommand);

export function isValidDirectory(path: string): boolean {
  try {
    const stat = fs.statSync(path);
    return stat.isDirectory();
  } catch (err) {
    return false;
  }
}

export function fileExists(path: string): boolean {
  try {
    const stat = fs.statSync(path);
    return stat.isFile();
  } catch (err) {
    return false;
  }
}

export function createTemplateNote(path: string): void {
  const fd = fs.openSync(path, "wx");
  const template = `# Description

Use this note file to track things related to this branch, e.g. tasks list.


# Todos

* [ ] First todo
* [ ] Second todo
`;
  fs.writeSync(fd, template);
  fs.closeSync(fd);
}

export function getChildProcs(pid: number): Promise<readonly psTree.PS[]> {
  return new Promise((resolve, reject) => {
    // Get the list of child processes of the current process ID
    psTree(pid, (err, children) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(children);
    });
  });
}

export function isOdooServer(pid: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    child_process.exec(
      `ps -o command -p ${pid} | grep odoo-bin | head -1`,
      (err, stdout, _stderr) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(stdout.toString() !== "");
      }
    );
  });
}

export async function killOdooServer(pid: number): Promise<void> {
  const children = await getChildProcs(pid);
  if (children.length === 0) {
    return;
  } else {
    try {
      for (const child of children) {
        const pid = parseInt(child.PID);
        const isOdoo = await isOdooServer(pid);
        if (isOdoo) {
          process.kill(pid, "SIGINT");
        }
      }
    } catch (error) {}
  }
  let timeout: NodeJS.Timeout;
  return new Promise((resolve, reject) => {
    const retry = async () => {
      try {
        const children = await getChildProcs(pid);
        if (children.length === 0) {
          clearTimeout(timeout);
          resolve();
        } else {
          for (const child of children) {
            const pid = parseInt(child.PID);
            const isOdoo = await isOdooServer(pid);
            if (isOdoo) {
              process.kill(pid, "SIGINT");
            }
          }
          timeout = setTimeout(retry, 200);
        }
      } catch (e) {
        reject(e);
      }
    };
    retry();
  });
}

export function isAddon(path: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    try {
      fs.access(`${path}/__manifest__.py`, fs.constants.F_OK, (err) => {
        if (err) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Given `path`, return the list of addons in that directory.
 * @param path
 */
export async function getAddons(path: string): Promise<string[]> {
  const folders = getFoldersInDirectory(path);
  const addons = [];
  for (const folder of folders) {
    const res = await isAddon(`${path}/${folder}`);
    if (res) {
      addons.push(folder);
    }
  }
  return addons;
}

export function removeComments(content: string): string {
  return content.replace(/#[^\n]*\n/g, "");
}

async function isAvailableFromRemote(
  repo: Repository,
  remote: string,
  branchName: string
): Promise<boolean> {
  const result = await tryRunShellCommand(
    `git ls-remote --exit-code --heads ${remote} ${branchName}`,
    {
      cwd: repo.rootUri.fsPath,
    }
  );
  return Result.check(result);
}

export async function findRemote(
  repo: Repository,
  branchName: string
): Promise<string | undefined> {
  for (const remote of repo.state.remotes) {
    if (await isAvailableFromRemote(repo, remote.name, branchName)) {
      return remote.name;
    }
  }
  return undefined;
}

export function getBase(branch: string) {
  const check = branch.match(DEV_BRANCH_REGEX);
  if (check) {
    return check[1].replace(/-$/, "");
  } else {
    const checkIfBase = branch.match(BASE_BRANCH_REGEX);
    if (checkIfBase) {
      return checkIfBase[1];
    }
  }
}

export async function getRemoteOfBase(repo: Repository, branch: string) {
  const base = getBase(branch);
  if (base) {
    const remoteSlashBranch = await runShellCommand(
      `git rev-parse --abbrev-ref --symbolic-full-name ${base}@{u}`,
      {
        cwd: repo.rootUri.fsPath,
      }
    );
    const [remote, branch] = remoteSlashBranch.split("/");
    if (remote && branch) {
      return remote;
    }
  }
}
