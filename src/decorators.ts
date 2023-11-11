import * as vscode from "vscode";
import * as Result from "./Result";

export function withProgress<A extends any[], R extends Promise<any>>(arg: {
  message: string;
  cb: (...args: A) => R;
}) {
  return (...args: A): Promise<Awaited<R>> => {
    return new Promise((resolve, reject) =>
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: arg.message });
          const result = await Result.try_(arg.cb, ...args);
          Result.process(result, resolve, reject);
        }
      )
    );
  };
}
